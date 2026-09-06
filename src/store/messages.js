'use strict';

const db = require('./db');

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO messages
    (wa_message_id, chat_jid, sender_jid, from_me, role, msg_type, text, caption, media_path, meta_json, ts)
  VALUES
    (@wa_message_id, @chat_jid, @sender_jid, @from_me, @role, @msg_type, @text, @caption, @media_path, @meta_json, @ts)
`);

const recentStmt = db.prepare(`
  SELECT * FROM messages WHERE chat_jid = ? ORDER BY ts DESC LIMIT ?
`);

const countSinceStmt = db.prepare(`
  SELECT COUNT(*) as n FROM messages WHERE chat_jid = ? AND ts > ?
`);

const oldestUnsummarizedStmt = db.prepare(`
  SELECT * FROM messages WHERE chat_jid = ? ORDER BY ts ASC LIMIT ?
`);

function addMessage({
  waMessageId, chatJid, senderJid, fromMe = false, role,
  msgType = 'text', text = null, caption = null, mediaPath = null, meta = null, ts = Date.now(),
}) {
  return insertStmt.run({
    wa_message_id: waMessageId,
    chat_jid: chatJid,
    sender_jid: senderJid,
    from_me: fromMe ? 1 : 0,
    role,
    msg_type: msgType,
    text,
    caption,
    media_path: mediaPath,
    meta_json: meta ? JSON.stringify(meta) : null,
    ts,
  });
}

function getRecentWindow(chatJid, limit) {
  const rows = recentStmt.all(chatJid, limit);
  return rows.reverse();
}

function countTotal(chatJid) {
  return countSinceStmt.get(chatJid, 0).n;
}

function getOldestBatch(chatJid, n) {
  return oldestUnsummarizedStmt.all(chatJid, n);
}

function deleteMessages(waMessageIds, chatJid) {
  const del = db.prepare('DELETE FROM messages WHERE wa_message_id = ? AND chat_jid = ?');
  const tx = db.transaction((ids) => {
    for (const id of ids) del.run(id, chatJid);
  });
  tx(waMessageIds);
}

function clearChatHistory(chatJid) {
  db.prepare('DELETE FROM messages WHERE chat_jid = ?').run(chatJid);
}

module.exports = {
  addMessage,
  getRecentWindow,
  countTotal,
  getOldestBatch,
  deleteMessages,
  clearChatHistory,
};
