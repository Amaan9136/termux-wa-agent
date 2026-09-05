'use strict';

const db = require('./db');

const insertStmt = db.prepare(`
  INSERT INTO memory_notes (scope, key, value, created_at) VALUES (?, ?, ?, ?)
`);
const listByScopeStmt = db.prepare(`
  SELECT * FROM memory_notes WHERE scope = ? ORDER BY created_at DESC LIMIT ?
`);
const clearScopeStmt = db.prepare(`DELETE FROM memory_notes WHERE scope = ?`);
const searchStmt = db.prepare(`
  SELECT * FROM memory_notes WHERE scope = ? AND (value LIKE ? OR key LIKE ?) ORDER BY created_at DESC LIMIT ?
`);

function addNote(scope, value, key = null) {
  return insertStmt.run(scope, key, value, Date.now());
}

function listNotes(scope, limit = 50) {
  return listByScopeStmt.all(scope, limit);
}

function clearNotes(scope) {
  return clearScopeStmt.run(scope);
}

function searchNotes(scope, query, limit = 10) {
  const like = `%${query}%`;
  return searchStmt.all(scope, like, like, limit);
}

module.exports = { addNote, listNotes, clearNotes, searchNotes };
