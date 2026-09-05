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

/**
 * Returns true if this is a NEW message (and records it).
 * Returns false if we've already processed this wa_message_id for this chat,
 * which happens often with Baileys on reconnects/history-sync replays.
 */
function markIfNew(waMessageId, chatJid) {
  if (!waMessageId || !chatJid) return true; // fail open, don't block on malformed ids
  const already = checkStmt.get(waMessageId, chatJid);
  if (already) return false;
  insertStmt.run(waMessageId, chatJid, Date.now());
  return true;
}

/** Housekeeping: drop dedupe records older than 30 days so the table stays tiny. */
function pruneOld(maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
  pruneStmt.run(Date.now() - maxAgeMs);
}

module.exports = { markIfNew, pruneOld };
