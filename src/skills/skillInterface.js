'use strict';

/**
 * Skill shape: { name, description, match(ctx), run(ctx) }
 * - match(ctx): boolean, quick heuristic check (router also lets LLM pick by name)
 * - run(ctx): returns a string reply
 * ctx = { text, caption, chatJid, senderJid, isOwner, isGroup, mentioned, db helpers via require }
 */
module.exports = {};
