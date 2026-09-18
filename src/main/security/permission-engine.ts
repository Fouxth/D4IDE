import { PermissionMode, ToolCall } from '../../shared/types';
import { getSubagent, subagentRoleNames } from '../ai/agent/subagents';

/** Patterns that are blocked outright, regardless of permission mode (spec §14). */
const DESTRUCTIVE_COMMANDS = [
  /\brm\s+(-[a-z]*\s+)*-[a-z]*r[a-z]*f?\s+\/(\s|$)/i,
  /\brm\s+-rf\s+[a-z]:[\\/]/i,
  /\bdel\s+\/s\s+\/q\s+[a-z]:\\/i,
  /\bformat\s+[a-z]:/i,
  /\bdiskpart\b/i,
  /\bmkfs(\.\w+)?\b/i,
  /\bdd\s+if=.*of=\/dev\//i,
  /\b(shutdown|reboot)\s+(-[a-z]|\/)/i,
  /\bdrop\s+database\b/i,
  /\btruncate\s+table\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f[a-z]*d?[a-z]*x?\b/i,
  /\bgit\s+push\b.*(--force|-f)\b/i,
  />\s*\/dev\/sd[a-z]/i,
  /\bRemove-Item\b.*-Recurse.*[a-z]:\\/i
];

/** Tools that only read state and are always safe to auto-run. */
const READ_ONLY_TOOLS = new Set([
  'read_file',
  'list_directory',
  'search_files',
  'grep',
  'find_symbol',
  'get_project_tree',
  'git_status',
  'git_diff',
  'git_log',
  'git_branch',
  'fetch_url',
  // Browser tools operate on a sandboxed page that can only reach loopback,
  // private addresses and files inside the project, so they cannot touch the
  // user's source tree or system. Clicking and filling a local dev page is not
  // a mutation of the workspace, and gating every click behind a dialog would
  // make the visual loop unusable.
  'browser_navigate',
  'browser_inspect',
  'browser_screenshot',
  'browser_console',
  'browser_click',
  'browser_fill'
]);

/**
 * Subagent roles that cannot modify anything. Kept in sync with the role
 * catalogue in `ai/agent/subagents.ts` by a test, so the security boundary
 * cannot drift away from the prompts.
 */
export const READ_ONLY_SUBAGENT_ROLES = new Set(['explore', 'review', 'test', 'debug']);

/** Tools that mutate the workspace or system state. */
const WRITE_TOOLS = new Set([
  'write_file',
  'edit_file',
  'create_file',
  'delete_file',
  'move_file',
  'git_commit',
  'mcp_call',
  'spawn_subagent'
]);

/** Extra confirmation-worthy commands inside an otherwise allowed terminal call. */
const SENSITIVE_COMMAND_PATTERNS = [
  /\b(npm|pnpm|yarn|bun)\s+(install|add|i)\b/i,
  /\bpip\s+install\b/i,
  /\bgit\s+(commit|push|merge|rebase)\b/i,
  /\bmigrat(e|ion)\b/i,
  /\bdocker\b/i
];

export interface PermissionDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
}

export interface PermissionRules {
  /** Tool names the user has decided to always allow. */
  alwaysAllow?: string[];
  /** Tool names the user has decided to always block. */
  alwaysBlock?: string[];
}

export class PermissionEngine {
  isDangerousCommand(cmd: string): boolean {
    return DESTRUCTIVE_COMMANDS.some((regex) => regex.test(cmd));
  }

  isSensitiveCommand(cmd: string): boolean {
    return SENSITIVE_COMMAND_PATTERNS.some((regex) => regex.test(cmd));
  }

  check(mode: PermissionMode, toolCall: ToolCall, rules: PermissionRules = {}): PermissionDecision {
    const { name, args = {} } = toolCall;

    // 1. Hard guardrails win over every mode and every user rule.
    if (name === 'run_terminal' && typeof args.command === 'string') {
      if (this.isDangerousCommand(args.command)) {
        return {
          allowed: false,
          requiresApproval: true,
          reason: `Dangerous system command blocked by security guardrails: "${args.command}"`
        };
      }
    }
    if (name === 'run_terminal' && typeof args.command === 'string' && /\brm\s+-rf\b/i.test(args.command)) {
      return {
        allowed: false,
        requiresApproval: true,
        reason: `Recursive delete blocked by security guardrails: "${args.command}"`
      };
    }

    // 2. Explicit user rules.
    if (rules.alwaysBlock?.includes(name)) {
      return { allowed: false, requiresApproval: true, reason: `Tool "${name}" is blocked in Settings → Permissions.` };
    }
    if (rules.alwaysAllow?.includes(name)) {
      return { allowed: true, requiresApproval: false };
    }

    // 3. Read-only work never needs approval.
    if (READ_ONLY_TOOLS.has(name)) {
      return { allowed: true, requiresApproval: false };
    }

    // 3b. Delegating to a read-only subagent is itself read-only; a subagent
    // that can write goes through the normal confirmation rules below.
    if (name === 'spawn_subagent') {
      const role = String(args.role ?? '');
      // A role we cannot classify must not be guessed at: refuse it and name the
      // roles that exist, rather than asking the user to approve a typo.
      if (!getSubagent(role)) {
        return {
          allowed: false,
          requiresApproval: true,
          reason:
            `spawn_subagent requires a known role: "${role || '(none)'}" is not one. ` +
            `Valid roles: ${subagentRoleNames().join(', ')}.`
        };
      }
      if (READ_ONLY_SUBAGENT_ROLES.has(role)) {
        return { allowed: true, requiresApproval: false };
      }
      return {
        allowed: true,
        requiresApproval: mode !== 'full',
        reason: `The "${role}" subagent can modify the project, so it needs confirmation under "${mode}" mode.`
      };
    }

    // 4. Full Access automates normal coding, still asks for the sensitive stuff.
    if (mode === 'full') {
      const needsReview =
        (name === 'run_terminal' && typeof args.command === 'string' && this.isSensitiveCommand(args.command)) ||
        name === 'delete_file' ||
        (name === 'git_commit' && args.force === true);
      return {
        allowed: true,
        requiresApproval: needsReview,
        reason: needsReview ? `"${name}" touches something the user should confirm even in Full Access.` : undefined
      };
    }

    // 5. Safe mode auto-runs tests/builds and checkpointing.
    if (mode === 'safe') {
      if (name === 'run_tests' || name === 'run_build' || name === 'create_checkpoint') {
        return { allowed: true, requiresApproval: false };
      }
      if (name === 'run_terminal' && typeof args.command === 'string' && !this.isSensitiveCommand(args.command)) {
        const looksReadOnly = /^(git\s+(status|diff|log|branch|show)|(npm|pnpm)\s+(test|run\s+\w+)|dir|ls|type|cat|echo|node\s+-v|npm\s+-v)\b/i.test(
          args.command.trim()
        );
        if (looksReadOnly) return { allowed: true, requiresApproval: false };
      }
    }

    // 6. Ask mode confirms every shell command; both modes confirm writes.
    if (mode === 'ask' && name === 'run_terminal') {
      return {
        allowed: true,
        requiresApproval: true,
        reason: `Ask mode requires confirmation for every terminal command.`
      };
    }

    return {
      allowed: true,
      requiresApproval: true,
      reason: `"${name}" modifies files or runs commands under "${mode}" permission mode.`
    };
  }
}

export const permissionEngine = new PermissionEngine();
export { READ_ONLY_TOOLS, WRITE_TOOLS };
