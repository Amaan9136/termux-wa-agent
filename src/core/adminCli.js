'use strict';

const readline = require('readline');
const config = require('../config');
const logger = require('../utils/logger');
const messagesStore = require('../store/messages');
const chatsStore = require('../store/chats');
const { resolveReply } = require('./messageHandler');

function startAdminCli({ llm }) {
  if (!process.stdin.isTTY) {
    logger.info('stdin is not a TTY, admin CLI not started');
    return null;
  }

  const chatJid = config.owner.jid || 'cli@local';
  chatsStore.getOrCreateChat(chatJid, { isGroup: false });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'admin> ',
  });

  console.log(`Admin CLI ready for ${config.owner.name || 'owner'}. Type /help or a message. The bot keeps running in the background.`);
  rl.prompt();

  rl.on('line', async (line) => {
    const text = line.trim();
    if (!text) {
      rl.prompt();
      return;
    }

    const waMessageId = `cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    messagesStore.addMessage({
      waMessageId,
      chatJid,
      senderJid: chatJid,
      fromMe: true,
      role: 'assistant',
      msgType: 'text',
      text,
      ts: Date.now(),
    });

    const ctx = {
      text,
      chatJid,
      senderJid: chatJid,
      isOwner: true,
      isGroup: false,
      mentioned: true,
      llm,
    };

    try {
      const extracted = { type: 'text', text };
      const reply = await resolveReply(ctx, extracted);
      if (reply) {
        console.log(reply);
        messagesStore.addMessage({
          waMessageId: `${waMessageId}-reply`,
          chatJid,
          senderJid: 'bot',
          fromMe: true,
          role: 'assistant',
          msgType: 'text',
          text: reply,
          ts: Date.now(),
        });
      }
    } catch (err) {
      logger.error({ err: err.message }, 'Admin CLI command failed');
      console.log(`Error: ${err.message}`);
    }

    rl.prompt();
  });

  rl.on('SIGINT', () => {
    rl.close();
  });

  return rl;
}

module.exports = { startAdminCli };
