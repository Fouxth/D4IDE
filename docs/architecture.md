# D4IDE Architecture Documentation

## Overview

D4IDE is an agent-first desktop workspace built on Electron, React 18, TypeScript and Vite. The agent
runtime lives entirely in the main process; the renderer is a thin, strictly-typed view over it.

```text
┌──────────────────────────────────────────────────────────────┐
│                          Renderer UI                         │
│   React 18 · Zustand · Tailwind · Monaco · xterm.js          │
│   features/{agent,providers,usage,editor,terminal,…}         │
└───────────────────────────┬──────────────────────────────────┘
                            │ typed IPC bridge (contextBridge)
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                       Preload script                         │
│          contextIsolation · sandbox · no Node access          │
└───────────────────────────┬──────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                    Main process (runtime)                    │
│                                                              │
│  AgentRuntime ──► ProviderManager ──► adapters                │
│      │              (openai-compatible / anthropic / gemini)  │
│      │              ProviderRouter (auto model selection)     │
│      ├────────► ToolRegistry ──► file / terminal / git / MCP  │
│      ├────────► PermissionEngine ──► approval gate + audit    │
│      ├────────► ContextEngine ──► rules · mentions · secrets   │
│      └────────► UsageService ──► cost · budgets · aggregation │
│                                                              │
│  Services: FileService · FileWatcher · GitService ·           │
│            TerminalService · McpClient · KeyStorage           │
│  Storage:  AppDataStore (JSON) ──► SqliteRepo (optional)      │
└──────────────────────────────────────────────────────────────┘
```

## Subsystems

### 1. Agent runtime (`src/main/ai/agent/agent-runtime.ts`)

- Owns the Plan and Build loops, streaming events (`timeline`, `status`, `todos`, `file_change`) and the
  approval handshake back to the renderer.
- **Plan Mode** runs a read-only inspection loop (tools flagged `mutating` are not offered to the model at
  all), then presents the plan for approval. Nothing is written before you approve.
- **Build Mode** loops model → tool calls → results until the model stops asking for tools, or the step
  budget is exhausted.
- Records token usage **per provider call**, including failed and cancelled ones, so cost is never lost.
- Retries transient provider failures with exponential backoff, enforces per-tool timeouts, snapshots files
  before edits, and writes an audit entry for every tool call.

### 2. Provider layer (`src/main/ai/providers/`)

| File | Responsibility |
|---|---|
| `provider-interface.ts` | `IAIProvider` contract (`listModels`, `streamChat`, `testConnection`) + HTTP error classification |
| `catalog.ts` | Shipped presets: base URLs, docs links and model metadata with prices |
| `openai-adapter.ts` | OpenAI, DeepSeek, OpenRouter, xAI, Ollama and any OpenAI-compatible endpoint |
| `anthropic-adapter.ts` | Messages API, thinking budgets, cache-token accounting |
| `gemini-adapter.ts` | `streamGenerateContent`, thoughts, cached-content tokens |
| `provider-manager.ts` | Instance lifecycle, connection tests, model discovery, usable-provider filtering |
| `router.ts` | Pure, testable scoring used by Auto model routing |

Every adapter normalises streaming text, reasoning deltas, tool calls and token usage (including cached
tokens) into the same `StreamChunk` shape.

### 3. Tool registry (`src/main/ai/tools/tool-registry.ts`)

Tools declare `name`, `description`, JSON schema, a `mutating` flag and an executor. File tools emit a
`FileChange` (with real addition/deletion counts) that drives the Changes panel and the revert action.
MCP tools are registered under qualified names (`mcp__<server>__<tool>`) plus a generic `mcp_call` bridge.

Plan mode filters on the `mutating` flag rather than a hardcoded list, so adding a tool cannot accidentally
expose it to Plan Mode.

### 4. Permission engine (`src/main/security/permission-engine.ts`)

Pure decision function: mode + tool call + optional user rules → `{ allowed, requiresApproval, reason }`.
Hard guardrails are evaluated first and cannot be overridden. The runtime is responsible for *acting* on
`requiresApproval`, which is where the approval dialog is triggered.

### 5. Context engine (`src/main/ai/context/context-engine.ts`)

Loads project rules (`D4IDE.md`, `.d4ide/rules.md`, `.cursorrules`), resolves `@file` / `@folder` / `@git`
mentions into context items, estimates tokens, and redacts detected secrets before content reaches a model.

### 6. Usage service (`src/main/ai/usage/usage-service.ts`)

Pure functions for cost (`calculateCost`), aggregation, grouping and budget evaluation, plus a thin service
that persists records and pushes a fresh summary to the renderer after every request.

### 7. Storage (`src/main/database/`)

- `store.ts` — `AppDataStore`: settings, providers (encrypted keys), checkpoints, usage, sessions, audit.
- `sqlite-store.ts` — optional `better-sqlite3` backend implementing the schema from the spec
  (`projects`, `sessions`, `messages`, `agent_events`, `tasks`, `queue_items`, `checkpoints`,
  `file_changes`, `provider_configs`, `model_configs`, `usage_records`, `tool_audit`, `skills`, `settings`).
- **Fallback:** if the native module is missing or fails to load, every collection transparently stays on
  JSON files — the app never fails to start because of a native build. Existing JSON history is migrated
  into SQLite once, on first run with the module available. `storage:info` reports which backend is live.

Data lives in `%APPDATA%/D4IDE/D4IDE_DATA/` (`settings.json`, `providers.json`, `checkpoints/`,
`d4ide.sqlite`, `sessions/`, `buffers.json`, `missions.json` and `logs/`). Settings export/import writes the
same document the store reads, so a backup is a file copy rather than a database dump.

### 8. Filesystem & watcher (`src/main/filesystem/`)

`file-service.ts` walks trees and searches while honouring `.gitignore` **and** `.d4ideignore`
(compiled into testable ignore rules). `file-watcher.ts` uses `fs.watch` with debouncing to report changes
made outside the app, which the editor surfaces as *Reload / Keep current*.

### 9. Terminal (`src/main/terminal/terminal-service.ts`)

Uses `node-pty` when the optional native module loads (real PTY: interactive programs, resize, correct
colours) and falls back to piped `child_process` shells when it does not. The UI keeps one xterm instance
per tab and forwards resize events to the backend.

### 10. MCP client (`src/main/mcp/mcp-client.ts`)

Minimal stdio JSON-RPC client: spawn, `initialize` handshake, `tools/list` discovery, `tools/call`.
Discovered tools are published into the tool registry so the agent can use them like native tools.

### 11. Subagents (`src/main/ai/agent/subagents.ts`)

A role catalogue — Explore, Review, Test, Debug, Frontend, Database — where each entry carries a label, a
one-line summary, a step budget, a `writeCapable` flag and its own system prompt. `runSubagent` in the
runtime is a nested loop: fresh message history, the same provider/abort signal/usage budget, and a tool set
chosen by capability (`build` tools for write-capable roles, `plan` tools otherwise).

Three rules keep delegation safe and useful:

- **Only the report comes back.** The parent sees `{ role, report, steps, files }`; the subagent's tool
  calls and outputs never enter the parent's context.
- **The gate is shared.** Subagent tool calls go through the same permission engine, approval dialog and
  audit trail as the parent's, tagged `… (Explore subagent)` so you always know who is asking.
- **No recursion, no Plan Mode writes.** `spawn_subagent` is removed from a subagent's tool set, and a
  write-capable role is refused while the parent is planning, because Plan Mode promises nothing is written
  before you approve the plan.

### 12. Browser service (`src/main/browser/browser-service.ts`)

One lazily launched, headless browser (`playwright-core` driving the installed Edge/Chrome), an idle
shutdown timer, a rolling console buffer, and a single page that all six `browser_*` tools share. Screenshots
are written to `.d4ide/screenshots/` (self-ignoring) and attached to the timeline item so they render inline.

`checkBrowserUrl` is the security boundary and is a pure function, tested directly: `http(s)` only for
`localhost`, private ranges and bare machine names, plus `file://` URLs that resolve *inside* the project
(a sibling directory sharing a prefix is rejected). Anything else returns a refusal that points the model at
`fetch_url`.

### 13. Sessions & recovery (`src/main/ai/agent/session-history.ts`)

The runtime appends every timeline item to a transcript that is flushed to disk while the run is still in
flight and marked `endedCleanly` when it finishes, so a crash leaves a resumable session behind. On startup
the renderer asks for the newest non-clean transcript and offers to continue it.

`transcriptToConversation` turns a stored transcript back into messages for the model: user prompts,
assistant replies, summaries and failures only — tool traffic is dropped, and the tail is trimmed to the last
12 messages / 12 000 characters. Failures are re-framed as context rather than as assistant claims. Resuming
also means the transcript for the session is cleared and reloaded on every run, so a follow-up prompt in the
same session keeps its memory instead of starting blank.

Unsaved editor buffers are snapshotted separately (debounced, in `AppDataStore`), because a crash costs work
in two places: the run and the lines you had typed but not saved. Startup offers both back.

### 14. Checkpoints (`src/main/checkpoints/checkpoint-policy.ts`)

Snapshots are taken before a mutating tool runs (and on demand), each holding the absolute path and the
previous content of one file. Restore is where the risk sits: those paths were recorded while *some* project
was open, and restore may happen much later against a different one. `planCheckpointRestore` therefore
returns a plan (`writable` / `refused`) rather than a decision to write, refusing relative paths, duplicates,
snapshots without content and — most importantly — any path that is not strictly inside the project open
now. A refusal is reported to the user (`describeRefusals`) instead of being swallowed, and the affected open
buffers are re-read from disk so the editor shows the restored content.

### 15. Logging & notifications (`src/main/logging/`, `src/main/notifications/`)

Four channels — app, agent, provider, terminal — each keeping a bounded in-memory ring (500 records) for the
Settings → Logs viewer and a rotated file (2 MB × 3) on disk. **Redaction happens on the way in**, in
`redact()`: bearer tokens, provider key shapes, `key=value` assignments, JWTs and PEM blocks are stripped from
both the message and its structured context, so no code path can write a secret by forgetting to sanitise it.
Logging is best effort by construction — a missing directory degrades to memory-only, and a failed write never
surfaces as an application error.

Notifications are deliberately sparse: one per finished task, pending approval or budget threshold, via
Electron's native notifications when the setting is on. Approval requests are the one event that is always
announced — a blocked agent with no visible prompt would look like a hang.

### 16. Update service (`src/main/updater/update-service.ts`)

Wraps `electron-updater`: manual and periodic checks, download progress, install-on-quit, and a state object
the Settings → Update tab renders. It is inert in development and when no feed is configured, so a checkout
without a release feed behaves exactly like a normal build.

### 17. Shell, theming and layout (`src/renderer/`)

`uiStore` owns what the user is looking at (workspace mode, which right-hand panel, panel visibility and the
explorer width) so the command palette, a status-bar button and the shell all drive the same state instead of
keeping parallel copies. The layout is CSS-variable driven (`src/renderer/index.css` + `tailwind.config.cjs`):
D4 Dark is a true-black canvas with charcoal panels and a single teal accent; every colour is a token, so
D4 Light is a class swap rather than a second stylesheet. Panels resize by dragging a 4 px gutter and hide
from the title bar, the status bar, a keyboard shortcut or the palette.

### 18. Performance on a small machine (`src/main/performance/`)

The app is expected to run on a four-year-old office laptop as well as a workstation, so the costs that are
worth paying only on the second kind are decided rather than assumed. Everything below was measured on the
packaged build; the numbers are in `.freebuff/run.md`, and the harnesses that produce them are in
`.freebuff/`.

**One reading decides the rest.** `machine.ts` reads total RAM and core count and marks a machine
*constrained* at or below 8 GB (a machine whose RAM cannot be read is never assumed small — guessing "low"
would quietly take features from someone who never asked). `performance-profile.ts` turns that into
Chromium switches, which must be set before `app.whenReady()` because several are read only once while
Chromium initialises:

- every machine: switch off features a coding tool never uses (media router, optimization hints, interest
  feed, media keys, background fetch, periodic sync, translate);
- a constrained machine additionally: `--js-flags=--max-old-space-size=512` on renderers, and small disk and
  media caches. Verified by reading the running renderer's own command line.

`D4IDE_LOW_MEMORY=1|0` overrides the decision so the trimmed path can be started and verified on a machine
that would not otherwise take it. The choice is written to Settings → Logs at startup (`Performance
profile`), because "the app behaves differently on your machine" should never be a mystery.

The same reading sizes the database: `sqliteCacheKb()` halves SQLite's 1 MB… 2 MB page cache on a small
machine. The renderer reads its own, coarser figure from `navigator.deviceMemory` and trims terminal
scrollback (500–5000 lines) and the Monaco minimap, which is a full second render of the file at every
scroll and edit.

**What the app does not do twice.** Each of these was a measured cost on the per-request or per-output path:

| Cost | Before | After |
| --- | --- | --- |
| Terminal output (40,000 lines, panel watching) | one IPC message per pty chunk — 39,803 for a 497 KB flood | one message per terminal per frame: 307 messages for 2.8 MB, all rendered |
| Output for a terminal no panel displays | cloned and shipped to the page anyway | dropped at the source; the panel tells main what it is showing |
| Usage summary (runs after every model request) | re-read + re-parsed the log, 28 ms at 20,000 rows | summarised from the held log, 5 ms |
| Settings / provider list (read several times per request) | re-read, re-parsed, re-merged, 5.5–7.9 ms per call | cached against the file's stamp, 0.04 ms |
| Startup JavaScript | editor, terminal and settings parsed before the first paint | loaded when the panel is first shown (`LazyPanel`) |
| Typing in the editor | every keystroke re-rendered subscribers of the whole store, 5.2 ms/key | components subscribe to the fields they use, 0.51 ms/key |

**Bounded by construction.** Usage history is trimmed once at startup to a 400-day window
(`USAGE_RETENTION_DAYS`) — longer than any figure the app can display, and the count of removed rows is
logged. Logs rotate. Terminals keep a bounded scrollback. Nothing here grows with how long the app is left
open, which is what makes a long session on a small machine predictable.

The remaining floor is the PTY round-trip itself: flooding a terminal that *nothing* is displaying still
costs about as much main-process CPU as one that is, because the cost is the OS console read per chunk and
not this app's handling of it.

## Data flow of a Build task

```text
prompt ──► system prompt (+ rules, mission, @mentions)
       ──► model resolution (explicit, or Auto routing / fallback)
       ──► streaming response ──► timeline items (reasoning, text, tool calls)
       ──► per tool call: permission check ──► approval gate ──► checkpoint ──► execute
       ──► tool result back into the conversation ──► next step
       ──► (delegated work: subagent loop ──► single report back to the parent)
       ──► (UI work: browser_* tools ──► rendered page, console, screenshot in the timeline)
       ──► usage recorded per call ──► budget check ──► completion summary
       ──► transcript flushed continuously ──► resumable session on disk
```

## Testing

`pnpm test` runs Vitest over the pure logic: permission engine, ignore-rule compilation, context/secret
handling, tool registry filtering, provider error classification, auto-router scoring, cost/aggregation/
budget maths, browser URL sandboxing, subagent catalogue/permission sync, transcript replay, queue state,
checkpoint-restore policy, log redaction and locale key parity. `tests/agent-runtime.test.ts` additionally runs the **real** agent loop — plan/build, approvals,
checkpoints, retries, provider fallback, delegation and session resume — against a scripted provider, which
is where the bugs the unit tests cannot see get caught. See `docs/build-windows.md` for packaging.
