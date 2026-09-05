'use strict';

const memoryNotes = require('../store/memoryNotes');

const RE = /^(?:remember|note)(?: that)? (.+)/i;

function match(ctx) {
  return RE.test((ctx.text || '').trim());
}

async function run(ctx) {
  const m = (ctx.text || '').trim().match(RE);
  if (!m) return "What should I remember? e.g. 'remember I prefer tea over coffee'.";
  memoryNotes.addNote(ctx.chatJid, m[1].trim());
  return `Noted: "${m[1].trim()}"`;
}

module.exports = { name: 'memory_write', description: 'Save a freeform memory note', match, run };
