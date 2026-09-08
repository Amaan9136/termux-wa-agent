'use strict';

function tryExec(cmd) {
  try {
    require('child_process').execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

if (process.platform === 'win32') {
  tryExec('chcp 65001');
} else {
  let isWsl = false;
  try {
    isWsl = /microsoft/i.test(require('fs').readFileSync('/proc/version', 'utf8'));
  } catch (_) {}
  if (isWsl) {
    tryExec('chcp.com 65001') || tryExec('/mnt/c/Windows/System32/chcp.com 65001');
  }
}
process.stdout.setDefaultEncoding('utf8');
process.stderr.setDefaultEncoding('utf8');

const NOISY_LIBSIGNAL_PATTERNS = [
  'Failed to decrypt message with any known session',
  'Session error:',
];
const originalConsoleError = console.error.bind(console);
console.error = (...args) => {
  const first = args[0];
  if (typeof first === 'string' && NOISY_LIBSIGNAL_PATTERNS.some((p) => first.startsWith(p))) {
    return;
  }
  originalConsoleError(...args);
};

const config = require('./config');
const logger = require('./utils/logger');
const singleton = require('./core/singleton');

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