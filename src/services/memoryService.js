'use strict';

/**
 * Memory strategy (see README "How memory works" for the full rationale):
 *
 *   [ rolling_summary (compact prose, stored per-chat) ]
 *                    +
 *   [ last N raw messages, verbatim, chronological ]
 *                    =
 *              prompt context
 *
 * Raw messages are cheap to store (SQLite row per message) and cheap to
 * fetch (indexed by chat_jid+ts). Rather than ever sending the *entire*
 * history to the LLM (slow, expensive, and eventually exceeds context),
 * we keep only a small recent window verbatim and fold everything older
 * into a running natural-language summary. The summary itself is re-summarized
 * (compacted) if it grows past summaryMaxChars, so memory cost stays flat
 * over the lifetime of a chat - this is what makes it suitable for a
 * long-running personal assistant on constrained hardware (a phone).
 */

const config = require('../config');
const chatsStore = require('../store/chats');
const messagesStore = require('../store/messages');
const logger = require('../utils/logger');

/**
 * Summarize a batch of old messages into a short paragraph and fold it into
 * the chat's existing rolling_summary. Uses the LLM itself to compress.
 * Falls back to a naive text-join summary if the LLM call fails, so memory
 * never breaks the bot even when the model backend is down.
 */
async function rollUpSummary(chatJid, llmClient) {
  const chat = chatsStore.getOrCreateChat(chatJid);
  const batchSize = config.memory.summaryTriggerCount;
  const batch = messagesStore.getOldestBatch(chatJid, batchSize);
  if (batch.length < batchSize) return; // nothing to roll up yet

  const transcript = batch
    .map((m) => {
      const who = m.role === 'assistant' ? 'Assistant' : (m.from_me ? 'Owner' : 'User');
      const body = m.text || m.caption || `[${m.msg_type}]`;
      return `${who}: ${body}`;
    })
    .join('\n');

  let newSummaryChunk;
  try {
    newSummaryChunk = await llmClient.summarize({
      previousSummary: chat.rolling_summary || '',
      transcript,
      maxChars: config.memory.summaryMaxChars,
    });
  } catch (err) {
    logger.warn({ err: err.message, chatJid }, 'LLM summarization failed, using naive fallback');
    newSummaryChunk = naiveFallbackSummary(chat.rolling_summary, transcript);
  }

  let combined = newSummaryChunk.trim();
  if (combined.length > config.memory.summaryMaxChars) {
    combined = combined.slice(combined.length - config.memory.summaryMaxChars);
  }

  chatsStore.updateChat(chatJid, {
    rolling_summary: combined,
    unsummarized_count: 0,
  });

  const ids = batch.map((m) => m.wa_message_id);
  messagesStore.deleteMessages(ids, chatJid);

  logger.info({ chatJid, rolled: batch.length }, 'Rolled up chat summary');
}

function naiveFallbackSummary(previousSummary, transcript) {
  const trimmedTranscript = transcript.length > 800 ? transcript.slice(0, 800) + '…' : transcript;
  const prefix = previousSummary ? previousSummary + '\n' : '';
  return `${prefix}[auto-condensed]: ${trimmedTranscript}`;
}

/**
 * Build the full context object used to construct an LLM prompt for a chat.
 */
function buildContext(chatJid) {
  const chat = chatsStore.getOrCreateChat(chatJid);
  const recent = messagesStore.getRecentWindow(chatJid, config.memory.recentWindowSize);
  return {
    chat,
    rollingSummary: chat.rolling_summary || '',
    recentMessages: recent,
  };
}

/**
 * Call after adding a new message. Rolls up the summary if the chat has
 * accumulated more raw messages than the trigger threshold.
 */
async function maybeRollUp(chatJid, llmClient) {
  const total = messagesStore.countTotal(chatJid);
  if (total >= config.memory.summaryTriggerCount) {
    await rollUpSummary(chatJid, llmClient);
  }
}

module.exports = { buildContext, maybeRollUp, rollUpSummary };
