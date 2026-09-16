import { PermissionMode, ToolCall } from '../../shared/types';

const DESTRUCTIVE_COMMANDS = [
  /rm\s+-rf\s+\/+/i,
  /del\s+.*[a-z]:\\/i,
  /format\s+[a-z]:/i,
  /diskpart/i,
  /drop\s+database/i,
  /truncate\s+table/i,
  /git\s+reset\s+--hard/i,
  /git\s+clean\s+-fdx/i,
  /git\s+push\s+.*--force/i
];

export class PermissionEngine {
  isDangerousCommand(cmd: string): boolean {
    return DESTRUCTIVE_COMMANDS.some((regex) => regex.test(cmd));
  }

  check(mode: PermissionMode, toolCall: ToolCall): { allowed: boolean; requiresApproval: boolean; reason?: string } {
    const { name, args } = toolCall;

    // Check for extreme destructive commands
    if (name === 'run_terminal' && args.command) {
      if (this.isDangerousCommand(args.command)) {
        return {
          allowed: false,
          requiresApproval: true,
          reason: `Dangerous system command blocked by security guardrails: "${args.command}"`
        };
      }
    }

    if (mode === 'full') {
      return { allowed: true, requiresApproval: false };
    }

    // Read-only tools are always allowed in safe mode
    const readOnlyTools = new Set([
      'read_file',
      'list_directory',
      'search_files',
      'grep',
      'git_status',
      'git_diff',
      'git_log',
      'fetch_url',
      'create_checkpoint'
    ]);

    if (readOnlyTools.has(name)) {
      return { allowed: true, requiresApproval: false };
    }

    // Safe mode allows test and build commands automatically
    if (mode === 'safe' && (name === 'run_tests' || name === 'run_build')) {
      return { allowed: true, requiresApproval: false };
    }

    // Otherwise requires approval
    return {
      allowed: true,
      requiresApproval: true,
      reason: `Tool "${name}" modifies files or executes shell commands under "${mode}" permission mode.`
    };
  }
}

export const permissionEngine = new PermissionEngine();
