'use strict';

const config = require('../config');
const logger = require('../utils/logger');
const sendQueue = require('../core/sendQueue');

// --- Anti-spam guard -------------------------------------------------------
const MIN_INTERVAL_MS = config.alerts.minIntervalMs;
const DEDUP_WINDOW_MS = config.alerts.dedupWindowMs;

let lastSentAt = 0;
let lastMessage = null;
let lastMessageAt = 0;
let suppressedCount = 0;

function resetGuardState() {
  // exposed for tests only
  lastSentAt = 0;
  lastMessage = null;
  lastMessageAt = 0;
  suppressedCount = 0;
}

function alertOwner(getSock, message) {
  if (!config.alerts.onCrash || !config.owner.jid) return;

  const now = Date.now();

  // Same message repeating inside the dedup window -> drop, just count it.
  if (message === lastMessage && now - lastMessageAt < DEDUP_WINDOW_MS) {
    suppressedCount += 1;
    logger.warn({ message, suppressedCount }, 'Duplicate alert suppressed (dedup window)');
    return;
  }

  // Any alert (same or different) arriving faster than MIN_INTERVAL_MS -> drop.
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
