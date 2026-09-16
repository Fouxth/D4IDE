# D4IDE Architecture Documentation

## Overview

D4IDE follows an Agent-First Desktop architecture built on Electron, React 18, TypeScript, and Vite. The architecture enforces strict boundaries between the Renderer UI and the Agent Runtime.

```text
┌─────────────────────────────────────────────────────────┐
│                       Renderer UI                       │
│  (React 18 + Zustand + Tailwind CSS + Monaco + xterm)   │
└────────────────────────────┬────────────────────────────┘
                             │  Typed IPC Bridge
                             ▼
┌─────────────────────────────────────────────────────────┐
│                     Preload Script                      │
│     (contextBridge: contextIsolation: true, no Node)    │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│                   Main Process Runtime                  │
│  ┌───────────────────────────────────────────────────┐  │
│  │                   Agent Runtime                   │  │
│  │   • Autonomous multi-step loop                    │  │
│  │   • Plan Mode generator & approval gating         │  │
│  │   • Build Mode autonomous execution               │  │
│  └─────────────────┬─────────────────────────────────┘  │
│                    │                                    │
│       ┌────────────┼─────────────┐                      │
│       ▼            ▼             ▼                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                 │
│  │Providers │ │Tool Reg. │ │Context   │                 │
│  │(BYOK)    │ │(Files,   │ │(Secrets, │                 │
│  │DeepSeek, │ │ Terminal,│ │ Rules,   │                 │
│  │OpenAI,   │ │ Git, etc)│ │ Tokens)  │                 │
│  │Anthropic,│ └────┬─────┘ └──────────┘                 │
│  │Gemini,etc│      │                                    │
│  └──────────┘      ▼                                    │
│               ┌──────────┐                              │
│               │Permission│                              │
│               │Engine    │                              │
│               └──────────┘                              │
└─────────────────────────────────────────────────────────┘
```

## Subsystems

1. **Main Process & Agent Runtime**:
   - Decoupled from React UI; orchestrates model calls and tool executions.
   - Streams timeline events, status updates, and todos asynchronously back to the renderer.
2. **Provider Abstraction (`IAIProvider`)**:
   - Unifies OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, xAI, Ollama, and Custom endpoints.
   - Normalizes message formats, tool calling schemas, reasoning deltas, and usage token metrics.
3. **Tool Registry**:
   - Manages schemas and execution handlers (`read_file`, `write_file`, `edit_file`, `create_file`, `delete_file`, `list_directory`, `search_files`, `grep`, `run_terminal`, `git_*`, `create_checkpoint`).
   - Filters out write operations during Plan Mode.
4. **Context & Secret Filter Engine**:
   - Analyzes project rules (`D4IDE.md`, `.d4ide/rules.md`).
   - Detects and masks API keys, `.env` files, and private certificates before transmission.
5. **Persistent Store (`AppDataStore`)**:
   - Stored in `%APPDATA%/D4IDE/D4IDE_DATA/`.
   - Stores encrypted API keys, session histories, checkpoints, and token usage logs.
