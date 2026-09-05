'use strict';

const reminders = require('../store/reminders');

const TIME_RE = /remind me (?:to )?(.+?) (?:in|after) (\d+)\s*(min|mins|minute|minutes|hour|hours|h|m)\b/i;

function match(ctx) {
  return TIME_RE.test(ctx.text || '');
}

function toMs(n, unit) {
  const isHour = /^h/i.test(unit);
  return n * (isHour ? 3600000 : 60000);
}

async function run(ctx) {
  const m = (ctx.text || '').match(TIME_RE);
  if (!m) return "Tell me what to remind you and when, e.g. 'remind me to call mom in 30 minutes'.";
  const [, task, amountStr, unit] = m;
  const dueAt = Date.now() + toMs(parseInt(amountStr, 10), unit);
  reminders.createReminder(ctx.chatJid, ctx.senderJid, task.trim(), dueAt);
  const when = new Date(dueAt).toLocaleTimeString();
  return `Got it, I'll remind you to "${task.trim()}" around ${when}.`;
}

module.exports = { name: 'reminder', description: 'Create a timed reminder', match, run };
