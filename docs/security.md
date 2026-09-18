# Security & Privacy Model

D4IDE is designed with security-in-depth for local AI development. This document describes what the
implementation actually enforces.

## 1. Credential security

- **Encryption at rest** — API keys are encrypted with Windows DPAPI through Electron's `safeStorage`
  (`dpapi:` prefix). If that is unavailable, an AES-256-GCM cipher with a machine-derived key is used
  instead (`aes:` prefix). Keys are never written to disk in plaintext.
- **The renderer never sees a key.** `providers:get` returns a sanitized shape: `hasApiKey` plus a
  `••••1a2b` preview computed in the main process. Testing a connection and fetching model lists also run
  in the main process, using the stored key — a plaintext key only travels in the one direction
  (renderer → main) when you paste a new one.
- **No web storage** — keys are never placed in `localStorage`, `sessionStorage` or any config JSON the UI
  can read.
- **Log hygiene** — provider errors are surfaced as messages and stable error kinds (`invalid_key`,
  `rate_limit`, `unavailable`, `timeout`, `model_not_found`, `context_exceeded`), never as raw request
  headers.
- **Redaction at the source** — every log record passes through `redact()` before it is buffered or written:
  bearer tokens and authorization headers, provider key shapes (`sk-`, `sk-ant-`, `AIza…`, `xai-`), key-shaped
  assignments (`api_key`, `access_token`, `client_secret`, `password`…), JWTs and PEM blocks are replaced in
  both the message and its structured context. Redaction is deliberately broad — a false positive costs a few
  characters, a false negative leaks a credential — and it is enforced in the logger itself, so no call site
  can forget it. The Settings → Logs viewer reads the same already-redacted records.
- **Desktop notifications only when asked** — notifications can be switched off entirely in Settings, and
  they never contain prompt text, file contents or keys: only a title and a short event label.

## 2. Electron process isolation

```
contextIsolation: true
nodeIntegration: false
sandbox: true
webSecurity: true
```

- The renderer only reaches the system through the typed `preload` bridge; there is no `window.require`
  and no unrestricted filesystem API.
- Permission requests (camera, microphone, geolocation…) are denied outright.
- `window.open` and external links open in the system browser instead of inside the app shell.

## 3. Permission engine and the approval gate

Three user-configurable tiers (**Settings → Permissions**), applied per tool call:

| Mode | Read-only tools | Writes / shell |
|---|---|---|
| **Safe** (default) | auto-allowed | asks first (tests, builds and read-only shell commands such as `git status`, `git diff`, `ls` are auto-allowed) |
| **Ask** | auto-allowed | asks before every write and every terminal command |
| **Full Access** | auto-allowed | runs autonomously, still asks for deletes and install/commit/push style commands |

When a tool needs approval the agent **pauses and waits** for your decision — the timeline cannot proceed
without an answer. You can allow once, allow that tool for the rest of the session, or refuse. Refusals
are fed back to the model as a tool error so it can choose another approach.

### Hard guardrails (all modes, including Full Access)

These are blocked before execution and reported in the timeline:

```
rm -rf /            del /s /q C:\        format X:          diskpart
mkfs / dd to device Remove-Item -Recurse on a drive root
DROP DATABASE       TRUNCATE TABLE       shutdown / reboot
git reset --hard    git clean -fdx       git push --force
```

Extra confirmation-worthiness is applied to `npm/pnpm/yarn install`, `pip install`, `git commit|push|merge|rebase`,
migrations and Docker commands.

### Subagent delegation

A subagent is not a way around the gate. Its tool calls are checked by the same engine, prompt the same
dialog and land in the same audit log, tagged with the role that asked (`… (Frontend subagent)`).

- Read-only roles (Explore, Review, Test, Debug) are handed the non-mutating tool set and are auto-allowed,
  because delegating to them changes nothing.
- Write-capable roles (Frontend, Database) are offered the full tool set, so delegating to them needs
  confirmation in Safe and Ask mode — the dialog names the role before you approve it.
- A role name that is not in the catalogue is refused outright rather than treated as an unknown risk.
- Subagents cannot delegate further, and a write-capable role is refused while the parent is in Plan Mode.

### Audit trail

Every tool call is recorded with its arguments (truncated), permission mode, whether approval was required,
the decision, the reason and the duration. Read it under **Settings → Sessions & History → Tool audit log**.

## 3b. Browser sandbox

The `browser_*` tools drive a real browser, so navigation is the thing that needs a boundary. `checkBrowserUrl`
(a pure, unit-tested function) allows only:

- `http`/`https` on `localhost`, `*.localhost`, `127.0.0.0/8`, `10/8`, `192.168/16`, `172.16/12`, and bare
  machine names such as `http://my-pc:5173`
- `file://` URLs whose resolved path is inside the current project — a sibling directory that merely shares
  a path prefix is rejected
- `about:blank` and inline `data:text/html` for scratch pages

Everything else is refused with an explanation that points at `fetch_url`, so a page under test can never be
used to reach the open internet. Reading a rendered page, clicking and typing are treated as inspection rather
than workspace mutation (no approval prompt per click), while clicking and filling are still withheld from
Plan Mode. Screenshots are written to `.d4ide/screenshots/` with a `.gitignore` inside it, so agent artifacts
stay out of your diff. The browser is headless, shuts down after 10 minutes of inactivity, rejects downloads,
and always dismisses JS dialogs instead of blocking on them.

## 4. Tool timeouts and bounded blast radius

- Each tool call has a timeout (default 120s, configurable) so a hung command cannot stall a task forever.
- Terminal output is capped before it is fed back to the model or the UI.
- Commands run in the project directory, and file tools resolve paths relative to that directory.

## 5. Checkpoints and undo

- Before the agent edits a file it takes a snapshot (configurable: before every edit, at task start, or off).
- **Changes** panel reverts individual files; **Checkpoints** restores whole snapshots and can diff them.
- Because snapshots are stored on disk, undo works even when the project is not a Git repository.
- **Restore is scoped to the open project.** A snapshot stores an absolute path captured while *some* project
  was open, so `planCheckpointRestore` (a pure, unit-tested function) only writes paths that resolve strictly
  inside the project open now. Relative paths, duplicates, snapshots without content and anything outside —
  a sibling folder sharing a name prefix, another drive, `C:\Windows` — are refused and reported to you as
  skipped. A restore therefore cannot be used to rewrite files you did not open.
- Restore never clobbers unsaved work: a file with unsaved edits is left alone unless you explicitly ask to
  reload (`reloadFileFromDisk(..., { force: true })` from the editor banner).

## 6. Secret redaction

Before project code is placed in model context, filters detect likely secrets and mask them:

- filenames such as `.env`, `.env.*`, `*.pem`, `*.key`
- inline patterns: `sk-...`, `AIza...`, private key headers, `password|secret|api_key|token = "..."`
- `.d4ideignore` (gitignore-style) keeps files out of search and context entirely

## 7. Privacy

- Requests go directly to the provider you configured; nothing is proxied through a third party.
- Project files leave your machine only when they are part of the context sent to the selected model.
- The **Context** panel shows what is actually in play, and the **Usage** panel shows exactly what each
  request cost.
- Usage records, sessions, audit entries and logs live in `%APPDATA%/D4IDE/D4IDE_DATA/` (SQLite when
  available, JSON otherwise) on your machine. Log files are rotated (2 MB × 3 per channel) so a long-running
  app cannot fill the disk.
- Image attachments are restricted to a known type and size ceiling (PNG/JPEG/GIF/WebP, 8 MB) before being
  inlined, and are sent only with the request they were attached to; they are never copied into project files.
- Session transcripts hold what the agent said and did — prompts, replies, failures, tool names and their
  arguments, but not file contents beyond what a tool already returned. They are what makes "continue the
  previous session" work, and they can be deleted individually under **Settings → Sessions**.
