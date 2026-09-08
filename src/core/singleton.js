'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');

const LOCK_PATH = path.join(path.dirname(config.storage.dbPath), 'bot.lock');
const IS_WINDOWS = process.platform === 'win32';

function isPidAliveWindows(pid) {
  try {

    const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 5000,
    });
    return out.toLowerCase().includes(String(pid));
  } catch (err) {

    logger.warn({ err: err.message }, 'tasklist check failed, assuming PID not alive');
    return false;
  }
}

function isPidAlivePosix(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
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