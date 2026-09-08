'use strict';

const config = require('../config');
const logger = require('../utils/logger');
const dedupe = require('../store/dedupe');
const chatsStore = require('../store/chats');
const messagesStore = require('../store/messages');
const memoryService = require('../services/memoryService');
const sendQueue = require('../core/sendQueue');
const commands = require('../core/commands');
const router = require('../agents/router');

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ]);
}

function isMentioned(msg, ownerNumber) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const mentioned = ctx?.mentionedJid || [];
  return mentioned.some((j) => normalizeJidNumber(j) === ownerNumber);
}

/**
 * WhatsApp/Baileys JIDs are NOT a stable single format. The same physical
 * chat can be reported as:
 *   918867305645@s.whatsapp.net        (classic)
 *   918867305645@lid                   (WhatsApp's newer "linked id" privacy layer)
 *   918867305645:12@s.whatsapp.net     (device-id suffix, common in groups,
 *                                        occasionally elsewhere)
 * A strict `chatJid === config.owner.jid` string comparison breaks the
 * moment WhatsApp hands back any format other than the exact one baked into
 * .env - which is exactly why /help in the owner's own self-chat was being
 * silently dropped. We normalize to "digits only, no device suffix, no
 * domain" before comparing, so any of the above formats match correctly.
 */
function normalizeJidNumber(jid) {
  if (!jid) return '';
  const userPart = String(jid).split('@')[0]; // drop @s.whatsapp.net / @lid / @g.us
  const numberPart = userPart.split(':')[0]; // drop :device_id suffix
  return numberPart.replace(/[^\d]/g, '');
}

/**
 * A message with key.fromMe === true means "this device/account sent it".
 * That's ambiguous for a self-bot: it's true both for
 *   (a) the bot's own pushed replies, and
 *   (b) the owner typing directly into their own self-chat (JID matches
 *       the owner's number) to test/command the bot.
 * We only want to swallow (a). We identify our own pushed replies via a
 * short-lived echo cache (see markSentByBot below), and identify (b) via
 * normalized number comparison rather than exact JID string match.
 */
const recentlySentIds = new Set();
const RECENTLY_SENT_TTL_MS = 15000;

function markSentByBot(waMessageId) {
  recentlySentIds.add(waMessageId);
  setTimeout(() => recentlySentIds.delete(waMessageId), RECENTLY_SENT_TTL_MS);
}

function isSelfChat(chatJid, ownerNumber) {
  if (!ownerNumber) return false;
  return normalizeJidNumber(chatJid) === ownerNumber;
}

function buildHandler({ llm, getSock }) {
  return async function handleMessage(msg, extracted) {
    const waMessageId = msg.key.id;
    const chatJid = msg.key.remoteJid;
    const senderJid = msg.key.participant || msg.key.remoteJid;
    const fromMe = Boolean(msg.key.fromMe);
    const isGroup = chatJid.endsWith('@g.us');
    const isOwner = normalizeJidNumber(senderJid) === config.owner.number || fromMe;

    // Always-on, cheap diagnostic line. Set LOG_LEVEL=debug in .env to see
    // these in logs/agent.log if routing behaves unexpectedly again -
    // no more guessing about JID formats from screenshots.
    logger.debug(
      { chatJid, senderJid, fromMe, isGroup, isOwner, normalizedChat: normalizeJidNumber(chatJid) },
      'Incoming message'
    );

    if (!dedupe.markIfNew(waMessageId, chatJid)) return; // already processed (dedupe by WA message id)

    const chat = chatsStore.getOrCreateChat(chatJid, { isGroup });

    // Was this exact message one we just sent ourselves via sendQueue? If so,
    // it's WhatsApp echoing our own reply back - always safe to skip.
    const isOwnEcho = fromMe && recentlySentIds.has(waMessageId);

    messagesStore.addMessage({
      waMessageId,
      chatJid,
      senderJid,
      fromMe,
      role: fromMe ? 'assistant' : 'user',
      msgType: extracted.type,
      text: extracted.text || null,
      ts: (msg.messageTimestamp || Date.now() / 1000) * 1000,
    });

    if (isOwnEcho) return; // definitely our own outgoing reply bouncing back

    // Only skip fromMe messages that are NOT the owner's self-chat. Compares
    // normalized digits, not raw JID string, so @lid / device-suffix
    // variants of the owner's own chat are recognized correctly.
    if (fromMe && !isSelfChat(chatJid, config.owner.number)) return;

    const text = extracted.text || '';
    const mentioned = isGroup ? isMentioned(msg, config.owner.number) : true;

    // Group safety gate
    if (isGroup) {
      if (!chatsStore.isChatAllowed(chat)) return;
      if (chat.mention_only && !mentioned && !commands.isCommand(text)) return;
    }

    const ctx = {
      text,
      chatJid,
      senderJid,
      isOwner,
      isGroup,
      mentioned,
      llm,
    };

    let reply = null;
    try {
      if (extracted.type === 'unsupported') {
        reply = "I'm a text-only assistant right now - I can't read images, documents, or audio. Just send text!";
      } else if (commands.isCommand(text)) {
        reply = await withTimeout(commands.handle(ctx), config.llm.timeoutMs, 'command');
      }
      if (reply === null) {
        reply = await withTimeout(router.route(ctx), config.llm.timeoutMs, 'router');
      }
    } catch (err) {
      logger.error({ err: err.message, chatJid }, 'Handling failed');
      reply = `Sorry, something went wrong: ${err.message}`;
    }

    if (reply) {
      sendQueue.push(getSock, chatJid, { text: reply }, (sentMsg) => {
        if (sentMsg && sentMsg.key && sentMsg.key.id) {
          markSentByBot(sentMsg.key.id);
        }
      });
      messagesStore.addMessage({
        waMessageId: `${waMessageId}-reply`,
        chatJid,
        senderJid: 'bot',
        fromMe: true,
        role: 'assistant',
        msgType: 'text',
        text: reply,
        ts: Date.now(),
      });
    }

    memoryService.maybeRollUp(chatJid, llm).catch((err) =>
      logger.warn({ err: err.message, chatJid }, 'Background summary rollup failed')
    );
  };
}

module.exports = { buildHandler };
