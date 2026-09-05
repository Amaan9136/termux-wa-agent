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
  return mentioned.some((j) => j.startsWith(ownerNumber));
}

function buildHandler({ llm, getSock }) {
  return async function handleMessage(msg, extracted, imagePath) {
    const waMessageId = msg.key.id;
    const chatJid = msg.key.remoteJid;
    const senderJid = msg.key.participant || msg.key.remoteJid;
    const fromMe = Boolean(msg.key.fromMe);
    const isGroup = chatJid.endsWith('@g.us');
    const isOwner = senderJid.startsWith(config.owner.number) || fromMe;

    if (!dedupe.markIfNew(waMessageId, chatJid)) return; // already processed (dedupe by WA message id)

    const chat = chatsStore.getOrCreateChat(chatJid, { isGroup });

    messagesStore.addMessage({
      waMessageId,
      chatJid,
      senderJid,
      fromMe,
      role: fromMe ? 'assistant' : 'user',
      msgType: extracted.type,
      text: extracted.text || null,
      caption: extracted.caption || null,
      mediaPath: imagePath,
      ts: (msg.messageTimestamp || Date.now() / 1000) * 1000,
    });

    if (fromMe) return; // don't reply to our own outgoing messages

    const text = extracted.text || '';
    const mentioned = isGroup ? isMentioned(msg, config.owner.number) : true;

    // Group safety gate
    if (isGroup) {
      if (!chatsStore.isChatAllowed(chat)) return;
      if (chat.mention_only && !mentioned && !commands.isCommand(text)) return;
    }

    const ctx = {
      text,
      caption: extracted.caption || '',
      chatJid,
      senderJid,
      isOwner,
      isGroup,
      mentioned,
      imagePath,
      llm,
    };

    let reply = null;
    try {
      if (commands.isCommand(text)) {
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
      sendQueue.push(getSock, chatJid, { text: reply });
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
