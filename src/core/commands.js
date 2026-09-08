'use strict';

const config = require('../config');
const pkg = require('../../package.json');
const messagesStore = require('../store/messages');
const memoryNotes = require('../store/memoryNotes');
const botState = require('../store/botState');
const chatsStore = require('../store/chats');
const links = require('../store/links');
const reminders = require('../store/reminders');
const registry = require('./commandRegistry');
const { formatGroupList } = require('../utils/groupFormat');

const startedAt = Date.now();

function isCommand(text) {
  return /^\/[a-zA-Z]/.test((text || '').trim());
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins) parts.push(`${mins}m`);
  if (!days && !hours) parts.push(`${secs}s`);
  return parts.join(' ');
}

async function handle(ctx) {
  const t = (ctx.text || '').trim();

  const helpMatch = t.match(/^\/help(?:\s+(\S+))?$/i);
  if (helpMatch) {
    const target = helpMatch[1];
    if (!target) return registry.formatAllCommandsHelp();
    const detail = registry.formatCommandHelp(target);
    return detail || `Unknown command "${target}". Type /help to see everything I can do.`;
  }

  if (/^\/status$/i.test(t)) {
    const s = botState.getState();
    return [
      `Bot: ${config.botName}`,
      `Owner: ${config.owner.name}`,
      `Model: ${config.llm.textModel}`,
      `BRB: ${s.brb_enabled ? 'on' : 'off'}`,
      s.current_status ? `Current status: ${s.current_status}` : null,
    ].filter(Boolean).join('\n');
  }

  if (/^\/reset$/i.test(t)) {
    messagesStore.clearChatHistory(ctx.chatJid);
    return 'Chat history cleared.';
  }

  if (/^\/memory$/i.test(t)) return registry.formatCommandHelp('memory');

  if (/^\/memory show$/i.test(t)) {
    const notes = memoryNotes.listNotes(ctx.chatJid, 20);
    if (!notes.length) return 'No memory notes for this chat.';
    return notes.map((n) => `- ${n.value}`).join('\n');
  }

  if (/^\/memory clear$/i.test(t)) {
    memoryNotes.clearNotes(ctx.chatJid);
    return 'Memory notes cleared for this chat.';
  }

  if (/^\/links$/i.test(t)) {
    const rows = links.listLinks(ctx.chatJid, 10);
    if (!rows.length) return 'No saved links yet.';
    return rows.map((r) => `- ${r.url}`).join('\n');
  }

  if (/^\/groups$/i.test(t)) {
    if (!ctx.isOwner) return 'Only the owner can list groups.';
    return `*Known groups*\n${formatGroupList(chatsStore.listGroups())}`;
  }

  if (/^\/reminders$/i.test(t)) {
    const rows = reminders.listUpcoming(ctx.chatJid, 10);
    if (!rows.length) return 'No pending reminders in this chat.';
    return rows.map((r) => `#${r.id} - ${r.text} (${new Date(r.due_at).toLocaleString()})`).join('\n');
  }

  const cancelMatch = t.match(/^\/reminders cancel (\d+)$/i);
  if (cancelMatch) {
    const ok = reminders.cancelReminder(parseInt(cancelMatch[1], 10), ctx.chatJid);
    return ok
      ? `Reminder #${cancelMatch[1]} cancelled.`
      : `No pending reminder #${cancelMatch[1]} in this chat.`;
  }

  if (/^\/ping$/i.test(t)) {
    return `Pong! ${config.botName} is alive.`;
  }

  if (/^\/uptime$/i.test(t)) {
    return `Up for ${formatUptime(Date.now() - startedAt)}.`;
  }

  if (/^\/id$/i.test(t)) {
    return [
      `Chat: ${ctx.chatJid}`,
      `Group: ${ctx.isGroup ? 'yes' : 'no'}`,
      ctx.isGroup ? `Mentioned: ${ctx.mentioned ? 'yes' : 'no'}` : null,
    ].filter(Boolean).join('\n');
  }

  if (/^\/version$/i.test(t)) {
    return `${config.botName} v${pkg.version}\nModel: ${config.llm.textModel}`;
  }

  return null;
}

module.exports = { isCommand, handle, HELP_TEXT: registry.formatAllCommandsHelp() };
