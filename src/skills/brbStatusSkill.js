'use strict';

const botState = require('../store/botState');

const BRB_RE = /^\/brb (on|off)(?: (.*))?$/i;
const STATUS_RE = /^\/status set (.*)$/i;

function match(ctx) {
  const t = (ctx.text || '').trim();
  return BRB_RE.test(t) || STATUS_RE.test(t);
}

async function run(ctx) {
  if (!ctx.isOwner) return 'Only the owner can change BRB/status.';
  const t = (ctx.text || '').trim();

  const brbMatch = t.match(BRB_RE);
  if (brbMatch) {
    const [, onOff, msg] = brbMatch;
    botState.setBrb(onOff.toLowerCase() === 'on', msg || null);
    return `BRB mode ${onOff.toLowerCase()}.`;
  }

  const statusMatch = t.match(STATUS_RE);
  if (statusMatch) {
    botState.setCurrentStatus(statusMatch[1].trim());
    return `Status set: "${statusMatch[1].trim()}"`;
  }
  return 'Usage: /brb on|off [message]  or  /status set <text>';
}

module.exports = { name: 'brb_status', description: 'Owner-only BRB mode and current status', match, run };
