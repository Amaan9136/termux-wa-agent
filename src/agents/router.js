'use strict';

const skills = require('../skills');
const memoryService = require('../services/memoryService');
const botState = require('../store/botState');
const logger = require('../utils/logger');
const buildSystemPrompt = require('../prompts/systemPrompt');

function formatContextPrompt({ rollingSummary, recentMessages, currentStatus, incomingText }) {
  const lines = [];
  if (currentStatus) lines.push(`Owner's current status: ${currentStatus}`);
  if (rollingSummary) lines.push(`Conversation summary so far:\n${rollingSummary}`);
  if (recentMessages.length) {
    lines.push('Recent messages:');
    for (const m of recentMessages) {
      const who = m.role === 'assistant' ? 'Assistant' : (m.from_me ? 'Owner' : 'User');
      lines.push(`${who}: ${m.text || `[${m.msg_type}]`}`);
    }
  }
  lines.push(`New message: ${incomingText || ''}`);
  return lines.join('\n');
}

async function route(ctx) {
  const state = botState.getState();
  if (state.brb_enabled && !ctx.isOwner) {
    return state.brb_message;
  }

  for (const skill of skills) {
    try {
      if (skill.match(ctx)) {
        logger.info({ skill: skill.name, chatJid: ctx.chatJid }, 'Routing to skill');
        return await skill.run(ctx);
      }
    } catch (err) {
      logger.error({ err: err.message, skill: skill.name }, 'Skill execution failed');
      return `That skill hit an error: ${err.message}`;
    }
  }

  const trimmed = (ctx.text || '').trim();
  if (trimmed.startsWith('/')) {
    const attempted = trimmed.split(/\s+/)[0];
    return `Unknown command "${attempted}". Type /help to see what I can do.`;
  }

  const { rollingSummary, recentMessages } = memoryService.buildContext(ctx.chatJid);
  const prompt = formatContextPrompt({
    rollingSummary,
    recentMessages,
    currentStatus: state.current_status,
    incomingText: ctx.text,
  });

  return ctx.llm.generate({ prompt, systemPrompt: buildSystemPrompt(ctx.isOwner) });
}

module.exports = { route };