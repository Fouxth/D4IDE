# Security & Privacy Model

D4IDE is designed with security-in-depth for local AI development.

## 1. Credential Security
- **safeStorage Encryption**: API keys are encrypted at rest using Windows DPAPI via Electron's `safeStorage`.
- **AES-256-GCM Fallback**: If DPAPI is unavailable, keys are encrypted using an authenticated AES-256-GCM cipher with a machine-derived key.
- **Renderer Isolation**: API keys are managed solely in the Main process and are never transmitted to renderer DOM storage (`localStorage` or `sessionStorage`).

## 2. Electron Process Isolation
- `contextIsolation: true`
- `nodeIntegration: false`
- No direct exposure of Node.js `fs` or `child_process` in the renderer window.
- All operations traverse a strictly validated and typed IPC contract via `preload/index.ts`.

## 3. Permission Engine Guardrails
Three user-configurable permission tiers are supported:
- **Safe Mode (Default)**: Automatically permits read-only actions (`read_file`, `search_files`, `grep`, `git_status`, `git_diff`). Prompts for user confirmation before file writes or custom terminal commands.
- **Ask Mode**: Solicits user confirmation before every file edit and command execution.
- **Full Access Mode**: Executes modifications autonomously, while enforcing hard guardrails that intercept and block catastrophic system commands:
  - `rm -rf /`
  - `del /s /q C:\...`
  - `format [drive]:`
  - `diskpart`
  - `DROP DATABASE`
  - `git reset --hard`, `git clean -fdx`, `git push --force`

## 4. Secret Redaction
Before any project code is injected into model context, regex filters scan for sensitive tokens (`sk-...`, `AIza...`, private key headers, `.env` files) and replace them with `[REDACTED_API_KEY]`.
