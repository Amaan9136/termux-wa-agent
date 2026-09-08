'use strict';

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const config = require('../config');
const logger = require('../utils/logger');

let sockRef = null;
let reconnectAttempts = 0;
const MAX_RAPID_RECONNECTS = 5;

const CONNECTION_SETTLE_MS = 4000;
let connectionStableSince = 0;
let sessionReadyAt = 0;

function isConnectionStable() {
  return connectionStableSince > 0 && (Date.now() - connectionStableSince) >= CONNECTION_SETTLE_MS;
}

function getSessionReadyAt() {
  return sessionReadyAt;
}

function waitForStableConnection(maxWaitMs = 15000) {
  const start = Date.now();
  return new Promise((resolve) => {
    (function check() {
      if (isConnectionStable() || Date.now() - start > maxWaitMs) return resolve();
      setTimeout(check, 250);
    })();
  });
}

const outgoingMessageCache = new Map();
const MSG_CACHE_MAX = 500;

function cacheOutgoing(jid, id, message) {
  const key = `${jid}:${id}`;
  outgoingMessageCache.set(key, message);
  if (outgoingMessageCache.size > MSG_CACHE_MAX) {
    const firstKey = outgoingMessageCache.keys().next().value;
    outgoingMessageCache.delete(firstKey);
  }
}

async function getMessage(key) {
  const cached = outgoingMessageCache.get(`${key.remoteJid}:${key.id}`);
  return cached || undefined;
}

function getSock() {
  return sockRef;
}

const groupMetaCache = new Map();
const GROUP_META_TTL_MS = 10 * 60 * 1000;

async function getGroupMetadata(sock, jid, { forceRefresh = false } = {}) {
  const cached = groupMetaCache.get(jid);
  if (!forceRefresh && cached && (Date.now() - cached.fetchedAt) < GROUP_META_TTL_MS) {
    return cached;
  }
  if (!sock) return cached || null;
  try {
    const meta = await sock.groupMetadata(jid);
    const entry = {
      jid,
      subject: meta.subject || null,
      participantCount: Array.isArray(meta.participants) ? meta.participants.length : 0,
      fetchedAt: Date.now(),
    };
    groupMetaCache.set(jid, entry);
    return entry;
  } catch (err) {
    logger.warn({ err: err.message, jid }, 'Failed to fetch group metadata');
    return cached || null;
  }
}

function getCachedGroupMetadata(jid) {
  return groupMetaCache.get(jid) || null;
}

function extractMessageContent(msg) {
  const m = msg.message;
  if (!m) return { type: 'text', text: '' };

  if (m.conversation) return { type: 'text', text: m.conversation };
  if (m.extendedTextMessage) return { type: 'text', text: m.extendedTextMessage.text || '' };
  if (m.imageMessage) return { type: 'unsupported', text: '' };
  if (m.documentMessage) return { type: 'unsupported', text: '' };
  if (m.audioMessage) return { type: 'unsupported', text: '' };
  return { type: 'unknown', text: '' };
}

async function start(onMessage, onFatalDisconnect) {
  const { state, saveCreds } = await useMultiFileAuthState(config.auth.dir);

  let version;
  try {
    const fetched = await fetchLatestBaileysVersion();
    version = fetched.version;
    logger.info({ version, isLatest: fetched.isLatest }, 'Using WA Web version');
  } catch (err) {
    logger.warn({ err: err.message }, 'Could not fetch latest WA version, using bundled default');
  }

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    getMessage,
    syncFullHistory: false,
  });

  sockRef = sock;
  connectionStableSince = 0;
  sock.ev.on('creds.update', saveCreds);

  if (!sock.authState.creds.registered) {
    if (config.auth.method === 'pairing' && config.owner.number) {
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(config.owner.number);
          logger.info(`PAIRING CODE: ${code}`);
          console.log(`\n=== PAIRING CODE: ${code} ===\n`);
        } catch (err) {
          logger.error({ err: err.message }, 'Pairing code request failed');
        }
      }, 3000);
    }
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && config.auth.method === 'qr') {
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      connectionStableSince = 0;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      logger.warn({ statusCode, shouldReconnect }, 'Connection closed');

      if (shouldReconnect) {
        reconnectAttempts += 1;
        if (reconnectAttempts > MAX_RAPID_RECONNECTS) {
          logger.fatal('Too many rapid reconnects, giving up');
          if (onFatalDisconnect) onFatalDisconnect('reconnect-loop');
          return;
        }
        setTimeout(() => start(onMessage, onFatalDisconnect), 2000);
      } else {
        logger.fatal('Logged out, auth wiped - re-run pairing');
        if (onFatalDisconnect) onFatalDisconnect('logged-out');
      }
    } else if (connection === 'open') {
      reconnectAttempts = 0;
      logger.info('WhatsApp connected');
      connectionStableSince = Date.now();
      sessionReadyAt = Date.now();
      logger.info({ settleMs: CONNECTION_SETTLE_MS }, 'Waiting briefly for session to stabilize before sends');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message) continue;
      try {
        const extracted = extractMessageContent(msg);
        await onMessage(msg, extracted);
      } catch (err) {
        logger.error({ err: err.message }, 'Error handling incoming message');
      }
    }
  });

  return sock;
}

async function sendMessageTracked(sock, jid, content) {
  await waitForStableConnection();
  const sent = await sock.sendMessage(jid, content);
  if (sent && sent.key && sent.message) {
    cacheOutgoing(jid, sent.key.id, sent.message);
  }
  return sent;
}

module.exports = {
  start,
  getSock,
  sendMessageTracked,
  isConnectionStable,
  waitForStableConnection,
  getGroupMetadata,
  getCachedGroupMetadata,
  getSessionReadyAt,
};