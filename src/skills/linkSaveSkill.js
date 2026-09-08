'use strict';

const links = require('../store/links');

const URL_RE = /(https?:\/\/[^\s]+)/i;
const LIST_RE = /^\/links$/i;

function match(ctx) {
  const t = ctx.text || '';
  return URL_RE.test(t) || LIST_RE.test(t.trim());
}

function autoCapture(ctx) {
  const t = ctx.text || '';
  const m = t.match(URL_RE);
  if (!m) return null;
  links.saveLink(ctx.chatJid, m[1]);
  return m[1];
}

async function run(ctx) {
  if (LIST_RE.test((ctx.text || '').trim())) {
    const rows = links.listLinks(ctx.chatJid, 10);
    if (!rows.length) return 'No saved links yet.';
    return rows.map((r) => `- ${r.url}`).join('\n');
  }
  const saved = autoCapture(ctx);
  return saved ? `Saved link: ${saved}` : 'No link found in that message.';
}

module.exports = { name: 'link_save', description: 'Save shared links and list them', match, run, autoCapture };
