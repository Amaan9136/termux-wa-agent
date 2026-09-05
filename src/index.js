'use strict';

const config = require('./config');
const logger = require('./utils/logger');
const whatsapp = require('./core/whatsapp');
const { buildHandler } = require('./core/messageHandler');
const { createLlmClient } = require('./services/llm');
const { alertOwner } = require('./services/alerts');
const { startReminderPoller } = require('./services/reminderPoller');
const { migrate } = require('./store/migrate');

migrate();

const llm = createLlmClient();

function onFatalDisconnect(reason) {
  logger.fatal({ reason }, 'Fatal disconnect');
  alertOwner(whatsapp.getSock, `Bot disconnected (${reason}). Manual restart may be needed.`);
}

async function main() {
  logger.info({ bot: config.botName }, 'Starting agent');
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
  process.exit(1);
});
