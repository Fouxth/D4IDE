# D4IDE — Agent-first AI Coding IDE for Windows

D4IDE is a desktop AI software engineering workspace: a dark, focused UI with multi-provider BYOK
(Bring Your Own Key) support, autonomous Plan/Build modes, a live agent timeline, safe file editing with
diff review, an embedded terminal, localhost preview, task queue, skills, MCP integration, context
management and transparent cost tracking.

---

## Key Features

- **Agent-first workflow** — autonomous multi-step loops that inspect the codebase, run terminal commands,
  plan, edit files, and run builds and tests.
- **A workspace shell built around the conversation** — open sessions are tabs across the top and square
  badges down the side rail, so switching tasks never costs you the other one; a **conversation outline**
  beside the transcript lists every turn you started, marks how each ended and jumps the transcript to it on
  click.
- **A transcript you can actually read** — each tool call is one line (verb, target, outcome), a burst of
  steps folds into a collapsible *Run*, reasoning collapses to a single line, and the full command,
  arguments and output appear only when a row is opened. Prose stays prose, your prompts stay bubbles.
- **Two workspace modes** — *Agent View* (conversation, todos, plan approval) and *Code View* (Monaco editor,
  tabs, diff viewer, explorer, terminal) — switchable from the overflow menu, the status bar or Ctrl+B.
- **Settings that live where you choose them** — provider/model, reasoning effort, permission level and the
  running session cost sit in the composer footer; the status bar keeps identity, project, git and state.
  Nothing in the UI is on a clock: a run ends when it ends, and usage is measured in tokens and money.
- **Plan Mode & Build Mode** — read-only inspection producing a structured plan (steps, affected files,
  scope, risk) that waits for your approval before a single file changes.
- **Provider Hub** — **52 provider presets out of the box**: OpenAI, Anthropic, Google Gemini, DeepSeek,
  xAI, Mistral, Cohere, Perplexity, Groq, Cerebras, Together, DeepInfra, Fireworks, Novita, Nebius, Baseten,
  Chutes, NVIDIA NIM, Hugging Face, DigitalOcean, SiliconFlow, Alibaba DashScope, Moonshot, Z.ai, MiniMax,
  ModelScope, GitHub Copilot, the Kimi/GLM/MiniMax/Qwen coding plans, the aggregators (OpenRouter, Kilo,
  Requesty, Helicone, LLM Gateway, Nano-GPT, Eden AI, 302.AI), **OpenCode Zen** and **OpenCode Go**, plus
  Ollama and LM Studio locally — and any OpenAI-compatible endpoint you add yourself. The list is generated
  from the same model registry the OpenCode CLI uses (`pnpm providers:sync`) and every endpoint is probed by
  `pnpm providers:check`, which also reports when a provider stops serving a model we still list.
- **Four wire protocols, not one** — chat-completions, Anthropic Messages, Google Gemini and OpenAI's
  **Responses API**, each with its own adapter and stream parser. This is what makes the newest models
  usable at all: on OpenCode's gateways every GPT and Grok model answers only on `/responses`, Claude and
  Qwen only on `/messages`, and Gemini on Google's shape — one key, three protocols, so each gateway ships
  one preset per family with only the models that answer on it.
- **Model selection & Auto ✨ routing** — searchable picker with capability badges, favorites and recents;
  Auto routing profiles (Best quality / Balanced / Lowest cost / Fastest) with an explanation of every
  choice, plus provider failover.
- **Usage & cost transparency** — session, daily and monthly spend, input/output/**cached** token
  breakdowns, per-provider/model/project reports, configurable budgets with warnings and optional
  automatic stop.
- **Approval gate & audit trail** — Safe / Ask / Full Access tiers that actually pause the agent for your
  decision, with an audit log of every tool call, and hard guardrails that block destructive commands in
  every mode.
- **Checkpoints that restore** — files are snapshotted before edits, so any change can be restored even in
  a project that is not a Git repository. Snapshots are absolute paths recorded in an earlier session, so a
  restore only writes files that resolve **inside the project open right now**; anything else is reported as
  skipped instead of silently overwriting a sibling folder.
- **Subagents** — delegate to a specialised helper (Explore, Review, Test, Debug, Frontend, Database) that
  runs its own bounded loop with a role-specific prompt and a restricted tool set. Only its report returns
  to the main conversation, so long investigations stop flooding the context.
- **Browser tools & visual verification** — the agent can drive a headless browser against your dev server:
  navigate, inspect rendered text, click, fill, read console errors and capture screenshots (shown inline
  in the timeline). Sandboxed to localhost, your private network and files inside the project.
- **Sessions you can reopen** — every run writes a live transcript, so a finished or crashed session can be
  replayed from Settings → Sessions. On startup D4IDE offers to continue the session that never finished,
  and the model is handed the earlier conversation — not just the old timeline.
- **Task queue** — line up work while the agent is busy. Each entry keeps its own Plan/Build mode; you can
  reorder, edit, pause the whole queue, retry a failed task, mark one done or clear the finished ones. The
  next task starts by itself unless the queue is paused.
- **Mission** — a persistent statement of what the project is for (goal, constraints, success criteria, key
  files), injected into the agent's system prompt so long sessions do not drift away from your intent.
- **Images in the prompt** — paste or drop a screenshot into the composer and it is sent to vision-capable
  models across all three adapter families.
- **Notifications** — native desktop notifications when a task finishes, an approval is waiting or a budget
  threshold is hit — one per event, never a wall of popups.
- **Structured logs** — four separate streams (app, agent, provider, terminal) written to rotating files and
  viewable in Settings → Logs with level, channel and text filters. Every line is redacted on the way in, so
  an API key can never reach a log file.
- **Crash recovery** — unfinished sessions are offered for replay on startup, and unsaved editor buffers are
  snapshotted so a crash does not cost you the lines you had typed.
- **Updates** — `electron-updater` is wired up for signed release feeds, with the update state surfaced in
  Settings → Update.
- **A layout you control** — the icon rail, explorer, right sidebar and terminal can each be hidden, the two
  side panels are drag-resizable, and every panel has a command-palette entry.
- **True-black theme** — a near-black canvas with charcoal panels and a single teal accent, built on CSS
  variable design tokens (D4 Dark and D4 Light are the two shipped themes).
- **Thai & English UI** — live language switching, persisted across sessions, with parity-checked
  translation files.
- **Security by design** — API keys encrypted with Windows DPAPI, never sent to the renderer; renderer runs
  context-isolated and sandboxed.
- **Extensibility** — user skills in `.d4ide/skills/*.md`, MCP servers via `.d4ide/mcp.json` (stdio
  **or** streamable HTTP with headers), managed in Settings → MCP servers, and `.d4ideignore` for excluding
  files from search and context.

---

## Getting Started

### Prerequisites

- Node.js **24.x LTS** (built and tested on 24.21.0; 20.x still runs the app, but its bundled Corepack is too old — see the next line)
- pnpm 12.4.2, pinned in `package.json` so Corepack provides exactly that version
- Corepack >= 0.31.0 (`npm install -g corepack@latest`) — the version bundled with Node 20.18 ships stale registry keys and fails every `pnpm` command with `Cannot find matching keyid`
- Windows 10 or 11 (x64)

### Development

```bash
# 1. Install dependencies
pnpm install

# 2. Start development mode
pnpm dev
```

### Optional native modules

D4IDE runs without either of these, but they unlock extra capability:

| Module | Unlocks | Without it |
|---|---|---|
| `better-sqlite3` | SQLite storage for usage, sessions, audit and checkpoints | the same data is stored as JSON |
| `node-pty` | Real PTYs: interactive programs, terminal resize, correct colours | terminals run over pipes |

The browser tools need Microsoft Edge or Google Chrome installed (Edge ships with Windows). They are driven
by `playwright-core`, which comes with D4IDE as a normal dependency and launches your existing browser — no
150 MB browser download. Every browser tool is sandboxed: only `localhost`, private addresses and `file://`
URLs inside the current project can be opened; `fetch_url` remains the way to read public documentation.

They are declared as `optionalDependencies`, so a failed native build never blocks an install — the app just uses the fallback column above. Native modules must be built for **Electron's** ABI, not Node's, so after installing run:

```bash
pnpm rebuild:native   # fetches prebuilt binaries for the Electron version in devDependencies
pnpm native:check     # loads them inside the real Electron runtime and reports OK/FAILED
```

After `pnpm dist`, `pnpm native:check:packaged` runs the same verification against the build in `release/win-unpacked/` — it catches problems that only appear once the app is packaged, such as a module missing from `asarUnpack`. It also launches Edge headless through the packaged `playwright-core` and reads a page back, which is the only way to prove the browser tools work in the shipped app rather than just in development.

`rebuild:native` deliberately skips `node-pty`: it is built with Node-API, so its shipped prebuild already loads in every supported runtime, and rebuilding it from source would require a full C++ toolchain. `better-sqlite3` uses the raw V8 ABI and therefore *does* get a per-runtime binary — `prebuild-install` fetches it, so no Visual Studio installation is needed.

Note that once `better-sqlite3` is built for Electron it can no longer be loaded by plain Node, so `pnpm test` intentionally runs against the JSON storage fallback (the warning it prints is expected). `pnpm dist` runs `rebuild:native` for you; electron-builder's own dependency rebuild is disabled (`build.npmRebuild: false`) because its bundled node-gyp only understands Visual Studio up to 2022 and would abort the packaging step on newer toolchains.

### Running tests

```bash
pnpm test             # 179 tests: agent loop, permissions, browser sandbox, subagents, session replay,
                      # queue state, checkpoint-restore policy, completion summaries, log redaction,
                      # provider presets and request headers, ignore rules, routing and cost maths
pnpm typecheck

# Provider catalogue maintenance (network, no API key needed)
pnpm providers:check  # probe all 48 provider endpoints and report model drift
pnpm providers:sync   # regenerate the presets from the model registry
```

### Building & packaging

```bash
# Build production bundle
pnpm build

# Rebuild native modules, bundle, and generate the Windows installer
pnpm dist
```

The installer is written to `release/D4IDE-Setup.exe` and the unpacked app to `release/win-unpacked/`. `dist` runs `rebuild:native` first because electron-builder's own rebuild is turned off.

---

## Project structure

```text
D4IDE/
├── .d4ide/                 # Project rules, skills and MCP configuration
│   ├── rules.md
│   ├── skills/
│   └── mcp.json
├── src/
│   ├── main/               # Electron main process
│   │   ├── ai/
│   │   │   ├── agent/      # Agent runtime (plan/build loops, approvals), subagents, session replay
│   │   │   ├── context/    # Rules, mentions, secret redaction
│   │   │   ├── providers/  # Adapters, catalog, manager, auto-router
│   │   │   ├── tools/      # Tool registry
│   │   │   └── usage/      # Cost, aggregation, budgets
│   │   ├── browser/        # Playwright-based, sandboxed page automation
│   │   ├── checkpoints/    # Restore policy (what a snapshot may overwrite)
│   │   ├── database/       # AppDataStore + optional SQLite backend
│   │   ├── filesystem/     # Tree, gitignore-aware search, watcher
│   │   ├── git/            # Native Git wrapper
│   │   ├── ipc/            # Typed IPC handlers
│   │   ├── logging/        # Channel-based structured logs with redaction
│   │   ├── mcp/            # MCP stdio client
│   │   ├── notifications/  # Native desktop notifications
│   │   ├── security/       # Key encryption, permission engine
│   │   ├── terminal/       # node-pty terminal with pipe fallback
│   │   └── updater/        # electron-updater integration
│   ├── preload/            # Context-isolated bridge
│   ├── renderer/           # React 18 + Vite frontend
│   │   ├── components/     # TitleBar, LeftNav, StatusBar, ToastHost
│   │   ├── features/       # agent, providers, usage, editor, explorer,
│   │   │                   # terminal, right-sidebar, settings, onboarding
│   │   ├── locales/        # Thai (th.json) and English (en.json)
│   │   └── stores/         # Zustand state
│   └── shared/             # Shared types & IPC contracts
├── docs/                   # architecture, providers, security, build notes
├── tests/                  # Vitest suites
└── package.json
```

---

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — subsystem map and task data flow
- [`docs/providers.md`](docs/providers.md) — provider hub, model discovery, auto routing, pricing
- [`docs/security.md`](docs/security.md) — key handling, approvals, guardrails, browser sandbox, audit trail
- [`docs/build-windows.md`](docs/build-windows.md) — packaging notes

---

## License

Proprietary — Developed for D4IDE.
