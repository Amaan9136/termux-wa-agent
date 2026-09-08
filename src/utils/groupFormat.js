'use strict';

function modeLabel(chat) {
  if (!chat.ai_enabled) return 'off';
  return chat.mention_only ? 'mention-only' : 'on';
}

function flagsLine(chat) {
  const parts = [modeLabel(chat)];
  if (chat.whitelisted) parts.push('whitelisted');
  if (chat.blacklisted) parts.push('blacklisted');
  return parts.join(', ');
}

function formatGroupLine(chat) {
  const name = chat.name || '(name unknown)';
  return `- ${name}\n  id: ${chat.jid}\n  ${flagsLine(chat)}`;
}

function formatGroupList(chats) {
  if (!chats.length) {
    return "No groups seen yet. I'll list them here once I receive a message from a group.";
  }
  return chats.map(formatGroupLine).join('\n');
}

module.exports = { modeLabel, flagsLine, formatGroupLine, formatGroupList };
