# termux-wa-agent

Personal WhatsApp AI assistant/manager. Node.js only, text-only. Runs in Termux on Android or on Windows/Linux for local testing.
Talks to WhatsApp via Baileys, thinks via a local Ollama model, remembers via SQLite.

## Architecture

```
src/
  config/      env parsing, single source of truth for all settings
  core/        WhatsApp socket (Baileys), message handler, send queue, commands, singleton lock
  services/    LLM client, memory builder, alerts, reminder poller
  agents/      router: decides skill vs direct reply
  skills/      reminder, memory write/lookup, group manage, brb/status, summarizer, link save
  store/       SQLite repositories (chats, messages, memory, dedupe, reminders, links, bot state)
  prompts/     personalized system prompt (owner name + bio)
```

Flow: `whatsapp.js` receives a message -> `messageHandler.js` dedupes it, stores it,
applies group gating -> `commands.js` handles `/help` etc, otherwise `router.js`
checks skills in order, falls back to `llm.js` for a direct reply -> `sendQueue.js`
sends it back, throttled and retried.

## CHANGELOG (this revision)

- **Fixed: repeated/spammed alerts to the owner.** `alertOwner()` had no
  rate limiting at all - a crash loop (fatal disconnect, or repeated
  `uncaughtException`) fired one WhatsApp DM per event with zero delay,
  flooding the owner's chat with identical `[ALERT] ...` messages. It now
  self-throttles: a hard floor between any two alerts (`ALERT_MIN_INTERVAL_MS`,
  default 60s) and a dedup window that drops repeats of the *same* message
  (`ALERT_DEDUP_WINDOW_MS`, default 10 min), with a "+N similar suppressed"
  note folded into the next alert that does go through. Alerts are now also
  routed through `sendQueue` instead of calling `sock.sendMessage` directly,
  so they behave consistently with every other outgoing message.
- **Fixed: replies sent immediately after connecting could silently vanish.**
  Right after a fresh pairing/reconnect, Baileys/WhatsApp go through a burst
  of Signal session renegotiation (`Closing session: ...` console lines from
  libsignal-node - normal, not an error). Messages sent to *any* chat,
  including your own self-chat, during that churn window can be dropped by
  WhatsApp's servers even though `sock.sendMessage()` resolves without
  throwing. This is why a `/help` sent right after connecting could get no
  reply at all. Outgoing sends now wait for a short settle window
  (`connectionStableSince` + 4s) after `connection: open` before attempting
  delivery.
- **Fixed: singleton PID-lock was POSIX-only.** `process.kill(pid, 0)` and
  the `EPERM`-means-alive fallback are UNIX signal semantics that don't
  translate cleanly to Windows. The lock now branches on `process.platform`
  and uses `tasklist` to check PID liveness on Windows, so testing on
  Windows and running production in Termux/Linux both work correctly
  without false "another instance is running" refusals or false negatives.
- **Removed: all vision/image/document/audio handling.** This is now a
  strictly text-only assistant. Removed: `OLLAMA_VISION_MODEL` config,
  `downloadMediaMessage`/`saveIncomingImage`, image `caption` handling,
  `imagePath` threading through the router/LLM client, and the
  vision-vs-text model branch in `llm.js`. Incoming images/documents/audio
  now get a short "text-only assistant" reply instead of being processed.
  `caption`/`media_path` columns remain in the SQLite schema for backward
  compatibility with existing databases, but nothing writes to them anymore.
- **Added: owner personalization.** New `OWNER_NAME` and `OWNER_BIO` env
  vars. The system prompt now addresses the owner by name
  (`You are a personal WhatsApp assistant for your owner "Amaan"...`) and,
  if `OWNER_BIO` is set, includes a short paragraph of background so the
  assistant can personalize replies. `/help` and `/status` also mention the
  owner's name.
- Normalized `OWNER_NUMBER` parsing to strip `+`, spaces, and dashes robustly.

### Why SQLite

Single file, zero external service, fast (synchronous, in-process via
`node:sqlite`), survives Termux app restarts, and trivial to inspect/back up.

### How memory works

Each chat has:
- a **rolling summary** (text column, updated by the LLM as old messages age out)
- a **recent window** (last N raw messages, kept verbatim)

Every reply prompt = `rolling_summary + recent window + new message`. Once a
chat accumulates more than `SUMMARY_TRIGGER_COUNT` raw messages, the oldest
batch is folded into the summary and deleted from the messages table.

### How skills work

A skill is `{ name, description, match(ctx), run(ctx) }`. The router tries
each skill's `match()` in order; the first match wins. If nothing matches,
the message goes to the LLM directly with full chat context.

Included skills: reminder, memory write, memory lookup, group management
(owner-only), BRB/status (owner-only), summarizer, link save.

### Text-only

There is no image, document, or audio processing anywhere in this codebase.
Incoming media gets a short reply explaining the assistant is text-only.
There is no `OLLAMA_VISION_MODEL` and no media download pipeline.

## Setup (Termux, Android)

```bash
pkg update -y && pkg upgrade -y
pkg install -y nodejs-lts git
git clone https://github.com/Amaan9136/termux-wa-agent.git
cd termux-wa-agent
npm install
cp .env.example .env
nano .env   # fill in your values (owner number/name/bio, model name, etc.)
npm run migrate
npm start
```

On first run with `AUTH_METHOD=pairing`, a pairing code prints in the
terminal - enter it in WhatsApp under Linked Devices.

Run `ollama serve` (with your model pulled) on whichever machine Ollama runs
on - the bot just needs `OLLAMA_BASE_URL` to reach it.

## Setup (Windows, for local testing)

Requires Node.js 22.5+ (for `node:sqlite`).

```powershell
git clone https://github.com/Amaan9136/termux-wa-agent.git
cd termux-wa-agent
npm install
copy .env.example .env
notepad .env
npm run migrate
npm start
```

The singleton lock and reconnect logic both work the same way on Windows as
on Termux/Linux; PID liveness is checked via `tasklist` on Windows and
`process.kill(pid, 0)` on POSIX.

## Testing self-chat commands

To test `/help` and other commands from your own phone: open your OWN chat
in WhatsApp (message yourself) and type `/help`. Note: right after a fresh
pairing/connect, wait a few seconds before testing - the bot intentionally
delays sends briefly while the WhatsApp session stabilizes, to avoid replies
getting silently dropped during that window.

To test group/other-contact delivery: `/group whitelist` in a group you own,
then have someone else message or @mention the bot there.

## Admin CLI

When you run `npm start` in an interactive terminal, an `admin> ` prompt
starts alongside the WhatsApp connection (no need to wait for pairing).
Type anything there - `/help`, `/status`, `/group whitelist <jid>`, plain
chat, anything the owner could send over WhatsApp - and it's handled by the
exact same command/skill/router logic, then printed straight to the
terminal. It shares state (chat history, memory notes, BRB/status) with
your own WhatsApp self-chat, so `/reset` or `/memory clear` from the CLI
also clears that self-chat's history, and vice versa. It only starts when
stdin is a real TTY, so it's skipped automatically under a background
service/non-interactive process.

## Configuration

Edit `.env` (see `.env.example`). Key values:

- `OWNER_NUMBER` - your number, digits only (any `+`/spaces/dashes are stripped automatically)
- `OWNER_NAME` - your first name, used in the system prompt and owner-facing text
- `OWNER_BIO` - a free-form paragraph about you, folded into the system prompt for personalization
- `OLLAMA_TEXT_MODEL` - model name as known to your Ollama instance
- `DEFAULT_GROUP_MODE` - `off` by default; new groups are ignored until whitelisted
- `RECENT_WINDOW_SIZE` / `SUMMARY_TRIGGER_COUNT` - tune memory size vs prompt cost
- `ALERT_MIN_INTERVAL_MS` / `ALERT_DEDUP_WINDOW_MS` - tune how aggressively crash alerts to the owner are throttled

## Commands

- `/help`, `/status`, `/reset`, `/memory show`, `/memory clear`
- `/group whitelist|blacklist|unwhitelist|unblacklist|on|off|mention [jid]` - owner only
- `/brb on|off [message]`, `/status set <text>` - owner only
- `/links` - list saved links for the current chat

## Group safety

Every group defaults to `ai_enabled = 0` on first contact. Owner whitelists a
group with `/group whitelist`. Mention-only mode (`/group mention`) makes the
bot only respond when the owner is @mentioned or the message is a command.

## Extending

- New skill: add a file to `src/skills/`, export `{name, description, match, run}`,
  register it in `src/skills/index.js`.
- New LLM provider: implement `generate()` / `summarize()` like `OllamaClient`
  in `src/services/llm.js`, swap it in `createLlmClient()`.