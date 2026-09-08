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
const whatsapp = require('./whatsapp');

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ]);
}

function isMassMention(mentionedJid, participantCount) {
  if (mentionedJid.length < 2) return false;
  const threshold = config.groups.massMentionThreshold;
  if (participantCount) {
    return mentionedJid.length >= Math.min(threshold, Math.ceil(participantCount * 0.6));
  }
  return mentionedJid.length >= threshold;
}

function isMentioned(msg, ownerNumber, participantCount) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const mentioned = ctx?.mentionedJid || [];
  if (!mentioned.length) return false;
  if (isMassMention(mentioned, participantCount)) return false;
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

function isSelfChat(chatJid, sock, ownerNumber) {
  const chatNum = normalizeJidNumber(chatJid);
  if (!chatNum) return false;
  if (chatNum === ownerNumber) return true;
  const user = sock && sock.user;
  if (!user) return false;
  const ownIds = [user.id, user.lid].filter(Boolean).map(normalizeJidNumber);
  return ownIds.includes(chatNum);
}

async function resolveReply(ctx, extracted) {
  if (extracted.type === 'unsupported') {
    return "I'm a text-only assistant right now - I can't read images, documents, or audio. Just send text!";
  }
  if (commands.isCommand(ctx.text)) {
    const r = await withTimeout(commands.handle(ctx), config.llm.timeoutMs, 'command');
    if (r !== null) return r;
  }
  return withTimeout(router.route(ctx), config.llm.timeoutMs, 'router');
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

    let chat = chatsStore.getOrCreateChat(chatJid, { isGroup });

    let groupMeta = null;
    if (isGroup) {
      groupMeta = await whatsapp.getGroupMetadata(getSock(), chatJid).catch(() => null);
      if (groupMeta && groupMeta.subject && groupMeta.subject !== chat.name) {
        chat = chatsStore.updateChat(chatJid, { name: groupMeta.subject });
      }
    }

    const isOwnEcho = fromMe && recentlySentIds.has(waMessageId);

    const text = extracted.text || '';
    const isOwnerCommandHere = isOwner && commands.isCommand(text);

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

    // Owner's own plain chat messages sent to a contact (not a /command,
    // not the self-chat) are just the owner talking - don't auto-reply to
    // them. Owner's own /commands are allowed through from any chat window
    // so admin-to-user commands (e.g. /memory show) work without switching
    // to the self-chat first.
    if (fromMe && !isSelfChat(chatJid, getSock(), config.owner.number) && !isOwnerCommandHere) return;

    // Messages delivered late after a reconnect (the bot was paused/down and
    // WhatsApp queued them) are stored above for history/continuity, but we
    // never generate a reply for them - only live messages received while
    // the connection is actually up get answered.
    const sessionReadyAt = whatsapp.getSessionReadyAt();
    const msgTs = (msg.messageTimestamp || Date.now() / 1000) * 1000;
    if (!fromMe && sessionReadyAt && msgTs < sessionReadyAt - config.runtime.backlogGraceMs) {
      logger.info({ chatJid, msgTs, sessionReadyAt }, 'Skipping reply for backlog message delivered after reconnect');
      return;
    }

    const mentioned = isGroup
      ? isMentioned(msg, config.owner.number, groupMeta && groupMeta.participantCount)
      : true;

    if (isGroup) {
      if (!isOwnerCommandHere && !chatsStore.isChatAllowed(chat)) return;
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
      reply = await resolveReply(ctx, extracted);
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

module.exports = { buildHandler, resolveReply, normalizeJidNumber, isSelfChat };