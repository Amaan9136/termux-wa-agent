'use strict';

const config = require('../config');
const logger = require('../utils/logger');
const sendQueue = require('../core/sendQueue');

const MIN_INTERVAL_MS = config.alerts.minIntervalMs;
const DEDUP_WINDOW_MS = config.alerts.dedupWindowMs;

let lastSentAt = 0;
let lastMessage = null;
let lastMessageAt = 0;
let suppressedCount = 0;

function resetGuardState() {

  lastSentAt = 0;
  lastMessage = null;
  lastMessageAt = 0;
  suppressedCount = 0;
}

function alertOwner(getSock, message) {
  if (!config.alerts.onCrash || !config.owner.jid) return;

  const now = Date.now();

  if (message === lastMessage && now - lastMessageAt < DEDUP_WINDOW_MS) {
    suppressedCount += 1;
    logger.warn({ message, suppressedCount }, 'Duplicate alert suppressed (dedup window)');
    return;
  }

  if (now - lastSentAt < MIN_INTERVAL_MS) {
    suppressedCount += 1;
    logger.warn({ message, suppressedCount }, 'Alert suppressed (rate limit)');
    return;
  }

  lastMessage = message;
  lastMessageAt = now;
  lastSentAt = now;

  const suffix = suppressedCount > 0 ? ` (+${suppressedCount} similar suppressed)` : '';
  suppressedCount = 0;

  try {
    const sock = getSock();
    if (!sock) return;
    sendQueue.push(() => sock, config.owner.jid, { text: `[ALERT] ${message}${suffix}` });
  } catch (err) {
    logger.error({ err: err.message }, 'alertOwner failed');
  }
}

module.exports = { alertOwner, _resetGuardState: resetGuardState };