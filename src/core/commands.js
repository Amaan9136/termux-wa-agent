'use strict';

const config = require('../config');
const messagesStore = require('../store/messages');
const memoryNotes = require('../store/memoryNotes');
const botState = require('../store/botState');

const HELP_TEXT = `*${config.botName}*
Personal assistant for ${config.owner.name}.

/help - this message
/status - show bot status
/reset - clear this chat's history
/memory show - list saved memory notes for this chat
/memory clear - wipe memory notes for this chat
/group whitelist|blacklist|on|off|mention [jid] - owner only
/brb on|off [msg] - owner only
/status set <text> - owner only
/links - list saved links
remind me to X in N minutes
remember <fact>
summarize

This is a text-only assistant - it can't read images, documents, or audio.`;

function isCommand(text) {
  return /^\/(help|status|reset|memory)\b/i.test((text || '').trim());
}

async function handle(ctx) {
  const t = (ctx.text || '').trim();

  if (/^\/help$/i.test(t)) return HELP_TEXT;

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

  if (/^\/memory show$/i.test(t)) {
    const notes = memoryNotes.listNotes(ctx.chatJid, 20);
    if (!notes.length) return 'No memory notes for this chat.';
    return notes.map((n) => `- ${n.value}`).join('\n');
  }

  if (/^\/memory clear$/i.test(t)) {
    memoryNotes.clearNotes(ctx.chatJid);
    return 'Memory notes cleared for this chat.';
  }

  return null;
}

module.exports = { isCommand, handle, HELP_TEXT };
