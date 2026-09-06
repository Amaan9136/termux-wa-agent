'use strict';

const config = require('../config');
const logger = require('../utils/logger');

class SendQueue {
  constructor() {
    this.queue = [];
    this.running = false;
    this._sendMessageTracked = null; // lazily bound to avoid a require cycle
  }

  /**
   * whatsapp.js calls this once at startup so the queue can cache outgoing
   * messages (needed for Baileys' getMessage retry/resend path when
   * delivering to participants other than yourself).
   */
  setTransport(sendMessageTracked) {
    this._sendMessageTracked = sendMessageTracked;
  }

  /**
   * @param {Function} sockGetter
   * @param {string} jid
   * @param {object} content
   * @param {(sentMsg: object|null) => void} [onSent] - called after a successful
   *   send with whatever the send resolved to (so callers can capture the
   *   outgoing wa_message_id, e.g. for echo-detection).
   */
  push(sockGetter, jid, content, onSent) {
    this.queue.push({ sockGetter, jid, content, attempt: 0, onSent });
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
        const sent = this._sendMessageTracked
          ? await this._sendMessageTracked(sock, job.jid, job.content)
          : await sock.sendMessage(job.jid, job.content);
        if (typeof job.onSent === 'function') {
          try {
            job.onSent(sent);
          } catch (cbErr) {
            logger.warn({ err: cbErr.message }, 'sendQueue onSent callback failed');
          }
        }
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
