'use strict';

const config = require('../config');
const chatsStore = require('../store/chats');
const messagesStore = require('../store/messages');
const logger = require('../utils/logger');

async function rollUpSummary(chatJid, llmClient) {
  const chat = chatsStore.getOrCreateChat(chatJid);
  const batchSize = config.memory.summaryTriggerCount;
  const batch = messagesStore.getOldestBatch(chatJid, batchSize);
  if (batch.length < batchSize) return;

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

function buildContext(chatJid) {
  const chat = chatsStore.getOrCreateChat(chatJid);
  const recent = messagesStore.getRecentWindow(chatJid, config.memory.recentWindowSize);
  return {
    chat,
    rollingSummary: chat.rolling_summary || '',
    recentMessages: recent,
  };
}

async function maybeRollUp(chatJid, llmClient) {
  const total = messagesStore.countTotal(chatJid);
  if (total >= config.memory.summaryTriggerCount) {
    await rollUpSummary(chatJid, llmClient);
  }
}

module.exports = { buildContext, maybeRollUp, rollUpSummary };
