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

## CHANGELOG (this revision)

- **Fixed: self-chat commands (e.g. `/help`) got no reply.** The handler had a
  blanket `if (fromMe) return;` which also silently dropped every message the
  owner typed into their OWN self-chat (message-yourself), since WhatsApp
  marks those `fromMe: true` too. Now only genuine bot-echo messages are
  skipped; owner self-chat messages are processed normally.
- **Fixed: messages not reliably delivered to other participants/contacts.**
  Added a `getMessage` cache + a real browser identity (`Browsers.ubuntu`) to
  the Baileys socket config. Without `getMessage`, Baileys can't resend when
  a recipient's session needs a fresh prekey handshake — sends can silently
  vanish for anyone other than yourself. `sendQueue` now routes all sends
  through `whatsapp.sendMessageTracked()` so every outgoing message gets
  cached for this purpose.
- Normalized `OWNER_NUMBER` parsing to strip `+`, spaces, and dashes robustly.
- No video-handling code existed anywhere in the codebase to begin with —
  media types are image/document/audio only, so there was nothing to remove.

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
terminal — enter it in WhatsApp under Linked Devices.

Run `ollama serve` (with your model pulled) on whichever machine Ollama runs
on — the bot just needs `OLLAMA_BASE_URL` to reach it.

## Testing self-chat commands

To test `/help` and other commands from your own phone: open your OWN chat
in WhatsApp (message yourself) and type `/help`. This now works correctly —
previously it silently did nothing due to the `fromMe` bug described above.

To test group/other-contact delivery: `/group whitelist` in a group you own,
then have someone else message or @mention the bot there.

## Configuration

Edit `.env` (see `.env.example`). Key values:

- `OWNER_NUMBER` — your number, digits only (any `+`/spaces/dashes are stripped automatically)
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
group with `/group whitelist`. Mention-only mode (`/group mention`) makes the
bot only respond when the owner is @mentioned or the message is a command.

## Extending

- New skill: add a file to `src/skills/`, export `{name, description, match, run}`,
  register it in `src/skills/index.js`.
- New LLM provider: implement `generate()` / `summarize()` like `OllamaClient`
  in `src/services/llm.js`, swap it in `createLlmClient()`.
