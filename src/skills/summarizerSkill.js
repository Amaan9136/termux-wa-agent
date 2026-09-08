'use strict';

const memoryService = require('../services/memoryService');

const RE = /^\/?summar(y|ize)( this)?( chat)?$/i;

function match(ctx) {
  return RE.test((ctx.text || '').trim());
}

async function run(ctx) {
  const { rollingSummary, recentMessages } = memoryService.buildContext(ctx.chatJid);
  if (!rollingSummary && !recentMessages.length) return 'Nothing to summarize yet.';
  const recentText = recentMessages.map((m) => m.text || `[${m.msg_type}]`).join(' | ');
  const prompt = `Summary so far: ${rollingSummary || '(none)'}\nRecent: ${recentText}`;
  const reply = await ctx.llm.generate({
    systemPrompt: 'Summarize this chat briefly for the owner, 3-5 lines max.',
    prompt,
  });
  return reply;
}

module.exports = { name: 'summarizer', description: 'Summarize the current chat on demand', match, run };
