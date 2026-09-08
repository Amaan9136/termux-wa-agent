'use strict';

const chats = require('../store/chats');
const registry = require('../core/commandRegistry');
const { formatGroupList, formatGroupLine } = require('../utils/groupFormat');

const CMDS = /^\/group(?:\s+(\S+))?(?:\s+(.*))?$/i;
const ACTIONS = {
  whitelist: { whitelisted: 1, blacklisted: 0, ai_enabled: 1 },
  unwhitelist: { whitelisted: 0 },
  blacklist: { blacklisted: 1, ai_enabled: 0 },
  unblacklist: { blacklisted: 0 },
  on: { ai_enabled: 1, mention_only: 0 },
  off: { ai_enabled: 0 },
  mention: { ai_enabled: 1, mention_only: 1 },
};

function match(ctx) {
  return CMDS.test((ctx.text || '').trim());
}

function usageWithGroups() {
  return [
    registry.formatCommandHelp('group'),
    '',
    '*Known groups* (use their id as the [jid] argument):',
    formatGroupList(chats.listGroups()),
  ].join('\n');
}

async function run(ctx) {
  if (!ctx.isOwner) return 'Only the owner can manage groups.';

  const m = (ctx.text || '').trim().match(CMDS);
  const action = (m && m[1] || '').toLowerCase();
  const rest = (m && m[2] || '').trim();

  if (!action) return usageWithGroups();

  if (action === 'list') {
    return `*Known groups*\n${formatGroupList(chats.listGroups())}`;
  }

  if (action === 'info') {
    const targetJid = rest || ctx.chatJid;
    const chat = chats.getChat(targetJid);
    if (!chat) return `I don't know group ${targetJid} yet - I need to see a message from it first.`;
    return formatGroupLine(chat);
  }

  if (!ACTIONS[action]) return usageWithGroups();

  const targetJid = rest || ctx.chatJid;
  chats.getOrCreateChat(targetJid, { isGroup: true });
  const chat = chats.updateChat(targetJid, ACTIONS[action]);
  const name = chat.name || '(name unknown)';
  return `Group "${name}" (${targetJid}) updated: ${action}.`;
}

module.exports = { name: 'group_manage', description: 'Owner-only group whitelist/blacklist/mode control', match, run };
