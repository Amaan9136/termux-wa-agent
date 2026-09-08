'use strict';

const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const buildSystemPrompt = require('../prompts/systemPrompt');

function truncate(text, maxChars) {
  if (!text) return text;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1).trimEnd() + '…';
}

class OllamaClient {
  constructor() {
    this.baseUrl = config.llm.ollamaBaseUrl.replace(/\/+$/, '');
    this.textModel = config.llm.textModel;
    this.timeoutMs = config.llm.timeoutMs;
  }

  async _post(payload) {
    const url = `${this.baseUrl}/api/generate`;
    const res = await axios.post(url, { ...payload, stream: false }, { timeout: this.timeoutMs });
    return (res.data && res.data.response ? res.data.response : '').trim();
  }

  async generate({ systemPrompt, prompt }) {
    const model = this.textModel;
    const payload = {
      model,
      system: systemPrompt || buildSystemPrompt(false),
      prompt,
    };

    try {
      const raw = await this._post(payload);
      return truncate(raw, config.llm.maxOutputChars);
    } catch (err) {
      logger.error({ err: err.message, model }, 'LLM generate() failed');
      if (err.code === 'ECONNREFUSED') {
        throw new Error('LLM backend unreachable. Is `ollama serve` running?');
      }
      if (err.response && err.response.status === 404) {
        throw new Error(`Model "${model}" not found in Ollama. Pull it first: ollama pull ${model}`);
      }
      throw new Error(`LLM error: ${err.message}`);
    }
  }

  async summarize({ previousSummary, transcript, maxChars }) {
    const prompt = [
      'Condense the following into an updated running summary of this conversation.',
      'Keep names, decisions, tasks, and preferences. Drop small talk. Be terse.',
      `Target length: under ${maxChars} characters.`,
      '',
      previousSummary ? `Existing summary:\n${previousSummary}\n` : '',
      `New messages to fold in:\n${transcript}`,
    ].filter(Boolean).join('\n');

    const raw = await this._post({
      model: this.textModel,
      system: 'You are a precise summarization engine. Output only the summary text, no preamble.',
      prompt,
    });
    return truncate(raw, maxChars);
  }
}

let singleton = null;
function createLlmClient() {
  if (singleton) return singleton;
  if (config.llm.provider !== 'ollama') {
    logger.warn({ provider: config.llm.provider }, 'Unknown LLM_PROVIDER, defaulting to ollama implementation');
  }
  singleton = new OllamaClient();
  return singleton;
}

module.exports = { createLlmClient };