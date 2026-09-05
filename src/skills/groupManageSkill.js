'use strict';

const chats = require('../store/chats');

const CMDS = /^\/group (whitelist|blacklist|unwhitelist|unblacklist|on|off|mention) ?(.*)$/i;

function match(ctx) {
  return CMDS.test((ctx.text || '').trim());
}

async function run(ctx) {
  if (!ctx.isOwner) return 'Only the owner can manage groups.';
  const m = (ctx.text || '').trim().match(CMDS);
  if (!m) return 'Usage: /group <whitelist|blacklist|unwhitelist|unblacklist|on|off|mention> [jid]';
  const [, action, argJid] = m;
  const targetJid = (argJid || '').trim() || ctx.chatJid;
  const chat = chats.getOrCreateChat(targetJid, { isGroup: true });

  const map = {
    whitelist: { whitelisted: 1, blacklisted: 0, ai_enabled: 1 },
    unwhitelist: { whitelisted: 0 },
    blacklist: { blacklisted: 1, ai_enabled: 0 },
    unblacklist: { blacklisted: 0 },
    on: { ai_enabled: 1, mention_only: 0 },
    off: { ai_enabled: 0 },
    mention: { ai_enabled: 1, mention_only: 1 },
  };
  chats.updateChat(targetJid, map[action.toLowerCase()]);
  return `Group ${targetJid} updated: ${action}.`;
}

module.exports = { name: 'group_manage', description: 'Owner-only group whitelist/blacklist/mode control', match, run };
