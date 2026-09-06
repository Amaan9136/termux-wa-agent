'use strict';

const db = require('./db');

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO seen_message_ids (wa_message_id, chat_jid, ts) VALUES (?, ?, ?)
`);
const checkStmt = db.prepare(`
  SELECT 1 FROM seen_message_ids WHERE wa_message_id = ? AND chat_jid = ?
`);
const pruneStmt = db.prepare(`
  DELETE FROM seen_message_ids WHERE ts < ?
`);

function markIfNew(waMessageId, chatJid) {
  if (!waMessageId || !chatJid) return true;
  const already = checkStmt.get(waMessageId, chatJid);
  if (already) return false;
  insertStmt.run(waMessageId, chatJid, Date.now());
  return true;
}

function pruneOld(maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
  pruneStmt.run(Date.now() - maxAgeMs);
}

module.exports = { markIfNew, pruneOld };
