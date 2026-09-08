'use strict';

const config = require('../config');

const COMMANDS = {
  help: {
    usage: '/help [command]',
    caption: 'Show this help, or detailed help for one command.',
    ownerOnly: false,
  },
  status: {
    usage: '/status',
    caption: 'Show bot status: owner, model, BRB mode, current status.',
    ownerOnly: false,
    subcommands: {
      set: { usage: '/status set <text>', caption: 'Set a custom status line shown in /status.' },
    },
  },
  reset: {
    usage: '/reset',
    caption: "Clear this chat's message history.",
    ownerOnly: false,
  },
  memory: {
    usage: '/memory <show|clear>',
    caption: 'Manage saved memory notes for this chat.',
    ownerOnly: false,
    subcommands: {
      show: { usage: '/memory show', caption: 'List saved memory notes for this chat.' },
      clear: { usage: '/memory clear', caption: 'Wipe memory notes for this chat.' },
    },
  },
  links: {
    usage: '/links',
    caption: 'List links saved from this chat.',
    ownerOnly: false,
  },
  brb: {
    usage: '/brb <on|off> [message]',
    caption: '"Be right back" away mode: reply with an away message instead of the assistant.',
    ownerOnly: true,
    subcommands: {
      on: { usage: '/brb on [message]', caption: 'Enable BRB mode, optionally with a custom away message.' },
      off: { usage: '/brb off', caption: 'Disable BRB mode.' },
    },
  },
  group: {
    usage: '/group <action> [groupJid]',
    caption: "Manage a group's access and reply mode. Omit the jid to target the group this is sent in.",
    ownerOnly: true,
    subcommands: {
      whitelist: { usage: '/group whitelist [jid]', caption: 'Mark the group whitelisted and turn the bot on in it.' },
      unwhitelist: { usage: '/group unwhitelist [jid]', caption: 'Remove the whitelist flag (does not disable by itself).' },
      blacklist: { usage: '/group blacklist [jid]', caption: 'Block the bot from responding in this group entirely.' },
      unblacklist: { usage: '/group unblacklist [jid]', caption: 'Remove the blacklist flag.' },
      on: { usage: '/group on [jid]', caption: 'Turn the bot on for this group, replying to every message.' },
      off: { usage: '/group off [jid]', caption: 'Turn the bot off for this group (no replies at all).' },
      mention: { usage: '/group mention [jid]', caption: 'Turn the bot on, but only reply when you are @mentioned (default for new groups).' },
      info: { usage: '/group info [jid]', caption: "Show one group's name, id and current settings." },
      list: { usage: '/group list', caption: 'List every known group with its name, id and settings. Same as /groups.' },
    },
  },
  groups: {
    usage: '/groups',
    caption: 'List every known group with its name, id and current settings.',
    ownerOnly: true,
  },
  reminders: {
    usage: '/reminders [cancel <id>]',
    caption: 'List your pending reminders in this chat, or cancel one by id.',
    ownerOnly: false,
    subcommands: {
      cancel: { usage: '/reminders cancel <id>', caption: 'Cancel a pending reminder by its id.' },
    },
  },
  ping: {
    usage: '/ping',
    caption: 'Check that the bot is alive and how long it took to reply.',
    ownerOnly: false,
  },
  uptime: {
    usage: '/uptime',
    caption: 'Show how long the bot process has been running.',
    ownerOnly: false,
  },
  id: {
    usage: '/id',
    caption: "Show this chat's JID, whether it's a group, and your mention status here.",
    ownerOnly: false,
  },
  version: {
    usage: '/version',
    caption: 'Show the bot name, model and version.',
    ownerOnly: false,
  },
};

const FREEFORM = [
  { usage: 'remind me to X in N minutes', caption: 'Create a timed reminder.' },
  { usage: 'remember <fact>', caption: 'Save a freeform memory note.' },
  { usage: 'what do you remember about <topic>', caption: 'Search saved memory notes.' },
  { usage: 'summarize', caption: 'Summarize the current chat on demand.' },
];

function getCommand(name) {
  return COMMANDS[(name || '').toLowerCase().replace(/^\//, '')] || null;
}

function formatSubcommands(cmd) {
  if (!cmd.subcommands) return '';
  return Object.values(cmd.subcommands)
    .map((s) => `  ${s.usage} - ${s.caption}`)
    .join('\n');
}

function formatCommandHelp(name) {
  const cmd = getCommand(name);
  if (!cmd) return null;
  const lines = [`*${cmd.usage}*`, cmd.caption];
  if (cmd.ownerOnly) lines.push('(owner only)');
  const subs = formatSubcommands(cmd);
  if (subs) {
    lines.push('');
    lines.push('Operations:');
    lines.push(subs);
  }
  return lines.join('\n');
}

function formatAllCommandsHelp() {
  const lines = [`*${config.botName}*`, `Personal assistant for ${config.owner.name}.`, ''];
  for (const cmd of Object.values(COMMANDS)) {
    lines.push(`${cmd.usage} - ${cmd.caption}`);
  }
  lines.push('');
  for (const f of FREEFORM) {
    lines.push(`${f.usage} - ${f.caption}`);
  }
  lines.push('');
  lines.push('Type /help <command> for details on any one command, e.g. /help group.');
  lines.push("This is a text-only assistant - it can't read images, documents, or audio.");
  return lines.join('\n');
}

module.exports = { COMMANDS, FREEFORM, getCommand, formatCommandHelp, formatAllCommandsHelp };
