'use strict';

const reminders = require('../store/reminders');
const sendQueue = require('../core/sendQueue');
const logger = require('../utils/logger');

function startReminderPoller(getSock, intervalMs = 30000) {
  setInterval(() => {
    try {
      const due = reminders.getDueReminders();
      for (const r of due) {
        sendQueue.push(getSock, r.chat_jid, { text: `⏰ Reminder: ${r.text}` });
        reminders.markFired(r.id);
      }
    } catch (err) {
      logger.error({ err: err.message }, 'Reminder poll failed');
    }
  }, intervalMs);
}

module.exports = { startReminderPoller };
