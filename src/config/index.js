'use strict';

require('dotenv').config();
const path = require('path');

function bool(val, def = false) {
  if (val === undefined || val === null || val === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(val).toLowerCase());
}

function int(val, def) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : def;
}

const OWNER_NUMBER = (process.env.OWNER_NUMBER || '').replace(/[^\d]/g, '');
const OWNER_JID = process.env.OWNER_JID && process.env.OWNER_JID.trim()
  ? process.env.OWNER_JID.trim()
  : (OWNER_NUMBER ? `${OWNER_NUMBER}@s.whatsapp.net` : '');

const root = path.resolve(__dirname, '..', '..');

const config = {
  root,
  botName: process.env.BOT_NAME || 'WA-Agent',

  owner: {
    number: OWNER_NUMBER,
    jid: OWNER_JID,
    name: (process.env.OWNER_NAME || '').trim() || 'Owner',
    bio: (process.env.OWNER_BIO || '').trim(),
  },

  auth: {
    method: (process.env.AUTH_METHOD || 'pairing').toLowerCase(),
    dir: path.resolve(root, process.env.AUTH_DIR || './data/auth_info'),
  },

  llm: {
    provider: process.env.LLM_PROVIDER || 'ollama',
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    textModel: process.env.OLLAMA_TEXT_MODEL || 'gpt-oss:20b-cloud',
    timeoutMs: int(process.env.LLM_TIMEOUT_MS, 120000),
    maxOutputChars: int(process.env.LLM_MAX_OUTPUT_CHARS, 1500),
  },

  storage: {
    dbPath: path.resolve(root, process.env.DB_PATH || './data/agent.db'),
    mediaDir: path.resolve(root, process.env.MEDIA_DIR || './media'),
  },

  memory: {
    recentWindowSize: int(process.env.RECENT_WINDOW_SIZE, 12),
    summaryTriggerCount: int(process.env.SUMMARY_TRIGGER_COUNT, 40),
    summaryMaxChars: int(process.env.SUMMARY_MAX_CHARS, 2000),
  },

  groups: {
    defaultMode: (process.env.DEFAULT_GROUP_MODE || 'mention').toLowerCase(),
    massMentionThreshold: int(process.env.GROUP_MASS_MENTION_THRESHOLD, 5),
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: path.resolve(root, process.env.LOG_DIR || './logs'),
  },

  sendQueue: {
    minIntervalMs: int(process.env.SEND_MIN_INTERVAL_MS, 800),
    maxRetries: int(process.env.SEND_MAX_RETRIES, 3),
  },

  alerts: {
    onCrash: bool(process.env.ALERT_OWNER_ON_CRASH, true),
    minIntervalMs: int(process.env.ALERT_MIN_INTERVAL_MS, 60000),
    dedupWindowMs: int(process.env.ALERT_DEDUP_WINDOW_MS, 600000),
  },

  runtime: {
    backlogGraceMs: int(process.env.BACKLOG_GRACE_MS, 10000),
  },
};

module.exports = config;