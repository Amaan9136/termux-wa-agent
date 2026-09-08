'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

function ensureDirs() {
  const dbDir = path.dirname(config.storage.dbPath);
  for (const dir of [dbDir, config.storage.mediaDir,
    path.join(config.storage.mediaDir, 'incoming'),
    path.join(config.storage.mediaDir, 'tmp'),
    path.dirname(config.auth.dir)]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS chats (
  jid TEXT PRIMARY KEY,
  is_group INTEGER NOT NULL DEFAULT 0,
  name TEXT,
  ai_enabled INTEGER NOT NULL DEFAULT 1,
  mention_only INTEGER NOT NULL DEFAULT 0,
  whitelisted INTEGER NOT NULL DEFAULT 0,
  blacklisted INTEGER NOT NULL DEFAULT 0,
  rolling_summary TEXT NOT NULL DEFAULT '',
  unsummarized_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_message_id TEXT NOT NULL,
  chat_jid TEXT NOT NULL,
  sender_jid TEXT NOT NULL,
  from_me INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL,
  msg_type TEXT NOT NULL DEFAULT 'text',
  text TEXT,
  caption TEXT,
  media_path TEXT,
  meta_json TEXT,
  ts INTEGER NOT NULL,
  UNIQUE(wa_message_id, chat_jid)
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages(chat_jid, ts);

CREATE TABLE IF NOT EXISTS seen_message_ids (
  wa_message_id TEXT NOT NULL,
  chat_jid TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (wa_message_id, chat_jid)
);

CREATE TABLE IF NOT EXISTS memory_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  key TEXT,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory_notes(scope);

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_jid TEXT NOT NULL,
  owner_jid TEXT NOT NULL,
  text TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  fired INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(due_at, fired);

CREATE TABLE IF NOT EXISTS saved_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_jid TEXT NOT NULL,
  url TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  brb_enabled INTEGER NOT NULL DEFAULT 0,
  brb_message TEXT NOT NULL DEFAULT 'I''m away right now, will reply soon.',
  current_status TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO bot_state (id, brb_enabled, brb_message, current_status, updated_at)
VALUES (1, 0, 'I''m away right now, will reply soon.', '', strftime('%s','now') * 1000);
`;

function migrate() {
  ensureDirs();
  const db = new DatabaseSync(config.storage.dbPath);
  db.exec(SCHEMA);
  db.close();
  return true;
}

if (require.main === module) {
  migrate();
  // eslint-disable-next-line no-console
  console.log('[migrate] SQLite schema ready at', config.storage.dbPath);
}

module.exports = { migrate, ensureDirs, SCHEMA };