# D4IDE — Agent-first AI Coding IDE for Windows

D4IDE is a desktop AI Software Engineering Workspace inspired by modern developer tooling, featuring a dark developer-centric UI, multi-provider BYOK (Bring Your Own Key) architecture, autonomous Plan/Build modes, real-time agent timeline, safe file editing with diff review, embedded terminal, localhost preview, task queue, skills, MCP integration, context management, and cost tracking.

---

## Key Features

- **Agent-First Workflow**: Autonomous multi-step loops capable of inspecting codebases, executing terminal commands, creating implementation plans, writing/modifying code, and running builds and tests.
- **Dual Workspace Modes**:
  - **Agent View**: Focus on autonomous execution with an interactive activity timeline, live task todos, and plan approval cards.
  - **Code View**: Traditional IDE layout featuring Monaco Editor, tabs, syntax highlighting, diff viewer, file explorer, and xterm.js terminal.
- **Plan Mode & Build Mode**:
  - **Plan Mode**: Read-only repository inspection producing structured implementation plans (steps, affected files, estimated scope, risk assessment) awaiting user approval.
  - **Build Mode**: Full implementation mode executing targeted file modifications with undo checkpoints.
- **Multi-Provider BYOK & Auto Router**:
  - Direct integration with **DeepSeek**, **OpenAI**, **Anthropic Claude**, **Google Gemini**, **OpenRouter**, **xAI**, **Ollama (Local)**, and **Custom OpenAI-Compatible APIs**.
  - Auto model router with profiles: *Best Quality*, *Balanced*, *Lowest Cost*, and *Fastest*.
- **Comprehensive Thai & English UI Localization**:
  - Seamless live language switching from Settings or initial onboarding wizard.
  - Persistent language selection stored in application settings.
- **Security & Safety Guardrails**:
  - Encryption of all API keys via Electron `safeStorage` (DPAPI on Windows) with AES-256-GCM fallback.
  - 3-tier permission engine (`Safe`, `Ask`, `Full Access`) with hard guardrails blocking destructive system commands (`rm -rf /`, `del /s /q C:\`, `diskpart`, etc.).
  - Automatic secret detection and redaction before inclusion in AI context (`.env`, private keys, API tokens).
- **Interactive Terminal & Git**:
  - Integrated `xterm.js` terminal running native Windows PowerShell/CMD.
  - Native Git status, diff inspection, commit, and branch tracking.
- **Cost & Context Transparency**:
  - Real-time token usage breakdown (system, referenced files, conversation).
  - Per-request, daily, and monthly budget limits with warning thresholds.
- **Extensibility**:
  - User-defined skills in `.d4ide/skills/*.md`.
  - Model Context Protocol (MCP) server support via `.d4ide/mcp.json`.

---

## Getting Started

### Prerequisites

- Node.js >= 20.x
- pnpm >= 9.x or npm >= 10.x
- Windows 10 or 11 (x64)

### Development

```bash
# 1. Install dependencies
pnpm install

# 2. Start development mode
pnpm dev
```

### Running Tests

```bash
pnpm test
```

### Building & Packaging

```bash
# Build production bundle
pnpm build

# Generate Windows installer (D4IDE-Setup.exe)
pnpm dist
```

The output installer will be located at:
`release/D4IDE-Setup.exe`

---

## Project Structure

```text
D4IDE/
├── .d4ide/                 # Project rules, skills, and MCP configuration
│   ├── rules.md
│   ├── skills/
│   └── mcp.json
├── src/
│   ├── main/               # Electron main process
│   │   ├── ai/             # Agent runtime, providers, tools, context
│   │   ├── database/       # Persistent store (%APPDATA%/D4IDE/)
│   │   ├── filesystem/     # Tree explorer, fast search, grep
│   │   ├── git/            # Native Git wrapper
│   │   ├── ipc/            # Secure typed IPC handlers
│   │   ├── security/       # safeStorage key encryption, permission engine
│   │   └── terminal/       # Interactive PowerShell/CMD terminal
│   ├── preload/            # Context-isolated secure preload bridge
│   ├── renderer/           # React 18 + Vite frontend
│   │   ├── components/     # TitleBar, LeftNav
│   │   ├── features/       # Agent, Editor, Explorer, Terminal, RightSidebar, Settings
│   │   ├── locales/        # Thai (th.json) and English (en.json) dictionaries
│   │   └── stores/         # Zustand state management
│   └── shared/             # Shared TypeScript types & IPC contracts
├── package.json
├── tailwind.config.cjs
├── vite.config.ts
└── vitest.config.ts
```

---

## License

Proprietary — Developed for D4IDE.
