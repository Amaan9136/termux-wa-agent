'use strict';

const memoryNotes = require('../store/memoryNotes');

const RE = /^(?:what do you remember about|recall|do you know) (.+)/i;

function match(ctx) {
  return RE.test((ctx.text || '').trim());
}

async function run(ctx) {
  const m = (ctx.text || '').trim().match(RE);
  const query = m ? m[1].trim() : '';
  const hits = query ? memoryNotes.searchNotes(ctx.chatJid, query, 5) : memoryNotes.listNotes(ctx.chatJid, 5);
  if (!hits.length) return query ? `Nothing saved about "${query}".` : 'No memory notes yet.';
  return hits.map((h) => `- ${h.value}`).join('\n');
}

module.exports = { name: 'memory_lookup', description: 'Search saved memory notes', match, run };
