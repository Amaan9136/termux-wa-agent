# termux-wa-agent

Personal WhatsApp AI assistant/manager. Node.js only. Runs in Termux on Android.
Talks to WhatsApp via Baileys, thinks via a local Ollama model, remembers via SQLite.

## Architecture

```
src/
  config/      env parsing, single source of truth for all settings
  core/        WhatsApp socket (Baileys), message handler, send queue, commands
  services/    LLM client, memory builder, alerts, reminder poller
  agents/      router: decides skill vs direct reply
  skills/      reminder, memory write/lookup, group manage, brb/status, summarizer, link save
  store/       SQLite repositories (chats, messages, memory, dedupe, reminders, links, bot state)
  prompts/     system prompt text
```

Flow: `whatsapp.js` receives a message -> `messageHandler.js` dedupes it, stores it,
applies group gating -> `commands.js` handles `/help` etc, otherwise `router.js`
checks skills in order, falls back to `llm.js` for a direct reply -> `sendQueue.js`
sends it back, throttled and retried.

### Why SQLite

Single file, zero external service, fast (`better-sqlite3` is synchronous and
in-process), survives Termux app restarts, and trivial to inspect/back up.
A per-chat config table plus an append-only messages table covers everything
this bot needs without the overhead of running a DB server on a phone.

### How memory works

Each chat has:
- a **rolling summary** (text column, updated by the LLM as old messages age out)
- a **recent window** (last N raw messages, kept verbatim)

Every reply prompt = `rolling_summary + recent window + new message`. Once a
chat accumulates more than `SUMMARY_TRIGGER_COUNT` raw messages, the oldest
batch is folded into the summary and deleted from the messages table. This
keeps prompt size and DB size roughly constant no matter how long a chat runs,
which matters on a phone. If the LLM is unreachable during a roll-up, a naive
text-concatenation fallback is used instead of losing the batch.

### How skills work

A skill is `{ name, description, match(ctx), run(ctx) }`. The router tries
each skill's `match()` in order; the first match wins and its `run()` result
is sent back. If nothing matches, the message goes to the LLM directly with
full chat context. Skills live in `src/skills/`, registered in `src/skills/index.js`.
Add a new skill by dropping a file there and requiring it in the index.

Included skills: reminder, memory write, memory lookup, group management
(owner-only), BRB/status (owner-only), summarizer, link save (auto-captures
any URL shared in a chat, plus `/links` to list them).

Images: captions are read and stored; no vision model is wired up currently
(disabled per configuration). `OLLAMA_VISION_MODEL` in `.env` is the hook —
set it once you have a vision-capable model pulled, and `llm.js` will route
image messages to it automatically without any other code changes.

## Termux setup

```bash
pkg update -y && pkg upgrade -y
pkg install -y nodejs-lts git
git clone https://github.com/Amaan9136/termux-wa-agent.git
cd termux-wa-agent
npm install
cp .env.example .env
nano .env   # fill in your values (owner number, model name, etc.)
npm run migrate
npm start
```

On first run with `AUTH_METHOD=pairing`, a pairing code prints in the
terminal — enter it in WhatsApp under Linked Devices. Session is saved to
`data/auth_info/` so you won't need to re-pair on restart.

Run `ollama serve` (and have your model pulled, e.g. `ollama pull gpt-oss:20b-cloud`)
before starting the bot, on whatever machine/terminal Ollama runs on — the
bot just needs `OLLAMA_BASE_URL` to reach it.

## Configuration

Edit `.env` (see `.env.example` for full list). Key values:

- `OWNER_NUMBER` — your number, digits only, used for pairing + owner checks
- `OLLAMA_TEXT_MODEL` — model name as known to your Ollama instance
- `DEFAULT_GROUP_MODE` — `off` by default; new groups are ignored until whitelisted
- `RECENT_WINDOW_SIZE` / `SUMMARY_TRIGGER_COUNT` — tune memory size vs prompt cost

## Commands

- `/help`, `/status`, `/reset`, `/memory show`, `/memory clear`
- `/group whitelist|blacklist|unwhitelist|unblacklist|on|off|mention [jid]` — owner only
- `/brb on|off [message]`, `/status set <text>` — owner only
- `/links` — list saved links for the current chat

## Group safety

Every group defaults to `ai_enabled = 0` on first contact. Owner whitelists a
group with `/group whitelist` (run inside the group, or pass a JID). Mention-only
mode (`/group mention`) makes the bot only respond when the owner is @mentioned
or the message is a command — useful for groups where you want help on-demand
without the bot replying to everyone.

## Extending

- New skill: add a file to `src/skills/`, export `{name, description, match, run}`,
  register it in `src/skills/index.js`.
- New LLM provider: implement `generate()` / `summarize()` like `OllamaClient`
  in `src/services/llm.js`, swap it in `createLlmClient()`.
- Documents/audio: `extractMessageContent()` in `src/core/whatsapp.js` already
  tags these types; add storage/handling the same way images are handled.

## Notes on Claude/GitHub workflow

Plain Claude.ai web chat cannot push commits or open PRs directly — there is
no GitHub write access from that surface. This repo's code was generated in
chat and must be pushed manually (or via Claude Code / Claude in Chrome with
GitHub access, which can edit and open PRs directly if you want that later).
A CI stub is included at `.github/workflows/ci.yml` with a placeholder for
wiring up Claude-assisted PR review in future.
