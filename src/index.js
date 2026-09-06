'use strict';

const config = require('./config');
const logger = require('./utils/logger');
const singleton = require('./core/singleton');

// Must run before anything else touches data/auth_info or opens a socket.
// Prevents the exact failure mode that caused the SessionCipher decrypt
// errors and reconnect storms: two node processes racing on the same
// WhatsApp multi-device session.
singleton.acquireLock();
singleton.installShutdownHooks();

const whatsapp = require('./core/whatsapp');
const sendQueue = require('./core/sendQueue');
const { buildHandler } = require('./core/messageHandler');
const { createLlmClient } = require('./services/llm');
const { alertOwner } = require('./services/alerts');
const { startReminderPoller } = require('./services/reminderPoller');
const { migrate } = require('./store/migrate');

migrate();

const llm = createLlmClient();

sendQueue.setTransport(whatsapp.sendMessageTracked);

function onFatalDisconnect(reason) {
  logger.fatal({ reason }, 'Fatal disconnect');
  alertOwner(whatsapp.getSock, `Bot disconnected (${reason}). Manual restart may be needed.`);
  singleton.releaseLock();
}

async function main() {
  logger.info({ bot: config.botName, pid: process.pid }, 'Starting agent');
  const handleMessage = buildHandler({ llm, getSock: whatsapp.getSock });
  await whatsapp.start(handleMessage, onFatalDisconnect);
  startReminderPoller(whatsapp.getSock);
}

process.on('uncaughtException', (err) => {
  logger.fatal({ err: err.message, stack: err.stack }, 'Uncaught exception');
  alertOwner(whatsapp.getSock, `Uncaught exception: ${err.message}`);
});

process.on('unhandledRejection', (err) => {
  logger.error({ err: err && err.message }, 'Unhandled rejection');
});

main().catch((err) => {
  logger.fatal({ err: err.message }, 'Startup failed');
  singleton.releaseLock();
  process.exit(1);
});
