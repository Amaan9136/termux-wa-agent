'use strict';

const config = require('../config');
const logger = require('../utils/logger');

class SendQueue {
  constructor() {
    this.queue = [];
    this.running = false;
  }

  push(sockGetter, jid, content) {
    this.queue.push({ sockGetter, jid, content, attempt: 0 });
    this._run();
  }

  async _run() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const job = this.queue.shift();
      try {
        const sock = job.sockGetter();
        if (!sock) throw new Error('socket not ready');
        await sock.sendMessage(job.jid, job.content);
      } catch (err) {
        job.attempt += 1;
        logger.warn({ err: err.message, jid: job.jid, attempt: job.attempt }, 'Send failed');
        if (job.attempt < config.sendQueue.maxRetries) {
          this.queue.push(job);
        } else {
          logger.error({ jid: job.jid }, 'Send permanently failed after retries');
        }
      }
      await new Promise((r) => setTimeout(r, config.sendQueue.minIntervalMs));
    }
    this.running = false;
  }
}

module.exports = new SendQueue();
