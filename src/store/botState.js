'use strict';

const db = require('./db');

const getStmt = db.prepare('SELECT * FROM bot_state WHERE id = 1');
const updateStmt = db.prepare(`
  UPDATE bot_state SET brb_enabled = @brb_enabled, brb_message = @brb_message,
    current_status = @current_status, updated_at = @updated_at WHERE id = 1
`);

function getState() {
  return getStmt.get();
}

function setBrb(enabled, message = null) {
  const current = getState();
  updateStmt.run({
    brb_enabled: enabled ? 1 : 0,
    brb_message: message !== null ? message : current.brb_message,
    current_status: current.current_status,
    updated_at: Date.now(),
  });
  return getState();
}

function setCurrentStatus(status) {
  const current = getState();
  updateStmt.run({
    brb_enabled: current.brb_enabled,
    brb_message: current.brb_message,
    current_status: status,
    updated_at: Date.now(),
  });
  return getState();
}

module.exports = { getState, setBrb, setCurrentStatus };
