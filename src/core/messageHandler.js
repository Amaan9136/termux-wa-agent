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

function normalizeJidNumber(jid) {
  if (!jid) return '';
  const userPart = String(jid).split('@')[0];
  const numberPart = userPart.split(':')[0];
  return numberPart.replace(/[^\d]/g, '');
}

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

    logger.debug(
      { chatJid, senderJid, fromMe, isGroup, isOwner, normalizedChat: normalizeJidNumber(chatJid) },
      'Incoming message'
    );

    logger.always(
      { chatJid, senderJid, fromMe, isGroup, isOwner, text: extracted.text || '' },
      'RECEIVED'
    );

    if (!dedupe.markIfNew(waMessageId, chatJid)) return;

    const chat = chatsStore.getOrCreateChat(chatJid, { isGroup });

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

    if (isOwnEcho) return;

    if (fromMe && !isSelfChat(chatJid, config.owner.number)) return;

    const text = extracted.text || '';
    const mentioned = isGroup ? isMentioned(msg, config.owner.number) : true;

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
      logger.always({ chatJid, senderJid, text: reply }, 'REPLIED');
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