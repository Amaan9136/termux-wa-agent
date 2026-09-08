'use strict';

const botState = require('../store/botState');
const registry = require('../core/commandRegistry');

const BRB_RE = /^\/brb (on|off)(?: (.*))?$/i;
const BRB_BARE_RE = /^\/brb\b.*$/i;
const STATUS_RE = /^\/status set (.*)$/i;
const STATUS_SET_BARE_RE = /^\/status set\s*$/i;

function match(ctx) {
  const t = (ctx.text || '').trim();
  return BRB_RE.test(t) || BRB_BARE_RE.test(t) || STATUS_RE.test(t) || STATUS_SET_BARE_RE.test(t);
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

  if (BRB_BARE_RE.test(t)) return registry.formatCommandHelp('brb');
  return registry.formatCommandHelp('status');
}

module.exports = { name: 'brb_status', description: 'Owner-only BRB mode and current status', match, run };