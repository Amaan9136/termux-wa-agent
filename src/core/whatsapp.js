'use strict';

const path = require('path');
const fs = require('fs');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  Browsers,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const config = require('../config');
const logger = require('../utils/logger');

let sockRef = null;
let reconnectAttempts = 0;
const MAX_RAPID_RECONNECTS = 5;

// Baileys needs to be able to look up previously-sent messages (by id) when
// it has to re-encrypt/retry delivery to a participant whose session needs
// a resend (very common in groups, and for any recipient other than
// yourself). Without a getMessage store, sends to OTHER participants can
// silently fail/never arrive even though sock.sendMessage() resolves fine -
// this is one of the most common causes of "self-chat works, group/other
// contacts don't" reports with Baileys.
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

function extractMessageContent(msg) {
  const m = msg.message;
  if (!m) return { type: 'text', text: '' };

  if (m.conversation) return { type: 'text', text: m.conversation };
  if (m.extendedTextMessage) return { type: 'text', text: m.extendedTextMessage.text || '' };
  if (m.imageMessage) return { type: 'image', text: '', caption: m.imageMessage.caption || '' };
  if (m.documentMessage) return { type: 'document', text: '', caption: m.documentMessage.caption || m.documentMessage.fileName || '' };
  if (m.audioMessage) return { type: 'audio', text: '' };
  return { type: 'unknown', text: '' };
}

async function saveIncomingImage(sock, msg) {
  try {
    const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }) });
    const dir = path.join(config.storage.mediaDir, 'incoming');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${msg.key.id}.jpg`);
    fs.writeFileSync(filePath, buffer);
    return filePath;
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to download image');
    return null;
  }
}

/**
 * @param {(msg: object, extracted: object, imagePath: string|null) => Promise<void>} onMessage
 * @param {(reason: string) => void} onFatalDisconnect
 */
async function start(onMessage, onFatalDisconnect) {
  const { state, saveCreds } = await useMultiFileAuthState(config.auth.dir);

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    // A stable, "real" browser identity greatly improves reliability of
    // delivery to other participants (not just your own self-chat). Some
    // recipient clients/relays are stricter about messages coming from an
    // unidentified/anonymous multi-device session.
    browser: Browsers.ubuntu('Chrome'),
    getMessage,
    // Helps Baileys retry/resend when a participant's session needs a
    // fresh prekey exchange, instead of silently dropping the message.
    syncFullHistory: false,
  });

  sockRef = sock;
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
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message) continue;
      try {
        const extracted = extractMessageContent(msg);
        let imagePath = null;
        if (extracted.type === 'image') {
          imagePath = await saveIncomingImage(sock, msg);
        }
        await onMessage(msg, extracted, imagePath);
      } catch (err) {
        logger.error({ err: err.message }, 'Error handling incoming message');
      }
    }
  });

  return sock;
}

/**
 * Wraps sock.sendMessage so every outgoing message is cached for getMessage()
 * lookups. Call this instead of sock.sendMessage directly wherever possible
 * (sendQueue already does, see core/sendQueue.js).
 */
async function sendMessageTracked(sock, jid, content) {
  const sent = await sock.sendMessage(jid, content);
  if (sent && sent.key && sent.message) {
    cacheOutgoing(jid, sent.key.id, sent.message);
  }
  return sent;
}

module.exports = { start, getSock, sendMessageTracked };
