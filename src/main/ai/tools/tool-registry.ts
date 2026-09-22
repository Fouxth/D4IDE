import path from 'path';
import fs from 'fs';
import { fileService } from '../../filesystem/file-service';
import { terminalService } from '../../terminal/terminal-service';
import { gitService } from '../../git/git-service';
import { appStore } from '../../database/store';
import { mcpClient, McpToolInfo } from '../../mcp/mcp-client';
import { browserService } from '../../browser/browser-service';
import { subagentRoleNames } from '../agent/subagents';
import { previewRegistry } from '../../preview/preview-registry';
import { planDevServerLaunch, scriptBodyFor } from '../../preview/dev-server';
import { ToolCall, ToolResult, FileChange, Checkpoint } from '../../../shared/types';

const SUBAGENT_ROLES = subagentRoleNames();

/**
 * The answer a background command gets once it is running.
 *
 * The port is deliberately part of it: an agent that started a server knows
 * where to look, instead of probing whatever address the tooling happens to
 * print next.
 */
function backgroundStarted(started: { id: string; pid: number }, command: string): Record<string, unknown> {
  return {
    success: true,
    terminalId: started.id,
    pid: started.pid,
    message:
      `Started in the background (terminal ${started.id}). It keeps running; do not wait for it. ` +
      'Use browser_navigate against its address to check the page, and read the terminal output if it fails to start.',
    command
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
  /** Tools that cannot run while the agent is in Plan Mode (spec §7). */
  mutating?: boolean;
  /**
   * The runtime answers this tool by asking the user, not by running code. It is
   * advertised like any other tool so every provider sees it, but `execute` is
   * never reached — see `AgentRuntime.handleQuestionCall`.
   */
  interactive?: boolean;
  execute: (args: any, projectPath: string, onFileChange?: (change: FileChange) => void) => Promise<any>;
}

/** Pick the right package-manager command from the project's lockfile. */
export function detectScriptCommand(projectPath: string, script: 'test' | 'build'): string {
  const hasPnpm = fs.existsSync(path.join(projectPath, 'pnpm-lock.yaml'));
  const runner = hasPnpm ? 'pnpm' : fs.existsSync(path.join(projectPath, 'yarn.lock')) ? 'yarn' : 'npm';
  return script === 'build' ? `${runner} run build` : `${runner} test`;
}

/** True when the project declares the given script in package.json. */
export function hasPackageScript(projectPath: string, script: 'test' | 'build'): boolean {
  try {
    const pkgFile = path.join(projectPath, 'package.json');
    if (!fs.existsSync(pkgFile)) return false;
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    return !!pkg?.scripts?.[script];
  } catch {
    return false;
  }
}

const SKIP_GREP_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.pdf',
  '.exe',
  '.bin',
  '.dll',
  '.so',
  '.zip',
  '.lock'
]);

export type SubagentRunner = (
  args: { role: string; task: string },
  projectPath: string
) => Promise<{ role: string; report: string; steps: number; files: string[] }>;

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private subagentRunner: SubagentRunner | null = null;

  constructor() {
    this.registerDefaults();
  }

  /** Wired by the agent runtime, which owns provider access and permissions. */
  setSubagentRunner(runner: SubagentRunner | null): void {
    this.subagentRunner = runner;
  }

  private resolvePath(target: string | undefined, projectPath: string): string {
    if (!target) return projectPath;
    return path.isAbsolute(target) ? target : path.join(projectPath, target);
  }

  private relative(fullPath: string, projectPath: string): string {
    return path.relative(projectPath, fullPath).replace(/\\/g, '/');
  }

  /** Lines that changed, used for the +/- counters in the Changes panel. */
  private diffStats(previous: string, next: string): { additions: number; deletions: number } {
    const before = previous ? previous.split('\n') : [];
    const after = next ? next.split('\n') : [];
    const beforeSet = new Map<string, number>();
    for (const line of before) beforeSet.set(line, (beforeSet.get(line) || 0) + 1);

    let additions = 0;
    for (const line of after) {
      const remaining = beforeSet.get(line) || 0;
      if (remaining > 0) beforeSet.set(line, remaining - 1);
      else additions++;
    }

    const afterSet = new Map<string, number>();
    for (const line of after) afterSet.set(line, (afterSet.get(line) || 0) + 1);
    let deletions = 0;
    for (const line of before) {
      const remaining = afterSet.get(line) || 0;
      if (remaining > 0) afterSet.set(line, remaining - 1);
      else deletions++;
    }

    return { additions, deletions };
  }

  private registerDefaults() {
    this.register({
      name: 'read_file',
      description: 'Read the text content of a file in the project.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Relative or absolute path to the file' } },
        required: ['path']
      },
      execute: async (args, projectPath) => fileService.readFile(this.resolvePath(args.path, projectPath))
    });

    this.register({
      name: 'write_file',
      description: 'Write or completely overwrite a file with full content.',
      mutating: true,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative or absolute path to the file' },
          content: { type: 'string', description: 'The complete content to write' }
        },
        required: ['path', 'content']
      },
      execute: async (args, projectPath, onFileChange) => {
        const fullPath = this.resolvePath(args.path, projectPath);
        const relPath = this.relative(fullPath, projectPath);
        const exists = fs.existsSync(fullPath);
        const prevContent = exists ? fs.readFileSync(fullPath, 'utf8') : '';
        const nextContent = String(args.content ?? '');

        fileService.writeFile(fullPath, nextContent);
        const stats = this.diffStats(prevContent, nextContent);

        onFileChange?.({
          path: fullPath,
          relativePath: relPath,
          type: exists ? 'modified' : 'created',
          previousContent: prevContent,
          newContent: nextContent,
          ...stats
        });
        return `Successfully wrote ${nextContent.split('\n').length} lines to ${relPath}`;
      }
    });

    this.register({
      name: 'edit_file',
      description: 'Perform a targeted replacement in a file (find targetContent and replace with replacementContent).',
      mutating: true,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          targetContent: { type: 'string', description: 'The exact string snippet to find and replace' },
          replacementContent: { type: 'string', description: 'The new string snippet to substitute' }
        },
        required: ['path', 'targetContent', 'replacementContent']
      },
      execute: async (args, projectPath, onFileChange) => {
        const fullPath = this.resolvePath(args.path, projectPath);
        const relPath = this.relative(fullPath, projectPath);
        const content = fileService.readFile(fullPath);
        const target = String(args.targetContent ?? '');

        if (!target) throw new Error('targetContent must not be empty.');
        const occurrences = content.split(target).length - 1;
        if (occurrences === 0) {
          throw new Error(`targetContent not found in ${relPath}. Check whitespace and line breaks.`);
        }
        if (occurrences > 1) {
          throw new Error(`targetContent appears ${occurrences} times in ${relPath}. Include more surrounding context.`);
        }

        const newContent = content.replace(target, String(args.replacementContent ?? ''));
        fileService.writeFile(fullPath, newContent);
        const stats = this.diffStats(content, newContent);

        onFileChange?.({
          path: fullPath,
          relativePath: relPath,
          type: 'modified',
          previousContent: content,
          newContent,
          ...stats
        });
        return `Successfully updated ${relPath} (${stats.additions} added, ${stats.deletions} removed)`;
      }
    });

    this.register({
      name: 'create_file',
      description: 'Create a new file in the project.',
      mutating: true,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          content: { type: 'string', description: 'Initial file content' }
        },
        required: ['path']
      },
      execute: async (args, projectPath, onFileChange) => {
        const fullPath = this.resolvePath(args.path, projectPath);
        const relPath = this.relative(fullPath, projectPath);
        const content = String(args.content ?? '');
        fileService.createFile(fullPath, content);

        onFileChange?.({
          path: fullPath,
          relativePath: relPath,
          type: 'created',
          previousContent: '',
          newContent: content,
          additions: content.split('\n').length,
          deletions: 0
        });
        return `Created file ${relPath}`;
      }
    });

    this.register({
      name: 'delete_file',
      description: 'Delete a file from the project.',
      mutating: true,
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'File path to delete' } },
        required: ['path']
      },
      execute: async (args, projectPath, onFileChange) => {
        const fullPath = this.resolvePath(args.path, projectPath);
        const relPath = this.relative(fullPath, projectPath);
        const prevContent = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
        fileService.deleteFile(fullPath);

        onFileChange?.({
          path: fullPath,
          relativePath: relPath,
          type: 'deleted',
          previousContent: prevContent,
          newContent: '',
          additions: 0,
          deletions: prevContent.split('\n').length
        });
        return `Deleted ${relPath}`;
      }
    });

    this.register({
      name: 'move_file',
      description: 'Move or rename a file or directory inside the project.',
      mutating: true,
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Existing path' },
          to: { type: 'string', description: 'Destination path' }
        },
        required: ['from', 'to']
      },
      execute: async (args, projectPath) => {
        const from = this.resolvePath(args.from, projectPath);
        const to = this.resolvePath(args.to, projectPath);
        fileService.renameFile(from, to);
        return `Moved ${this.relative(from, projectPath)} → ${this.relative(to, projectPath)}`;
      }
    });

    this.register({
      name: 'list_directory',
      description: 'List subdirectories and files in a directory.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Directory path relative to project or absolute' } }
      },
      execute: async (args, projectPath) => fileService.getTree(this.resolvePath(args.path, projectPath), 2)
    });

    this.register({
      name: 'get_project_tree',
      description: 'Get the project file tree (use for orientation before searching).',
      parameters: {
        type: 'object',
        properties: {
          depth: { type: 'number', description: 'Maximum directory depth (default 3)' }
        }
      },
      execute: async (args, projectPath) => fileService.getTree(projectPath, Math.min(args.depth || 3, 6))
    });

    this.register({
      name: 'search_files',
      description: 'Search for files matching a filename query.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Filename or path snippet to search' },
          limit: { type: 'number', description: 'Maximum results (default 100)' }
        },
        required: ['query']
      },
      execute: async (args, projectPath) => fileService.searchFiles(projectPath, args.query, args.limit || 100)
    });

    this.register({
      name: 'grep',
      description: 'Search across all project files for text occurrences.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to search across files' },
          limit: { type: 'number', description: 'Maximum matches (default 100)' }
        },
        required: ['query']
      },
      execute: async (args, projectPath) => fileService.grep(projectPath, args.query, args.limit || 100)
    });

    this.register({
      name: 'find_symbol',
      description: 'Find where a class, function, interface, type or variable is declared.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Symbol name to locate' } },
        required: ['name']
      },
      execute: async (args, projectPath) => {
        const symbol = String(args.name);
        const declaration = new RegExp(
          `(class|function|interface|type|enum|const|let|var|def|struct|impl)\\s+${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`
        );
        const matches = fileService.grep(projectPath, symbol, 200).filter((m) => declaration.test(m.text));
        return matches.length > 0 ? matches : fileService.grep(projectPath, symbol, 30);
      }
    });

    this.register({
      name: 'run_terminal',
      description:
        'Execute a shell command inside the project directory. Set background=true for a command that is meant to keep running — a dev server or a file watcher: it is started in a terminal that stays open, this call returns immediately, and the preview panel picks up the address the server prints. Never run a dev server in the foreground; it would block until the timeout and then be killed.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run' },
          background: {
            type: 'boolean',
            description: 'Start the command in a terminal that keeps running (dev server, watcher) instead of waiting for it to finish'
          },
          port: {
            type: 'number',
            description:
              'The port the command listens on, when it is known — lets the preview open before the server has printed anything. Leave it out and the app picks one from this project\u2019s own range (1000+ for a frontend, 3000+ for a backend) and passes it to the command; do not invent one.'
          }
        },
        required: ['command']
      },
      execute: async (args, projectPath) => {
        const command = String(args.command);
        if (!args.background) return terminalService.runCommandOnce(command, projectPath);

        // A port named up front is registered immediately, so the panel can
        // open while the server is still booting rather than after it has
        // printed its banner.
        const named = Number(args.port);
        if (Number.isFinite(named) && named > 0 && named < 65536) {
          previewRegistry.remember(`http://localhost:${named}`, 'run_terminal', projectPath);
          const started = terminalService.startServer(command, projectPath);
          return backgroundStarted(started, command);
        }

        // Otherwise the port is this app's decision, and the same one the
        // preview panel would make: 1000+ for a frontend, 3000+ for a backend,
        // never a port another project is already holding. A dev server the
        // agent starts is a dev server the user will want to look at.
        const script = scriptBodyFor(projectPath, command);
        const plan = await planDevServerLaunch({
          projectPath,
          command,
          script: script?.script,
          body: script?.body
        });
        if (plan.port) previewRegistry.remember(`http://localhost:${plan.port}`, 'run_terminal', projectPath);
        // `PORT` as well as the flag: a command that takes no port argument —
        // `node server.js` — reads the variable instead.
        const started = plan.port
          ? terminalService.startServer(plan.command, projectPath, undefined, { PORT: String(plan.port) })
          : terminalService.startServer(plan.command, projectPath);
        return {
          ...backgroundStarted(started, plan.command),
          port: plan.port ?? undefined,
          url: plan.port ? `http://localhost:${plan.port}` : undefined
        };
      }
    });

    this.register({
      name: 'run_tests',
      description: 'Run project tests (e.g., npm test, pnpm test, pytest).',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'Custom test command' } }
      },
      execute: async (args, projectPath) =>
        terminalService.runCommandOnce(args.command || detectScriptCommand(projectPath, 'test'), projectPath)
    });

    this.register({
      name: 'run_build',
      description: 'Run the project build (e.g., npm run build, pnpm build).',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'Custom build command' } }
      },
      execute: async (args, projectPath) =>
        terminalService.runCommandOnce(args.command || detectScriptCommand(projectPath, 'build'), projectPath)
    });

    this.register({
      name: 'git_status',
      description: 'Get git status of the current repository.',
      parameters: { type: 'object', properties: {} },
      execute: async (_args, projectPath) => gitService.getStatus(projectPath)
    });

    this.register({
      name: 'git_diff',
      description: 'Inspect unstaged git diff.',
      parameters: {
        type: 'object',
        properties: { filePath: { type: 'string', description: 'Optional specific file path' } }
      },
      execute: async (args, projectPath) => gitService.getDiff(projectPath, args.filePath)
    });

    this.register({
      name: 'git_log',
      description: 'Read recent commit history.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'Number of commits (default 15)' } }
      },
      execute: async (args, projectPath) => gitService.getLog(projectPath, args.limit || 15)
    });

    this.register({
      name: 'git_branch',
      description: 'List local git branches and the current one.',
      parameters: { type: 'object', properties: {} },
      execute: async (_args, projectPath) => gitService.getBranches(projectPath)
    });

    this.register({
      name: 'git_commit',
      description: 'Stage all modified files and commit with a message.',
      mutating: true,
      parameters: {
        type: 'object',
        properties: { message: { type: 'string', description: 'Commit message' } },
        required: ['message']
      },
      execute: async (args, projectPath) => gitService.commit(projectPath, String(args.message))
    });

    this.register({
      name: 'fetch_url',
      description: 'Fetch the readable text of a URL for documentation or API reference.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Absolute http(s) URL' },
          maxChars: { type: 'number', description: 'Maximum characters to return (default 12000)' }
        },
        required: ['url']
      },
      execute: async (args) => {
        const url = String(args.url);
        if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs can be fetched.');
        const res = await fetch(url, { redirect: 'follow' });
        const text = await res.text();
        const limit = Math.min(args.maxChars || 12000, 40000);
        const stripped = text
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim();
        return { status: res.status, url, content: stripped.slice(0, limit) };
      }
    });

    // Browser automation (spec §82). The sandbox keeps navigation on loopback,
    // private addresses and project files — see browser-service.ts.
    this.register({
      name: 'browser_navigate',
      description:
        'Open a URL in the sandboxed automation browser and return the page title, HTTP status and final URL. ' +
        'Call this before any other browser_ tool. Allowed targets: localhost or a private address, a bare machine ' +
        'name such as "my-pc:5173", or an http(s)/file URL inside this project.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to open, e.g. http://localhost:5173 or preview.html' }
        },
        required: ['url']
      },
      execute: async (args, projectPath) => browserService.navigate(projectPath, String(args.url))
    });

    this.register({
      name: 'browser_inspect',
      description:
        'Read what is on screen in the automation browser. Without a selector it returns the visible text of the ' +
        'whole page; with a selector it returns that element’s text. Use it to check rendered content, not source.',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'Optional CSS or Playwright selector, e.g. "#app", "text=Save", ".error-banner"'
          }
        }
      },
      execute: async (args, projectPath) => browserService.inspect(projectPath, args.selector ? String(args.selector) : undefined)
    });

    this.register({
      name: 'browser_screenshot',
      description:
        'Capture the current page as a PNG, saved inside the project under .d4ide/screenshots/. Returns the file path; ' +
        'the image is also shown to the user, so use it to document what the UI looks like right now.',
      parameters: {
        type: 'object',
        properties: {
          fullPage: { type: 'boolean', description: 'Capture the whole scrollable page instead of the viewport' },
          label: { type: 'string', description: 'Optional short label included in the file name' }
        }
      },
      execute: async (args, projectPath) =>
        browserService.screenshot(projectPath, { fullPage: args.fullPage === true, label: args.label })
    });

    this.register({
      name: 'browser_console',
      description:
        'Read the browser console output captured so far (console.log/warn/error and uncaught page errors). ' +
        'Essential for spotting runtime errors that never reach the terminal.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'How many recent entries to return (default 50)' },
          level: { type: 'string', description: 'Filter by level: log, info, warning, error, pageerror' },
          clear: { type: 'boolean', description: 'Drop the returned entries from the buffer' }
        }
      },
      execute: async (args) => browserService.readConsole({ limit: args.limit, level: args.level, clear: args.clear === true })
    });

    this.register({
      name: 'browser_click',
      description:
        'Click an element in the automation browser and return the resulting page text. Requires browser_navigate first.',
      mutating: true,
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS or Playwright selector, e.g. "button[type=submit]" or "text=Sign in"' }
        },
        required: ['selector']
      },
      execute: async (args, projectPath) => browserService.click(projectPath, String(args.selector))
    });

    this.register({
      name: 'browser_fill',
      description: 'Type a value into an input, textarea or select in the automation browser.',
      mutating: true,
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS or Playwright selector for the field' },
          value: { type: 'string', description: 'Text to enter' }
        },
        required: ['selector', 'value']
      },
      execute: async (args, projectPath) => browserService.fill(projectPath, String(args.selector), String(args.value ?? ''))
    });

    // Delegation to specialised subagents (spec §81). The runtime injects the
    // runner because it owns the provider, the budget and the approval gate.
    this.register({
      name: 'spawn_subagent',
      description:
        'Delegate a focused job to a specialised subagent and get back a single compact report. Use it to keep your ' +
        'own context small and to get a role-specific perspective — for example a read-only sweep of an unfamiliar ' +
        'area (explore), a critique before you finish (review), independent test analysis (test), a root-cause hunt ' +
        '(debug), or to hand off a self-contained UI or schema change (frontend, database). Roles: ' +
        SUBAGENT_ROLES.join(', ') +
        '. Read-only roles cannot edit files. Subagents cannot delegate further.',
      parameters: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: SUBAGENT_ROLES, description: 'Which specialist to delegate to' },
          task: {
            type: 'string',
            description:
              'Precise assignment for the subagent: what to investigate or change, where to look, and what you need ' +
              'back. The subagent sees only this text, not your conversation.'
          }
        },
        required: ['role', 'task']
      },
      execute: async (args, projectPath) => {
        if (!this.subagentRunner) throw new Error('Subagents are unavailable in this context.');
        return this.subagentRunner({ role: String(args.role || ''), task: String(args.task || '') }, projectPath);
      }
    });

    // Bridges every tool a connected MCP server exposes (spec §42).
    this.register({
      name: 'mcp_call',
      description:
        'Call a tool exposed by a connected MCP server. Use the server id and tool name exactly as listed by the MCP integration.',
      mutating: true,
      parameters: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'MCP server id (e.g. "filesystem")' },
          tool: { type: 'string', description: 'Tool name on that server' },
          args: { type: 'object', description: 'Arguments for the tool' }
        },
        required: ['server', 'tool']
      },
      execute: async (args) => {
        const result = await mcpClient.callTool(String(args.server), String(args.tool), args.args || {});
        if (!result.success) throw new Error(result.error || 'MCP tool call failed');
        return result.output;
      }
    });

    this.register({
      name: 'ask_question',
      interactive: true,
      description:
        'Ask the user to decide something only they can decide, and wait for the answer. Give every question 2-4 concrete options (plus an optional free-text note) — never an open "what do you want?". ALWAYS include your recommendation: set "recommended": true (with a short "reason") on the option you would pick, or pass "aiSuggestion" when the lean is between options. The card shows the recommendation so the user can decide in one click — a question with no recommendation wastes their time. In Plan Mode, ask BEFORE writing the plan whenever the request leaves a real decision open: scope, target user, data source, platform, brand, how far to go. In Build Mode, ask when a detail that would change what you write is genuinely missing: which store, which provider, which currency, which folder. Do not ask about anything you can find in the project, and do not ask what the user already said. At most 4 questions per call.',
      parameters: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            description: 'One to four questions, asked together in a single card.',
            items: {
              type: 'object',
              properties: {
                header: { type: 'string', description: 'Two or three words naming the topic' },
                question: { type: 'string', description: 'The question itself, in the user\'s language' },
                aiSuggestion: { type: 'string', description: 'Your recommended answer and why, in one short sentence, when the lean is not a single option' },
                options: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string', description: 'The answer, short enough to be a button' },
                      description: { type: 'string', description: 'One line on what choosing it means' },
                      recommended: { type: 'boolean', description: 'True on the ONE option you recommend' },
                      reason: { type: 'string', description: 'One line on why it is recommended' }
                    },
                    required: ['label']
                  }
                },
                multiSelect: { type: 'boolean', description: 'True when several options can be true at once' },
                allowFreeText: { type: 'boolean', description: 'Also let the user answer in their own words' }
              },
              required: ['question']
            }
          }
        },
        required: ['questions']
      },
      execute: async () => {
        // Reachable only if the runtime forgot to intercept it; failing loudly is
        // better than a question that silently becomes an empty answer.
        throw new Error('ask_question is answered by the agent runtime, not by the tool registry');
      }
    });

    this.register({
      name: 'create_checkpoint',
      description: 'Snapshot files so the work can be restored later.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Checkpoint description' },
          paths: { type: 'array', items: { type: 'string' }, description: 'Files to snapshot' }
        },
        required: ['description']
      },
      execute: async (args, projectPath) => {
        const requested: string[] = Array.isArray(args.paths) ? args.paths : [];
        const files: Checkpoint['files'] = [];

        for (const rel of requested.slice(0, 200)) {
          const full = this.resolvePath(rel, projectPath);
          try {
            if (fs.existsSync(full) && fs.statSync(full).isFile()) {
              files.push({ path: full, content: fileService.readFile(full) });
            }
          } catch {
            // Skip unreadable files.
          }
        }

        const checkpoint: Checkpoint = {
          id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
          description: String(args.description),
          files
        };
        appStore.saveCheckpoint(checkpoint);
        return {
          checkpointId: checkpoint.id,
          files: files.length,
          message: files.length
            ? `Checkpoint created with ${files.length} file snapshot(s).`
            : 'Checkpoint created (no file paths were provided, so nothing was snapshotted).'
        };
      }
    });
  }

  register(def: ToolDefinition) {
    this.tools.set(def.name, def);
  }

  /**
   * Publish MCP tools under their qualified names so the model can call them
   * directly, in addition to the generic `mcp_call` bridge.
   */
  registerMcpTools(tools: McpToolInfo[]): void {
    for (const tool of tools) {
      this.register({
        name: tool.qualifiedName,
        description: `[MCP:${tool.serverId}] ${tool.description || tool.name}`,
        mutating: true,
        parameters: tool.inputSchema || { type: 'object', properties: {} },
        execute: async (args) => {
          const result = await mcpClient.callTool(tool.serverId, tool.name, args || {});
          if (!result.success) throw new Error(result.error || 'MCP tool call failed');
          return result.output;
        }
      });
    }
  }

  unregisterMcpTools(serverId: string): void {
    for (const name of Array.from(this.tools.keys())) {
      if (name.startsWith(`mcp__${serverId}__`)) this.tools.delete(name);
    }
  }

  getToolDefinitions(mode: 'plan' | 'build') {
    const list: { name: string; description: string; parameters: Record<string, any> }[] = [];
    for (const [name, tool] of this.tools.entries()) {
      if (mode === 'plan' && tool.mutating) continue;
      list.push({ name: tool.name, description: tool.description, parameters: tool.parameters });
    }
    return list;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(
    toolCall: ToolCall,
    projectPath: string,
    onFileChange?: (change: FileChange) => void
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      return { toolCallId: toolCall.id, success: false, error: `Unknown tool: ${toolCall.name}` };
    }

    try {
      const output = await tool.execute(toolCall.args, projectPath, onFileChange);
      return { toolCallId: toolCall.id, success: true, output };
    } catch (e: any) {
      return { toolCallId: toolCall.id, success: false, error: e?.message || 'Tool execution failed' };
    }
  }
}

export const toolRegistry = new ToolRegistry();
export { SKIP_GREP_EXTENSIONS };
