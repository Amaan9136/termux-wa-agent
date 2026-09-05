'use strict';

const db = require('./db');

const insertStmt = db.prepare(`
  INSERT INTO reminders (chat_jid, owner_jid, text, due_at, fired, created_at)
  VALUES (?, ?, ?, ?, 0, ?)
`);
const dueStmt = db.prepare(`
  SELECT * FROM reminders WHERE fired = 0 AND due_at <= ? ORDER BY due_at ASC
`);
const markFiredStmt = db.prepare(`UPDATE reminders SET fired = 1 WHERE id = ?`);
const listUpcomingStmt = db.prepare(`
  SELECT * FROM reminders WHERE chat_jid = ? AND fired = 0 ORDER BY due_at ASC LIMIT ?
`);

function createReminder(chatJid, ownerJid, text, dueAt) {
  const info = insertStmt.run(chatJid, ownerJid, text, dueAt, Date.now());
  return info.lastInsertRowid;
}

function getDueReminders(now = Date.now()) {
  return dueStmt.all(now);
}

function markFired(id) {
  markFiredStmt.run(id);
}

function listUpcoming(chatJid, limit = 10) {
  return listUpcomingStmt.all(chatJid, limit);
}

module.exports = { createReminder, getDueReminders, markFired, listUpcoming };
