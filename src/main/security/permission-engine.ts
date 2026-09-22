import path from 'path';
import { PermissionMode, ToolCall } from '../../shared/types';
import { getSubagent, subagentRoleNames } from '../ai/agent/subagents';
import { lawEnabled, outsideProjectRefusal, projectDeletionRefusal } from '../../shared/rules';
import { checkProjectScope, deletesProjectRoot, isRecursiveDelete, writesOutsideProject } from './scope-guard';

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
  'browser_fill',
  // Asking the user a question changes nothing: it is answered by the runtime
  // and must never be gated behind a dialog about permissions.
  'ask_question'
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

/**
 * What the guardrails need to know about *this* run.
 *
 * The project folder is the boundary every file tool is measured against, and
 * the request flag is what makes "never delete the project unless instructed"
 * mean what it says: the runtime reads the user's own words, not the model's
 * summary of them.
 */
export interface PermissionContext {
  projectPath?: string | null;
  /** The user's request for this run asked for the project to be destroyed. */
  explicitDestructiveRequest?: boolean;
  language?: 'th' | 'en';
  /**
   * Standing laws the user switched off. Absent means all of them are in force,
   * which is what every caller that does not pass settings gets.
   */
  disabledLaws?: string[] | null;
}

/** Tools whose path argument names a file or folder in the project. */
const PATH_ARGUMENTS: Record<string, string[]> = {
  read_file: ['path'],
  write_file: ['path'],
  edit_file: ['path'],
  create_file: ['path'],
  delete_file: ['path'],
  move_file: ['from', 'to'],
  list_directory: ['path']
};

export class PermissionEngine {
  isDangerousCommand(cmd: string): boolean {
    return DESTRUCTIVE_COMMANDS.some((regex) => regex.test(cmd));
  }

  isSensitiveCommand(cmd: string): boolean {
    return SENSITIVE_COMMAND_PATTERNS.some((regex) => regex.test(cmd));
  }

  check(
    mode: PermissionMode,
    toolCall: ToolCall,
    rules: PermissionRules = {},
    context: PermissionContext = {}
  ): PermissionDecision {
    const { name, args = {} } = toolCall;
    const language = context.language === 'en' ? 'en' : 'th';
    const projectPath = context.projectPath ?? null;

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

    // 2. The project-deletion law: the folder the user handed over is not
    // something a run may throw away on its own initiative. `rm -rf .`,
    // `rm -rf *`, `git clean -xfd` at the root and a `delete_file` on the root
    // or on a folder that contains it are the shapes this takes.
    const deletionTarget =
      name === 'run_terminal' && typeof args.command === 'string'
        ? deletesProjectRoot(args.command, projectPath)
          ? args.command
          : null
        : null;
    const fileDeletion =
      name === 'delete_file' && typeof args.path === 'string'
        ? checkProjectScope(projectPath, args.path)
        : null;
    const deletesRoot =
      !!deletionTarget ||
      (!!fileDeletion &&
        !!projectPath &&
        (fileDeletion.resolved === path.resolve(projectPath) || fileDeletion.isRootOrAbove));

    if (deletesRoot && lawEnabled('never-delete-the-project', context.disabledLaws)) {
      const target = deletionTarget ?? String(args.path ?? '');
      // A run that was handed `F:\HuayD` and asked to delete `F:\HuayD` is the
      // one case the law allows — and it still asks, unless the user has also
      // switched to Full Access.
      if (context.explicitDestructiveRequest) {
        if (mode === 'full') {
          return {
            allowed: true,
            requiresApproval: false,
            reason: `The user asked for the project to be removed and Full Access is on: "${target}".`
          };
        }
        return {
          allowed: true,
          requiresApproval: true,
          reason:
            language === 'th'
              ? `ผู้ใช้สั่งให้ลบโปรเจกต์ทั้งหมด — ยืนยันอีกครั้งก่อนลบจริง: “${target}”`
              : `The user asked for the whole project to be removed — confirm once more: "${target}".`
        };
      }
      return { allowed: false, requiresApproval: true, reason: projectDeletionRefusal(language, target) };
    }

    // 3. The project-scope law: files and writes stay inside the folder the run
    // was given. Refused in every mode — "stay in the project" is not a
    // preference the model can be argued out of.
    const pathArgs = PATH_ARGUMENTS[name];
    if (pathArgs && projectPath && lawEnabled('stay-in-project', context.disabledLaws)) {
      for (const key of pathArgs) {
        const value = args[key];
        if (typeof value !== 'string' || !value.trim()) continue;
        const scope = checkProjectScope(projectPath, value);
        if (!scope.inside) {
          return {
            allowed: false,
            requiresApproval: true,
            reason: outsideProjectRefusal(language, value, projectPath)
          };
        }
      }
    }
    if (
      name === 'run_terminal' &&
      typeof args.command === 'string' &&
      projectPath &&
      lawEnabled('stay-in-project', context.disabledLaws)
    ) {
      const outside = writesOutsideProject(args.command, projectPath);
      if (outside) {
        return {
          allowed: false,
          requiresApproval: true,
          reason: outsideProjectRefusal(language, outside, projectPath)
        };
      }
    }

    // 4. Explicit user rules.
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

    // 5. Full Access automates normal coding, still asks for the sensitive stuff.
    if (mode === 'full') {
      const needsReview =
        (name === 'run_terminal' && typeof args.command === 'string' && this.isSensitiveCommand(args.command)) ||
        (name === 'delete_file' && lawEnabled('confirm-recursive-delete', context.disabledLaws)) ||
        (name === 'git_commit' && args.force === true);
      return {
        allowed: true,
        requiresApproval: needsReview,
        reason: needsReview ? `"${name}" touches something the user should confirm even in Full Access.` : undefined
      };
    }

    // 5b. A recursive delete inside the project: allowed work, but never silent
    // under Safe/Ask — it removes many files in one call and the user should
    // hear the exact command first.
    if (
      name === 'run_terminal' &&
      typeof args.command === 'string' &&
      isRecursiveDelete(args.command) &&
      lawEnabled('confirm-recursive-delete', context.disabledLaws)
    ) {
      return {
        allowed: true,
        requiresApproval: true,
        reason:
          language === 'th'
            ? `ลบหลายไฟล์พร้อมกันในครั้งเดียว — ยืนยันก่อนรัน: “${args.command}”`
            : `One call that deletes several files at once — confirm before it runs: "${args.command}".`
      };
    }
    if (name === 'delete_file' && lawEnabled('confirm-recursive-delete', context.disabledLaws)) {
      return {
        allowed: true,
        requiresApproval: true,
        reason:
          language === 'th'
            ? 'การลบไฟล์เป็นการทำลายที่ย้อนกลับไม่ได้ — ยืนยันก่อนลบ'
            : 'Deleting a file cannot be undone — confirm before it runs.'
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
