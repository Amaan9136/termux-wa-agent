'use strict';

const skills = require('../skills');
const linkSaveSkill = require('../skills/linkSaveSkill');
const memoryService = require('../services/memoryService');
const botState = require('../store/botState');
const logger = require('../utils/logger');

function formatContextPrompt({ rollingSummary, recentMessages, currentStatus, incomingText, caption }) {
  const lines = [];
  if (currentStatus) lines.push(`Owner's current status: ${currentStatus}`);
  if (rollingSummary) lines.push(`Conversation summary so far:\n${rollingSummary}`);
  if (recentMessages.length) {
    lines.push('Recent messages:');
    for (const m of recentMessages) {
      const who = m.role === 'assistant' ? 'Assistant' : (m.from_me ? 'Owner' : 'User');
      lines.push(`${who}: ${m.text || m.caption || `[${m.msg_type}]`}`);
    }
  }
  lines.push(`New message: ${incomingText || '(image)'}${caption ? ` (caption: ${caption})` : ''}`);
  return lines.join('\n');
}

/**
 * ctx: { text, caption, chatJid, senderJid, isOwner, isGroup, mentioned, llm }
 * Returns a string reply, or null if the router decides not to respond.
 */
async function route(ctx) {
  // BRB overrides everything except owner-only control commands.
  const state = botState.getState();
  if (state.brb_enabled && !ctx.isOwner) {
    return state.brb_message;
  }

  // Explicit skill match wins over generic chat.
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

  // Fall back to direct LLM reply using rolling summary + recent window.
  const { rollingSummary, recentMessages } = memoryService.buildContext(ctx.chatJid);
  const prompt = formatContextPrompt({
    rollingSummary,
    recentMessages,
    currentStatus: state.current_status,
    incomingText: ctx.text,
    caption: ctx.caption,
  });

  return ctx.llm.generate({ prompt, imagePath: ctx.imagePath });
}

module.exports = { route };
