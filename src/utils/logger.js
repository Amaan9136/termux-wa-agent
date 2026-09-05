'use strict';

const fs = require('fs');
const path = require('path');
const pino = require('pino');
const config = require('../config');

if (!fs.existsSync(config.logging.dir)) {
  fs.mkdirSync(config.logging.dir, { recursive: true });
}

const logFile = path.join(config.logging.dir, 'agent.log');
const destination = pino.destination({ dest: logFile, sync: false });

const fileLogger = pino(
  { level: config.logging.level, timestamp: pino.stdTimeFunctions.isoTime },
  destination
);

// Also mirror to console for interactive Termux sessions.
const consoleLogger = pino({
  level: config.logging.level,
  transport: undefined,
});

function forward(level, args) {
  try {
    fileLogger[level](...args);
  } catch (_) {
    /* never let logging crash the app */
  }
  try {
    consoleLogger[level](...args);
  } catch (_) {
    /* ignore */
  }
}

const logger = {
  info: (...args) => forward('info', args),
  warn: (...args) => forward('warn', args),
  error: (...args) => forward('error', args),
  debug: (...args) => forward('debug', args),
  fatal: (...args) => forward('fatal', args),
};

module.exports = logger;
