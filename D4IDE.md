# D4IDE — AI Coding IDE Specification & Build Prompt

> **Project name:** D4IDE  
> **Target:** Windows desktop application (`.exe`)  
> **Primary stack:** Electron + React + TypeScript + Vite  
> **Core concept:** Agent-first AI Coding IDE inspired by the usability and workflow style of modern AI coding tools, with a clean dark UI, multi-provider API support, Plan/Build modes, agent timeline, file editing, terminal execution, preview, diff review, queue, skills, MCP, context management, and cost tracking.
>
> **Important:** Do not copy Freebuff branding, proprietary assets, logos, exact copywriting, or pixel-perfect layouts. Build an original product with a similar high-level workflow philosophy only.

---

# 1. Goal

Build a complete desktop AI IDE named **D4IDE** that can be installed and used on Windows as an `.exe`.

D4IDE must allow the user to:

- Open local coding projects.
- Browse and edit project files.
- Chat with AI about the codebase.
- Let an AI agent inspect, edit, create, and delete files.
- Run terminal commands.
- Run tests and builds.
- See exactly what files were changed.
- Review diffs before or after edits.
- Use **Plan Mode** before changes.
- Use **Build Mode** for autonomous implementation.
- Queue multiple tasks.
- Switch between multiple AI providers and models.
- Add custom OpenAI-compatible API providers.
- Use local models through Ollama.
- Track token usage and estimated cost.
- Manage context intelligently.
- Support user-defined Skills.
- Support MCP servers.
- Preview web projects inside the application.
- Save sessions and project history.
- Support **Thai and English UI languages**.
- Allow switching language from Settings without restarting the app where practical.
- Persist the selected language across sessions.
- Create checkpoints and undo agent changes.
- Package the final app as a Windows installer.

The final product should feel:

- clean
- fast
- dark
- modern
- minimal
- developer-focused
- agent-first
- easy to understand
- safe to use
- visually consistent

---

# 2. Product Philosophy

D4IDE is not just:

> “a code editor with an AI chat box”

It is an **AI software engineering workspace**.

The AI must be able to act as an agent and execute a task from start to finish.

Example user request:

> “แก้ระบบ login ให้รองรับ refresh token เพิ่ม validation และรัน build ให้ผ่าน”

Expected workflow:

```text
User request
    ↓
Analyze repository
    ↓
Search related files
    ↓
Read authentication code
    ↓
Create implementation plan
    ↓
User approves plan
    ↓
Edit multiple files
    ↓
Run tests
    ↓
Read errors
    ↓
Fix errors
    ↓
Run build
    ↓
Review git diff
    ↓
Return completion summary
```

The interface must make this workflow easy to understand.

---

# 3. Main UX

D4IDE should use an **Agent-first workspace** by default.

Suggested main layout:

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ D4IDE   Project / Session Tabs                         Window Controls      │
├──────┬───────────────────────────────────────┬─────────────────────────────┤
│      │                                       │ Queue  Changes  Files       │
│      │                                       │ Context Preview Terminal    │
│ D4   │           AGENT WORKSPACE             │                             │
│      │                                       │ Mission                     │
│ +    │ Thinking...                           │ Skills                      │
│      │ Search auth                           │ Queue                       │
│      │ Read src/auth.ts                      │                             │
│      │ Edit src/auth.ts                      │                             │
│      │ Run npm test                          │                             │
│      │                                       │                             │
│      │ ┌───────────────────────────────────┐ │                             │
│      │ │ Ask D4IDE...                      │ │                             │
│      │ └───────────────────────────────────┘ │                             │
│      │ Plan | Build                         │                             │
│      │ Provider | Model | Reasoning | Cost  │                             │
├──────┴───────────────────────────────────────┴─────────────────────────────┤
│ Status / Branch / Context / Token usage / Agent status                     │
└────────────────────────────────────────────────────────────────────────────┘
```

The design should not feel crowded.

Use subtle separators, soft borders, compact controls, low visual noise, and clear hierarchy.

---

# 4. Main Views

D4IDE must support two main workspace modes.

## 4.1 Agent View

Default experience.

Designed for requests such as:

- “สร้าง API นี้ให้หน่อย”
- “แก้ responsive ทั้งเว็บ”
- “refactor ระบบ auth”
- “รัน test แล้วแก้ให้ผ่าน”
- “เพิ่ม feature ตาม requirement นี้”

Show:

- agent timeline
- current action
- todo list
- task queue
- tool calls
- edited files
- progress
- errors
- terminal results
- final summary

---

## 4.2 Code View

Traditional IDE layout.

Suggested layout:

```text
Explorer | Monaco Editor | AI Assistant
                  ↓
               Terminal
```

Must support:

- file tree
- tabs
- Monaco Editor
- syntax highlighting
- find/replace
- problems/errors
- terminal
- git status
- AI inline actions

User can switch:

```text
Agent | Code
```

without losing state.

---

# 5. Left Navigation

Keep the left navigation compact.

Suggested items:

- D4IDE logo
- Projects
- New Session
- Search
- Git
- Settings

Avoid unnecessary visual clutter.

---

# 6. Agent Timeline

The central agent workspace must not behave like a normal chat log only.

Render agent activity as a clear timeline.

Example:

```text
Thinking
Analyzing authentication flow

Search
"refreshToken"

Read
src/server/auth.ts

Read
src/shared/auth-schema.ts

Edit
src/server/auth.ts

Run
npm test

Error
2 tests failed

Read
tests/auth.test.ts

Edit
src/server/auth.ts

Run
npm test

Success
42 tests passed
```

Each row should be expandable.

Expanded tool call should show useful information, but hide noisy internals by default.

Do not expose hidden chain-of-thought.

Show concise user-safe action summaries only.

---

# 7. Plan Mode

Plan Mode must analyze before modifying files.

When Plan Mode is enabled, AI may:

- inspect files
- search project
- inspect git
- inspect package metadata
- inspect dependencies
- inspect database schema
- inspect terminal output

But must **not modify files**.

Example plan UI:

```text
Implementation Plan

1. Add refresh token schema
2. Update auth service
3. Update session persistence
4. Add API validation
5. Update tests
6. Run tests
7. Run build

Affected files
- src/auth/service.ts
- src/auth/schema.ts
- tests/auth.test.ts

Risk
- Medium

Estimated scope
- 3–5 files
```

Actions:

```text
Approve Plan
Edit Plan
Cancel
```

---

# 8. Build Mode

Build Mode allows the agent to execute approved tasks.

Available operations:

- read file
- search
- create file
- edit file
- delete file
- move/rename file
- terminal command
- run tests
- run build
- inspect git
- browser/preview
- MCP
- screenshot preview
- analyze errors

Build Mode must support autonomous multi-step loops.

---

# 9. Agent Runtime

The agent runtime must be separate from the React UI.

Do not tightly couple AI logic with components.

Recommended architecture:

```text
Renderer UI
    ↓
IPC
    ↓
Agent Runtime
    ↓
Model Adapter
Tool Registry
Context Engine
Permission Engine
Session Store
```

The agent runtime should run in the Electron main process or a dedicated worker process.

---

# 10. Agent Loop

Core behavior:

```ts
while (!finished) {
  const response = await model.generate({
    messages,
    tools,
    context
  });

  if (response.toolCalls?.length) {
    for (const toolCall of response.toolCalls) {
      const permission = await permissionEngine.check(toolCall);

      if (!permission.allowed) {
        continue;
      }

      const result = await toolRegistry.execute(toolCall);

      messages.push({
        role: "tool",
        toolCallId: toolCall.id,
        content: result
      });
    }

    continue;
  }

  finished = true;
}
```

Must support:

- streaming output
- multiple tool calls
- cancellation
- retry
- provider fallback
- timeout
- error recovery
- task state persistence

---

# 11. Tool System

Implement a generic tool registry.

Required tools:

```text
read_file
write_file
edit_file
create_file
delete_file
move_file
list_directory
search_files
grep
find_symbol
get_project_tree
run_terminal
run_tests
run_build
git_status
git_diff
git_log
git_branch
git_commit
open_preview
take_preview_screenshot
fetch_url
browser_action
mcp_call
```

Each tool must have:

- name
- description
- JSON schema
- permission level
- execution handler
- timeout
- audit log

---

# 12. Safe File Editing

Do not blindly overwrite entire files unless necessary.

Prefer:

- targeted patches
- structured edits
- line-aware replacement
- AST-aware editing where practical

Before destructive changes:

- create checkpoint
- keep previous content
- allow undo

---

# 13. Checkpoints

Every major agent task must support checkpoints.

Example:

```text
Checkpoint created
Before: "Implement authentication"
```

User actions:

```text
Restore
Compare
Delete
```

Minimum implementation:

- save git diff or file snapshots
- store timestamp
- store task/session ID

Do not rely only on Git because the project may not be initialized as a repository.

---

# 14. Permission System

Provide 3 permission modes.

## Safe

Allowed automatically:

- read files
- search
- inspect git
- run tests
- run build
- harmless commands

Ask before:

- installing packages
- deleting files
- modifying environment files
- git commit
- git push
- migrations

Block or ask strongly before dangerous operations.

---

## Ask

Ask before most writes and shell actions.

---

## Full Access

Allow normal coding operations automatically.

Still protect against destructive system commands.

Examples requiring confirmation or blocking:

```text
rm -rf /
del /s /q C:\
format
diskpart clean
DROP DATABASE
TRUNCATE production data
git reset --hard
git clean -fdx
force push
```

Permission rules should be configurable.

---

# 15. Right Sidebar

Tabs:

```text
Queue
Changes
Files
Context
Preview
Terminal
```

---

# 16. Queue

User can add tasks while an agent is working.

Example:

```text
● Implement authentication
○ Fix mobile navbar
○ Add migration
○ Run test suite
```

Features:

- reorder
- pause
- delete
- edit
- retry
- mark done
- run next automatically

Task statuses:

```text
queued
planning
waiting_approval
running
paused
failed
completed
cancelled
```

---

# 17. Changes

Show modified files.

Example:

```text
7 files changed

src/app/page.tsx           +52 -13
src/lib/auth.ts            +84
src/components/Navbar.tsx  +17 -8
```

Click opens Monaco Diff Editor.

Actions:

```text
Accept
Reject
Revert File
Revert All
```

Also show:

- created
- modified
- deleted
- renamed

---

# 18. Files Tab

Show files used by the agent during the current task.

Example:

```text
Read
- shared/types.ts
- shared/selectors.ts

Modified
- shared/validation.ts

Created
- scripts/probe-validation.ts
```

This differs from the normal project Explorer.

---

# 19. Context Tab

Must make context usage visible.

Example:

```text
Context
78K / 200K tokens

Current file        5K
Referenced files   23K
Git diff            7K
Search results     12K
Conversation       21K
System             10K
```

User can:

- pin context
- remove context
- add files
- add folders
- clear temporary context

---

# 20. Context Engine

Do not send entire repositories to the model.

Build a context selection system.

Sources:

- current file
- open tabs
- explicitly referenced files
- agent-read files
- git diff
- diagnostics
- symbols
- search results
- terminal output
- project rules
- skills
- mission
- conversation history

Prioritize by relevance.

---

# 21. Search Engine

Use:

- ripgrep for fast text search
- file glob search
- symbol indexing
- optional semantic indexing later

Ignore by default:

```text
node_modules
.git
dist
build
.next
coverage
vendor
```

respect `.gitignore`.

---

# 22. Monaco Editor

Use Monaco Editor.

Required:

- syntax highlighting
- tabs
- dirty state
- save
- autosave optional
- Ctrl+P
- Ctrl+F
- Ctrl+Shift+F
- go to line
- minimap optional
- TypeScript diagnostics
- diff editor
- multiple languages

Do not attempt full VS Code extension compatibility in MVP.

---

# 23. Terminal

Use:

- `xterm.js`
- `node-pty`

Must support:

- PowerShell
- CMD
- Git Bash if installed
- shell resize
- multiple terminals
- agent terminal
- user terminal

Agent terminal activity must be visible.

Allow user to stop a command.

---

# 24. Preview

For web projects, detect local dev servers.

Detect URLs such as:

```text
http://localhost:3000
http://localhost:5173
http://127.0.0.1:3000
```

Open them inside Preview.

Preview features:

- refresh
- back/forward
- open externally
- responsive viewport
- screenshot
- developer console logs

The agent should be able to inspect screenshots.

---

# 25. Visual Agent Loop

For frontend tasks:

```text
Edit UI
↓
Run dev server
↓
Open Preview
↓
Capture screenshot
↓
Analyze visible result
↓
Adjust code
↓
Capture again
```

Make this available as a tool.

---

# 26. AI Providers

D4IDE must support multiple providers.

Initial providers:

- OpenAI
- Anthropic
- Google Gemini
- DeepSeek
- OpenRouter
- xAI
- Ollama
- Custom OpenAI-compatible

Provider interface:

```ts
interface AIProvider {
  id: string;
  name: string;

  listModels(): Promise<ModelInfo[]>;

  streamChat(
    request: ChatRequest,
    options?: ChatOptions
  ): AsyncIterable<ChatChunk>;

  countTokens?(
    request: ChatRequest
  ): Promise<number>;
}
```

---

# 27. Provider Adapter Structure

```text
src/main/ai/providers/
  provider.ts
  openai.ts
  anthropic.ts
  gemini.ts
  deepseek.ts
  openrouter.ts
  xai.ts
  ollama.ts
  openai-compatible.ts
```

Normalize:

- messages
- system prompts
- streaming
- tool calls
- reasoning options
- images
- context length
- token usage
- errors

---

# 28. Custom OpenAI-Compatible Provider

User fields:

```text
Provider Name
Base URL
API Key
Model ID
Context Window
Input Price
Output Price
Supports Tools
Supports Vision
```

Example:

```text
Base URL:
https://api.provider.com/v1

API Key:
sk-xxxx

Model:
provider-model-name
```

This allows unsupported providers without app updates.

---

# 29. API Key Security

Never store API keys in plaintext.

Do not store API keys in:

- localStorage
- config JSON
- SQLite plaintext

Use:

- Electron `safeStorage`
- OS credential manager when possible

Renderer should never receive secrets unless absolutely required.

All provider calls should preferably happen in main process.

---

# 30. Provider Settings UI

Example:

```text
AI Providers

OpenAI
Status: Connected

Anthropic
Status: Not configured

DeepSeek
Status: Connected

OpenRouter
Status: Connected

Ollama
Status: Running locally

+ Add Custom Provider
```

Allow:

- test connection
- edit
- delete
- enable/disable

---

# 31. Model Selector

Bottom composer should include:

```text
Provider ▼
Model ▼
Reasoning ▼
Permission ▼
```

Example:

```text
DeepSeek | DeepSeek V4.1 | High | Safe
```

---

# 32. Model Metadata

Each model should store:

```ts
type ModelInfo = {
  id: string;
  name: string;
  providerId: string;

  contextWindow?: number;

  supportsTools: boolean;
  supportsVision: boolean;
  supportsReasoning?: boolean;

  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  cachedInputPricePerMillion?: number;
};
```

---

# 33. Auto Model Router

Add model option:

```text
Auto ✨
```

Routing profiles:

```text
Best Quality
Balanced
Lowest Cost
Fastest
```

Possible routing rules:

```text
Autocomplete
→ cheap fast model

Simple code edit
→ low-cost coding model

Large refactor
→ stronger coding model

Difficult debugging
→ reasoning model

Vision task
→ vision-capable model
```

User should be able to override routing.

---

# 34. Provider Fallback

Allow fallback chain.

Example:

```text
Primary
DeepSeek

Fallback 1
Gemini

Fallback 2
OpenAI
```

Fallback on:

- timeout
- unavailable
- rate limit
- server error

Do not silently switch if it would create an unexpected cost unless user allows auto fallback.

---

# 35. Cost Tracking

D4IDE should be transparent about AI cost.

Show session usage:

```text
Session

Input      324K tokens
Cached     211K tokens
Output      28K tokens

Estimated cost
$0.74
```

Daily:

```text
Today
$2.18 / $5.00
```

Monthly:

```text
Month
$17.42 / $50.00
```

Breakdown:

```text
DeepSeek   $8.21
OpenAI     $5.76
Gemini     $3.45
```

Use provider usage responses where available.

Fallback to local price calculation.

---

# 36. Budgets

Allow:

```text
Per request budget
Daily budget
Monthly budget
```

Example:

```text
Per request: $0.50
Daily: $5
Monthly: $50
```

When approaching threshold:

- show warning
- stop automatically if configured

---

# 37. Reasoning Selector

Options:

```text
Off
Low
Medium
High
Auto
```

Map provider-specific reasoning parameters internally.

Hide unsupported levels for models that do not support them.

---

# 38. Skills

Skills are reusable agent instructions.

Default skills:

```text
review
test
simplify
commit
open-pr
merge-pr
debug
refactor
document
```

Project skill location:

```text
.d4ide/skills/
```

Example:

```text
.d4ide/skills/review.md
```

Example file:

```md
# Review

Review the current git diff.

Check:
- bugs
- security
- performance
- type safety
- duplicated code
- regressions

Do not modify files unless explicitly requested.
```

---

# 39. Skills UI

Right sidebar:

```text
SKILLS

review
test
simplify
commit
open-pr
+ Add
```

Allow:

- add
- edit
- delete
- project skills
- global skills

---

# 40. Mission

Mission is persistent context for a session.

Example:

```text
Mission
Build hotel administration desktop application

Effort
High

Rules
- Use TypeScript
- Keep backward compatibility
- Do not change database schema unless necessary
- Run tests before finishing
```

Mission fields:

- objective
- constraints
- coding style
- important files
- forbidden actions
- effort level

---

# 41. Project Rules

Support:

```text
D4IDE.md
.d4ide/rules.md
```

When a project opens, load project instructions.

Possible instructions:

```md
# Project Rules

- Use TypeScript strict mode.
- Do not use `any`.
- Use pnpm.
- Do not modify migrations without approval.
- Run `pnpm test` before finishing.
```

---

# 42. MCP Support

Implement MCP client support.

Settings:

```text
MCP Servers

filesystem
postgres
github
browser
custom
```

Config file:

```text
.d4ide/mcp.json
```

Support:

- stdio
- HTTP if available in chosen MCP SDK
- start/stop
- tool discovery
- connection health

Agent should expose MCP tools through the normal tool registry.

---

# 43. Git

Minimum Git features:

- branch name
- git status
- file changes
- staged/unstaged
- diff
- commit
- log

Later:

- branch switching
- merge
- conflict assistant
- PR integration

Use native Git CLI.

---

# 44. Git Safety

Do not automatically:

- force push
- reset hard
- clean untracked files
- rewrite history

without explicit approval.

---

# 45. Session System

Each session stores:

- project
- user messages
- assistant messages
- agent actions
- tools
- todos
- queue
- selected provider
- model
- reasoning
- context items
- token usage
- cost
- checkpoints
- file changes
- timestamps

Use SQLite.

---

# 46. Database

Use SQLite.

Recommended library:

```text
better-sqlite3
```

Suggested tables:

```text
projects
sessions
messages
agent_events
tasks
queue_items
checkpoints
file_changes
provider_configs
model_configs
usage_records
skills
settings
```

Encrypt sensitive fields separately.

---

# 47. Project Explorer

Support:

- folders
- files
- create
- rename
- delete
- reveal in Explorer
- copy path
- open terminal here
- search

Ignore huge generated folders by default.

---

# 48. File Watcher

Use `chokidar`.

Detect external file changes.

Show:

```text
File changed outside D4IDE
Reload | Keep current
```

---

# 49. Todo System

Agent may generate todo list for long tasks.

Example:

```text
To-do 3 / 8

✓ Inspect schema
✓ Add API validation
✓ Update service
● Update UI
○ Add tests
○ Run tests
○ Run build
○ Review changes
```

The agent must update progress in real time.

---

# 50. Composer

Bottom input:

```text
┌────────────────────────────────────────────────────────────┐
│ Ask D4IDE...                                               │
│                                                            │
├────────────────────────────────────────────────────────────┤
│ Build | Plan     📎  Image   Model ▼  Reasoning ▼   Send   │
└────────────────────────────────────────────────────────────┘
```

Support:

- multiline
- file attachments
- image attachments
- `@file`
- `@folder`
- `@git`
- `@terminal`
- `@selection`

---

# 51. Mention System

Examples:

```text
@src/auth.ts
@src/components
@git
@terminal
@selection
```

Mentions must be converted into explicit context items.

---

# 52. Images

Support vision-capable models.

Users can:

- paste screenshot
- drag image
- attach UI screenshot

Agent can use screenshot as context.

---

# 53. Notifications

Use compact notifications:

```text
Build completed
Tests passed
Agent needs approval
API rate limited
Budget threshold reached
```

Avoid excessive popups.

---

# 54. Error Handling

Provider errors must be human-readable.

Examples:

```text
API key invalid
Rate limit reached
Provider unavailable
Context window exceeded
Model does not support tools
Request timed out
```

Offer appropriate actions:

```text
Retry
Switch Model
Open Provider Settings
Reduce Context
```

---

# 55. Retry Strategy

Implement:

- exponential backoff
- max retries
- retry only safe errors

Do not retry destructive tools blindly.

---

# 56. Cancellation

User must always be able to stop:

- model generation
- agent task
- terminal command
- queue task
- indexing

Provide a visible Stop button.

---

# 57. Performance

Important:

- lazy load Monaco
- virtualize agent timeline
- avoid rendering huge terminal logs
- stream messages
- avoid loading entire project into memory
- do search on demand
- cap terminal history
- debounce file watchers

---

# 58. Theme

Default:

```text
D4 Dark
```

Visual direction:

- near-black background
- charcoal panels
- subtle borders
- soft gray text
- teal/green accent
- small rounded corners
- compact controls
- minimal shadows
- no bright gradients
- no excessive glassmorphism

Do not copy Freebuff exact colors or assets.

---

# 59. Design Tokens

Create shared tokens:

```ts
export const theme = {
  radius: {
    sm: 6,
    md: 10,
    lg: 14,
  },

  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  }
};
```

Prefer CSS variables for colors.

---

# 60. Responsive Desktop Layout

Although desktop-first, support:

- 1280×720
- 1366×768
- 1440×900
- 1920×1080
- 2560×1440
- ultrawide

Panels must resize.

Use draggable split panes.

Allow hiding:

- left sidebar
- right sidebar
- terminal

---

# 61. Keyboard Shortcuts

Initial shortcuts:

```text
Ctrl+P           Quick Open
Ctrl+Shift+P     Command Palette
Ctrl+Shift+F     Global Search
Ctrl+`           Terminal
Ctrl+Enter       Send prompt
Ctrl+Shift+Enter Plan prompt
Ctrl+S           Save
Ctrl+W           Close tab
Ctrl+Tab         Next tab
```

Allow future customization.

---

# 62. Command Palette

Commands:

```text
D4IDE: New Session
D4IDE: Switch Model
D4IDE: Open Provider Settings
D4IDE: Plan Current Task
D4IDE: Run Build
D4IDE: Run Tests
D4IDE: Review Changes
D4IDE: Create Checkpoint
D4IDE: Restore Checkpoint
D4IDE: Open Preview
```

---

# 63. Suggested Project Structure

```text
D4IDE/
├─ apps/
│  └─ desktop/
│     ├─ src/
│     │  ├─ main/
│     │  │  ├─ ai/
│     │  │  │  ├─ agent/
│     │  │  │  ├─ context/
│     │  │  │  ├─ providers/
│     │  │  │  ├─ tools/
│     │  │  │  ├─ routing/
│     │  │  │  └─ usage/
│     │  │  ├─ filesystem/
│     │  │  ├─ terminal/
│     │  │  ├─ git/
│     │  │  ├─ mcp/
│     │  │  ├─ preview/
│     │  │  ├─ security/
│     │  │  ├─ database/
│     │  │  ├─ ipc/
│     │  │  └─ main.ts
│     │  │
│     │  ├─ preload/
│     │  │  └─ preload.ts
│     │  │
│     │  └─ renderer/
│     │     ├─ app/
│     │     ├─ components/
│     │     ├─ features/
│     │     │  ├─ agent/
│     │     │  ├─ editor/
│     │     │  ├─ terminal/
│     │     │  ├─ explorer/
│     │     │  ├─ changes/
│     │     │  ├─ queue/
│     │     │  ├─ context/
│     │     │  ├─ preview/
│     │     │  ├─ providers/
│     │     │  ├─ settings/
│     │     │  └─ skills/
│     │     ├─ stores/
│     │     ├─ hooks/
│     │     ├─ lib/
│     │     └─ styles/
│     │
│     └─ package.json
│
├─ packages/
│  ├─ shared/
│  ├─ ai-types/
│  └─ ui/
│
├─ package.json
├─ pnpm-workspace.yaml
└─ README.md
```

---

# 64. Recommended Libraries

Use current stable versions.

Core:

```text
electron
react
typescript
vite
electron-vite
```

UI:

```text
tailwindcss
lucide-react
zustand
react-resizable-panels
```

Editor:

```text
monaco-editor
@monaco-editor/react
```

Terminal:

```text
xterm
node-pty
```

Database:

```text
better-sqlite3
```

File tools:

```text
chokidar
fast-glob
```

Git:

```text
native git CLI
```

Validation:

```text
zod
```

Logging:

```text
pino
```

MCP:

```text
official MCP SDK where practical
```

Packaging:

```text
electron-builder
```

Testing:

```text
vitest
playwright
```

---

# 65. IPC Security

Electron security requirements:

```text
contextIsolation: true
nodeIntegration: false
sandbox: true where compatible
```

Use preload APIs.

Never expose:

```ts
window.require
```

Do not expose unrestricted filesystem APIs.

Use typed IPC contracts.

---

# 66. Logging

Create structured logs.

Levels:

```text
debug
info
warn
error
```

Separate:

- application log
- agent log
- provider errors
- terminal process log

Redact:

- API keys
- Authorization headers
- secrets
- environment values where appropriate

---

# 67. Development Phases

## Phase 1 — Working AI Agent MVP

Must include:

- Electron app
- polished dark UI
- open folder
- project tree
- AI chat
- provider settings
- OpenAI-compatible provider
- OpenAI
- DeepSeek
- Ollama
- read/search/edit tools
- terminal
- agent loop
- Plan Mode
- Build Mode
- task progress
- changes panel
- basic diff
- Windows `.exe`

Phase 1 must already be usable for real projects.

---

## Phase 2 — IDE Features

Add:

- Monaco editor
- tabs
- file explorer improvements
- git
- terminal tabs
- context manager
- preview
- file watcher
- checkpoints
- usage/cost tracking

---

## Phase 3 — Advanced Agent

Add:

- queue
- todo
- skills
- MCP
- visual testing
- browser tools
- subagents
- model router
- fallback models

---

## Phase 4 — Product Quality

Add:

- updater
- crash handling
- import/export settings
- project history
- plugin architecture
- cloud sync optional
- telemetry opt-in only
- performance optimization

---

# 68. MVP Acceptance Criteria

The MVP is considered complete only when all conditions below pass.

### Project

- User can open an existing folder.
- Project tree loads correctly.
- `.gitignore` is respected for search.

### AI

- User can configure at least 3 providers.
- User can choose provider and model.
- Streaming works.
- Tool calling works.
- Errors are handled.

### Agent

- Agent can read files.
- Agent can search files.
- Agent can edit files.
- Agent can create files.
- Agent can run terminal commands.
- Agent can recover from basic command errors.
- Agent can finish a multi-file task.

### Plan Mode

- Agent can inspect project.
- Agent generates a plan.
- Agent does not write before approval.

### Build Mode

- Agent executes task after approval.
- Agent updates todos.
- Agent reports completion.

### Changes

- Changed files are visible.
- Diff can be reviewed.
- Changes can be reverted.

### Security

- API keys are encrypted.
- Renderer does not have direct Node access.
- Dangerous commands require approval.

### Language

- Thai UI works across all core screens.
- English UI works across all core screens.
- User can switch language from Settings.
- Selected language persists after restarting D4IDE.
- First-run onboarding includes language selection.
- No core UI contains untranslated placeholder keys.

### Desktop

- Works on Windows 10/11.
- Installer builds successfully.
- Application starts after installation.

---

# 69. Final Build Output

The project must build:

```text
D4IDE-Setup.exe
```

Target:

```text
Windows x64
```

Optional later:

```text
Windows ARM64
macOS
Linux
```

---

# 70. Build Commands

Recommended:

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
pnpm dist
```

Expected Windows output:

```text
release/
  D4IDE-Setup.exe
```

---

# 71. First-Run Experience

On first launch:

```text
Welcome to D4IDE
```

Options:

```text
Open Project
Clone Repository
Connect AI Provider
Use Local Model
```

Then provider setup.

Avoid mandatory account creation for MVP.

---

# 72. Settings Pages

Settings categories:

```text
General
Language
Appearance
AI Providers
Models
Agent
Permissions
Terminal
Editor
Git
MCP
Skills
Usage & Budgets
Advanced
About
```

The **Language** settings page must allow the user to choose:

```text
ภาษาไทย
English
```

Recommended display:

```text
Language / ภาษา

○ ภาษาไทย
○ English
```

Changing the language should update the application UI immediately where practical and persist after restart.

---

# 72.1 Language & Internationalization

D4IDE must support both:

```text
Thai (th)
English (en)
```

The application must use a proper internationalization system rather than hard-coded UI text.

Recommended library:

```text
i18next
react-i18next
```

Suggested structure:

```text
src/renderer/locales/
  en/
    common.json
    settings.json
    agent.json
    editor.json
  th/
    common.json
    settings.json
    agent.json
    editor.json
```

Example:

```json
{
  "settings.language.title": "Language",
  "settings.language.thai": "Thai",
  "settings.language.english": "English"
}
```

Thai equivalent:

```json
{
  "settings.language.title": "ภาษา",
  "settings.language.thai": "ภาษาไทย",
  "settings.language.english": "ภาษาอังกฤษ"
}
```

Requirements:

- Default language should follow the operating system language when possible.
- If Windows language is Thai, default to Thai.
- Otherwise default to English.
- User selection must override OS detection.
- Persist language selection in application settings.
- Switching language should not require reinstalling the app.
- Prefer live switching without restarting.
- All core UI must be translated, including:
  - menus
  - buttons
  - settings
  - agent status
  - permission dialogs
  - provider settings
  - queue
  - changes
  - files
  - context
  - preview
  - terminal labels
  - errors
  - notifications
  - onboarding
  - update dialogs
- Provider/model names must not be translated.
- File names, code, terminal output, Git output, and user project content must remain unchanged.
- Do not translate AI responses automatically unless the user asks.
- The selected UI language may be passed as a preference to the agent so completion summaries can match the user's UI language.
- Avoid concatenating translated strings. Use complete translation keys with interpolation.
- Ensure Thai fonts render correctly on Windows.
- Use system-safe font fallbacks such as:

```css
font-family:
  Inter,
  "Noto Sans Thai",
  "Leelawadee UI",
  "Segoe UI",
  sans-serif;
```

Do not bundle proprietary font files unless licensing permits it.

Example Settings UI:

```text
Settings
└─ Language

Language / ภาษา

[ ภาษาไทย ▼ ]

Available languages
✓ ภาษาไทย
  English
```

English mode:

```text
Settings
└─ Language

Language

[ English ▼ ]

Available languages
  ภาษาไทย
✓ English
```

The language switcher should also be accessible from first-run onboarding.

Example onboarding:

```text
Choose your language
เลือกภาษา

[ ภาษาไทย ]
[ English ]
```

# 73. General Settings

Include:

- startup behavior
- restore last project
- autosave
- default workspace view
- default permission mode

---

# 74. Appearance

Include:

- D4 Dark
- optional light theme later
- font size
- editor font
- UI density
- sidebar size

---

# 75. Agent Settings

Include:

- Plan by default
- Auto-run tests
- Auto-run build
- Max agent steps
- Tool timeout
- Retry limit
- checkpoint frequency

---

# 76. Usage Dashboard

Display:

```text
Today
Requests
Tokens
Estimated cost

This Month
Requests
Tokens
Estimated cost

By Provider
By Model
By Project
```

Use charts only if useful.

---

# 77. Privacy

For BYOK mode:

- API calls go directly to configured provider.
- D4IDE should not proxy keys through an external server unless explicitly designed later.
- Project files remain local unless sent as context to the selected model.
- Clearly indicate which files are being sent to AI.

---

# 78. Secret Detection

Before adding files to AI context, detect likely secrets:

```text
.env
.env.local
private keys
API tokens
credentials
certificates
```

Warn before sending.

Allow project-level ignore:

```text
.d4ideignore
```

---

# 79. `.d4ideignore`

Similar idea to `.gitignore`.

Example:

```text
.env
.env.*
secrets/
private/
*.pem
*.key
large-data/
```

Do not send ignored files into model context automatically.

---

# 80. Autocomplete

Do not prioritize autocomplete in MVP.

Later implementation can support:

- ghost text
- current file context
- low latency model
- cancellation on typing

Keep autocomplete model independent from agent model.

---

# 81. Subagents

Later architecture should support specialized subagents:

```text
Explore
Review
Test
Debug
Frontend
Database
```

Main agent can delegate.

Do not implement unnecessary complexity in Phase 1.

---

# 82. Browser Tool

Later agent tools may use Playwright.

Capabilities:

- navigate
- click
- fill
- inspect text
- screenshot
- console logs

Browser must be sandboxed to project tasks.

---

# 83. Update System

Later use:

```text
electron-updater
```

Support:

- check updates
- download
- install on restart

Do not silently update while an agent is modifying files.

---

# 84. Crash Recovery

Persist:

- unsaved buffers
- active session
- queue
- task state
- terminal metadata where possible

On restart:

```text
D4IDE recovered your previous session.
```

---

# 85. Non-Goals for MVP

Do not spend time implementing:

- VS Code extension marketplace
- remote SSH development
- containers
- collaborative editing
- cloud accounts
- mobile support
- full debugger
- huge plugin ecosystem

Focus on excellent local AI coding workflow first.

---

# 86. Naming

Product:

```text
D4IDE
```

Executable:

```text
D4IDE.exe
```

Installer:

```text
D4IDE-Setup.exe
```

App data:

```text
%APPDATA%/D4IDE/
```

Project metadata:

```text
.d4ide/
```

---

# 87. UI Copy Style

Keep UI text concise.

Good:

```text
Planning
Reading file
Editing
Running tests
Build passed
Needs approval
```

Avoid verbose technical paragraphs in the interface.

---

# 88. Completion Summary

At end of a task, agent should return:

```text
Completed

Changed
- 4 files modified
- 1 file created

Validation
- npm test ✓
- npm run build ✓

Notes
- Added refresh token validation
- Updated auth service
- Added 3 tests

Cost
$0.19

Tokens
Input 43K
Output 6K
```

---

# 89. Development Quality Rules

The implementation must:

- use TypeScript strict mode
- avoid `any` unless unavoidable
- use clear domain boundaries
- use reusable components
- validate IPC inputs
- validate provider responses
- handle failures
- avoid giant files
- avoid duplicated state
- avoid leaking secrets
- include tests for critical logic

---

# 90. Testing Requirements

Unit tests:

- permission engine
- provider normalization
- cost calculation
- context selection
- tool validation
- queue state
- checkpoint restore

Integration tests:

- open project
- read/edit file
- run terminal
- agent task
- provider error
- plan approval

E2E:

- launch Electron
- open test project
- send task
- approve plan
- edit file
- show diff
- revert
- close/reopen

---

# 91. Implementation Order

Follow this order exactly unless blocked:

```text
1. Scaffold Electron + React + TypeScript + Vite
2. Configure secure Electron IPC
3. Create core dark layout
4. Implement i18n foundation with Thai and English
5. Implement project opening
5. Implement filesystem service
6. Implement search
7. Implement SQLite
8. Implement provider abstraction
9. Implement OpenAI-compatible provider
10. Implement provider settings
11. Implement secure API key storage
12. Implement chat streaming
13. Implement tool registry
14. Implement read/search/edit tools
15. Implement terminal with node-pty
16. Implement agent loop
17. Implement agent timeline
18. Implement Plan Mode
19. Implement Build Mode
20. Implement permission engine
21. Implement changes tracking
22. Implement Monaco Diff
23. Implement checkpoints
24. Implement model selector
25. Implement token/cost tracking
26. Implement queue
27. Implement Context panel
28. Implement Monaco Code View
29. Implement Git
30. Implement Preview
31. Implement Skills
32. Implement MCP
33. Add Playwright E2E
34. Build Windows installer
35. Fix installer/runtime issues
36. Final QA
```

---

# 92. Definition of Done

Do not consider the project finished because the UI looks complete.

D4IDE is finished only when:

- it installs on Windows
- opens local projects
- connects to real AI APIs
- agent can inspect a repository
- Plan Mode works
- Build Mode works
- agent edits multiple files
- terminal works
- tests/build can run
- changes are reviewable
- changes can be undone
- API keys are secure
- app does not crash during normal use
- provider errors are recoverable
- sessions persist
- installer can be distributed

---

# 93. Instructions to the Coding Agent

You are building **D4IDE**.

Do not stop after scaffolding.

Do not create placeholder-only screens and claim completion.

Do not leave core flows mocked if real implementation is reasonably possible.

Do not require the user to repeatedly tell you to continue.

Continue implementing until the requested milestone is actually functional.

When blocked:

1. inspect the problem
2. read logs
3. fix it
4. retry
5. validate the result

Before final completion:

```text
pnpm test
pnpm build
pnpm dist
```

must be attempted.

Fix all implementation errors that are within the project's control.

---

# 94. Final Deliverables

Deliver:

```text
D4IDE source code
README.md
architecture documentation
provider configuration documentation
security notes
Thai and English localization files
Windows build instructions
D4IDE-Setup.exe
```

Also include:

```text
sample .d4ide/rules.md
sample .d4ide/skills/
sample .d4ide/mcp.json
```

---

# 95. Final Product Direction

D4IDE should feel like:

> a focused AI-native coding workspace where the user can describe a software task, approve a plan, watch the agent implement it, inspect every change, control cost, and switch between AI providers freely.

The core strengths of D4IDE must be:

```text
Agent-first workflow
Multi-provider BYOK
Clean dark UX
Plan before build
Transparent file changes
Safe terminal access
Context visibility
Cost visibility
Provider flexibility
Windows-first desktop experience
```

Build D4IDE as a real product, not a demo.
