'use strict';

const config = require('../config');
const logger = require('../utils/logger');

function alertOwner(getSock, message) {
  if (!config.alerts.onCrash || !config.owner.jid) return;
  try {
    const sock = getSock();
    if (!sock) return;
    sock.sendMessage(config.owner.jid, { text: `[ALERT] ${message}` }).catch((err) =>
      logger.error({ err: err.message }, 'Failed to send alert to owner')
    );
  } catch (err) {
    logger.error({ err: err.message }, 'alertOwner failed');
  }
}

module.exports = { alertOwner };
