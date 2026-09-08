'use strict';

const config = require('../config');

const COMMANDS = {
  help: {
    usage: '/help [command]',
    caption: 'Show this help, or detailed help for one command.',
    ownerOnly: false,
    scopes: ['general'],
  },
  status: {
    usage: '/status',
    caption: 'Show bot status: owner, model, BRB mode, current status.',
    ownerOnly: false,
    scopes: ['general'],
    subcommands: {
      set: { usage: '/status set <text>', caption: 'Set a custom status line shown in /status.' },
    },
  },
  reset: {
    usage: '/reset',
    caption: "Clear this chat's message history.",
    ownerOnly: false,
    scopes: ['general', 'admin-user', 'admin-admin'],
  },
  memory: {
    usage: '/memory <show|clear>',
    caption: "Show what the LLM remembers about this chat (rolling summary + saved notes), or wipe it.",
    ownerOnly: false,
    scopes: ['general', 'admin-user', 'admin-admin'],
    subcommands: {
      show: { usage: '/memory show', caption: "Show this chat's rolling summary and saved memory notes." },
      clear: { usage: '/memory clear', caption: 'Wipe memory notes for this chat.' },
    },
  },
  links: {
    usage: '/links',
    caption: 'List links saved from this chat.',
    ownerOnly: false,
    scopes: ['general', 'admin-user', 'admin-admin'],
  },
  brb: {
    usage: '/brb <on|off> [message]',
    caption: '"Be right back" away mode: reply with an away message instead of the assistant.',
    ownerOnly: true,
    scopes: ['admin-admin'],
    subcommands: {
      on: { usage: '/brb on [message]', caption: 'Enable BRB mode, optionally with a custom away message.' },
      off: { usage: '/brb off', caption: 'Disable BRB mode.' },
    },
  },
  group: {
    usage: '/group <action> [groupJid]',
    caption: "Manage a group's access and reply mode. Omit the jid to target the group this is sent in.",
    ownerOnly: true,
    scopes: ['admin-group', 'admin-admin'],
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
    scopes: ['admin-group', 'admin-admin'],
  },
  reminders: {
    usage: '/reminders [cancel <id>]',
    caption: 'List your pending reminders in this chat, or cancel one by id.',
    ownerOnly: false,
    scopes: ['general', 'admin-user', 'admin-admin'],
    subcommands: {
      cancel: { usage: '/reminders cancel <id>', caption: 'Cancel a pending reminder by its id.' },
    },
  },
  ping: {
    usage: '/ping',
    caption: 'Check that the bot is alive and how long it took to reply.',
    ownerOnly: false,
    scopes: ['general'],
  },
  uptime: {
    usage: '/uptime',
    caption: 'Show how long the bot process has been running.',
    ownerOnly: false,
    scopes: ['general'],
  },
  id: {
    usage: '/id',
    caption: "Show this chat's JID, whether it's a group, and your mention status here.",
    ownerOnly: false,
    scopes: ['general', 'admin-user', 'admin-admin'],
  },
  version: {
    usage: '/version',
    caption: 'Show the bot name, model and version.',
    ownerOnly: false,
    scopes: ['general'],
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
  if (cmd.scopes && cmd.scopes.includes('admin-user')) {
    lines.push("Admin -> User: the owner can also run this inside any user's chat - it acts on that chat.");
  }
  if (cmd.scopes && cmd.scopes.includes('admin-group')) {
    lines.push("Admin -> Group: run this inside (or targeting) a group chat - it acts on that group.");
  }
  if (cmd.scopes && cmd.scopes.includes('admin-admin')) {
    const alsoScoped = cmd.scopes.includes('admin-user') || cmd.scopes.includes('admin-group');
    lines.push(
      alsoScoped
        ? 'Admin -> Admin: also works from your own admin chat (acts on the current chat, or a jid you pass in).'
        : 'Admin -> Admin: a bot-wide control, not tied to a single chat.'
    );
  }
  const subs = formatSubcommands(cmd);
  if (subs) {
    lines.push('');
    lines.push('Operations:');
    lines.push(subs);
  }
  return lines.join('\n');
}

function commandsWithScope(scope) {
  return Object.values(COMMANDS).filter((cmd) => cmd.scopes && cmd.scopes.includes(scope));
}

function formatAllCommandsHelp(isOwner = false) {
  const lines = [`*${config.botName}*`, `Personal assistant for ${config.owner.name}.`, ''];

  lines.push('*Commands*');
  for (const cmd of commandsWithScope('general')) {
    lines.push(`${cmd.usage} - ${cmd.caption}`);
  }

  if (isOwner) {
    const adminUserCmds = commandsWithScope('admin-user');
    const adminGroupCmds = commandsWithScope('admin-group');
    const adminAdminCmds = commandsWithScope('admin-admin');

    if (adminUserCmds.length) {
      lines.push('');
      lines.push("*Admin -> User* (run these inside any user's chat - they act on that chat)");
      for (const cmd of adminUserCmds) {
        lines.push(`${cmd.usage} - ${cmd.caption}`);
      }
    }

    if (adminGroupCmds.length) {
      lines.push('');
      lines.push('*Admin -> Group* (run these inside, or pointed at, a group chat)');
      for (const cmd of adminGroupCmds) {
        lines.push(`${cmd.usage} - ${cmd.caption}`);
      }
    }

    if (adminAdminCmds.length) {
      lines.push('');
      lines.push('*Admin -> Admin* (bot-wide controls, and every admin command above also works here)');
      for (const cmd of adminAdminCmds) {
        lines.push(`${cmd.usage} - ${cmd.caption}`);
      }
    }
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