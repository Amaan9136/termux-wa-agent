'use strict';

/**
 * Prevents two instances of this bot from running concurrently against the
 * same data/auth_info session. Running two Baileys sockets on one WhatsApp
 * multi-device session corrupts the Signal double-ratchet state (you'll see
 * "SessionCipher.doDecryptWhisperMessage" errors and repeated forced
 * disconnects with status codes like 408/428/440) because WhatsApp's
 * servers only tolerate one live connection per session and each process
 * ends up with divergent in-memory crypto state.
 *
 * This is a simple PID-based lockfile: on startup we check for an existing
 * lock, verify whether that PID is actually still alive, and refuse to
 * start if so. On clean shutdown (SIGINT/SIGTERM) or normal exit we remove
 * our own lock.
 *
 * CROSS-PLATFORM NOTE: process.kill(pid, 0) is a POSIX signal-probe idiom.
 * On Windows, Node emulates it reasonably well (ESRCH-style behavior via
 * libuv), but the old `err.code === 'EPERM'` "must be alive" fallback is a
 * POSIX-only assumption (a process owned by another user). On Windows,
 * permission-denied looks different and treating it as "still alive" can
 * wrongly refuse to start after a crash. We now branch on process.platform
 * and use a Windows-appropriate check (tasklist) instead of guessing from
 * signal error codes.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');

const LOCK_PATH = path.join(path.dirname(config.storage.dbPath), 'bot.lock');
const IS_WINDOWS = process.platform === 'win32';

function isPidAliveWindows(pid) {
  try {
    // tasklist filters by PID; if the PID exists, its line appears in output.
    const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 5000,
    });
    return out.toLowerCase().includes(String(pid));
  } catch (err) {
    // If tasklist itself fails (e.g. missing/PATH issue), fail safe: assume
    // NOT alive rather than blocking startup forever on an unrelated error.
    logger.warn({ err: err.message }, 'tasklist check failed, assuming PID not alive');
    return false;
  }
}

function isPidAlivePosix(pid) {
  try {
    process.kill(pid, 0); // signal 0: no-op, just checks existence/permission
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists but owned by another user - treat as alive
  }
}

function isPidAlive(pid) {
  return IS_WINDOWS ? isPidAliveWindows(pid) : isPidAlivePosix(pid);
}

function acquireLock() {
  if (fs.existsSync(LOCK_PATH)) {
    const raw = fs.readFileSync(LOCK_PATH, 'utf8').trim();
    const existingPid = parseInt(raw, 10);
    if (Number.isFinite(existingPid) && isPidAlive(existingPid)) {
      logger.fatal(
        { existingPid },
        `Another bot instance appears to be running (PID ${existingPid}). ` +
        `Refusing to start a second instance against the same WhatsApp session - ` +
        `running two at once corrupts the encryption session and causes ` +
        `"SessionCipher" decrypt errors and reconnect loops. ` +
        `If that PID is actually dead, delete ${LOCK_PATH} and try again.`
      );
      const killHint = IS_WINDOWS
        ? `taskkill /PID ${existingPid} /F`
        : `kill ${existingPid}`;
      console.error(
        `\n[FATAL] Another bot instance seems to be running (PID ${existingPid}).\n` +
        `Run: ${killHint}   (or if you're sure it's gone: delete ${LOCK_PATH})\n` +
        `Then start the bot again.\n`
      );
      process.exit(1);
    }
    // Stale lock (process no longer alive) - safe to overwrite.
    logger.warn({ stalePid: existingPid }, 'Removing stale lockfile from a dead process');
  }
  fs.writeFileSync(LOCK_PATH, String(process.pid), 'utf8');
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_PATH)) {
      const raw = fs.readFileSync(LOCK_PATH, 'utf8').trim();
      if (raw === String(process.pid)) {
        fs.unlinkSync(LOCK_PATH);
      }
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to release lockfile cleanly');
  }
}

function installShutdownHooks() {
  const cleanExit = (signal) => {
    logger.info({ signal }, 'Shutting down, releasing lock');
    releaseLock();
    process.exit(0);
  };
  process.on('SIGINT', () => cleanExit('SIGINT'));
  process.on('SIGTERM', () => cleanExit('SIGTERM'));
  process.on('exit', releaseLock);
}

module.exports = { acquireLock, releaseLock, installShutdownHooks, LOCK_PATH };
