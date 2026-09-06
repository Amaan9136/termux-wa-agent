'use strict';

const db = require('./db');
const config = require('../config');

const insertStmt = db.prepare(`
  INSERT INTO chats (jid, is_group, name, ai_enabled, mention_only, whitelisted, blacklisted, rolling_summary, unsummarized_count, created_at, updated_at)
  VALUES (@jid, @is_group, @name, @ai_enabled, @mention_only, @whitelisted, @blacklisted, '', 0, @now, @now)
`);

const getStmt = db.prepare('SELECT * FROM chats WHERE jid = ?');
const touchStmt = db.prepare('UPDATE chats SET updated_at = ? WHERE jid = ?');

function getOrCreateChat(jid, { isGroup = false, name = null } = {}) {
  let row = getStmt.get(jid);
  if (row) return row;

  const defaultMode = config.groups.defaultMode;
  const ai_enabled = isGroup ? (defaultMode !== 'off' ? 1 : 0) : 1;
  const mention_only = isGroup && defaultMode === 'mention' ? 1 : 0;

  insertStmt.run({
    jid,
    is_group: isGroup ? 1 : 0,
    name,
    ai_enabled,
    mention_only,
    whitelisted: 0,
    blacklisted: 0,
    now: Date.now(),
  });
  return getStmt.get(jid);
}

function updateChat(jid, fields) {
  const allowed = ['name', 'ai_enabled', 'mention_only', 'whitelisted', 'blacklisted', 'rolling_summary', 'unsummarized_count'];
  const sets = [];
  const params = {};
  for (const key of Object.keys(fields)) {
    if (!allowed.includes(key)) continue;
    sets.push(`${key} = @${key}`);
    params[key] = fields[key];
  }
  if (!sets.length) return getStmt.get(jid);
  params.jid = jid;
  params.now = Date.now();
  db.prepare(`UPDATE chats SET ${sets.join(', ')}, updated_at = @now WHERE jid = @jid`).run(params);
  return getStmt.get(jid);
}

function touch(jid) {
  touchStmt.run(Date.now(), jid);
}

function listGroups() {
  return db.prepare('SELECT * FROM chats WHERE is_group = 1 ORDER BY updated_at DESC').all();
}

function isChatAllowed(chatRow) {
  if (!chatRow) return false;
  if (chatRow.blacklisted) return false;
  if (!chatRow.ai_enabled) return false;
  return true;
}

module.exports = {
  getOrCreateChat,
  updateChat,
  touch,
  listGroups,
  isChatAllowed,
};
