'use strict';

const db = require('./db');

const insertStmt = db.prepare(`
  INSERT INTO saved_links (chat_jid, url, note, created_at) VALUES (?, ?, ?, ?)
`);
const listStmt = db.prepare(`
  SELECT * FROM saved_links WHERE chat_jid = ? ORDER BY created_at DESC LIMIT ?
`);

function saveLink(chatJid, url, note = null) {
  return insertStmt.run(chatJid, url, note, Date.now());
}

function listLinks(chatJid, limit = 20) {
  return listStmt.all(chatJid, limit);
}

module.exports = { saveLink, listLinks };
