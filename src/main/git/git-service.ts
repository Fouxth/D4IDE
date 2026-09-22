import { execFile } from 'child_process';
import { promisify } from 'util';
import { GitStatusSummary } from '../../shared/types';

const execFileAsync = promisify(execFile);

export interface GitBranchInfo {
  name: string;
  current: boolean;
  remote?: string;
}

export interface GitLogEntry {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * What `git status --porcelain` says, split by column.
 *
 * Kept out of the service so the parsing — the part that can be wrong in a
 * quiet way — is testable without a repository on disk.
 */
export function parsePorcelain(output: string): { staged: string[]; unstaged: string[]; untracked: string[] } {
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];

  for (const line of output.split('\n').filter(Boolean)) {
    const x = line[0];
    const y = line[1];
    const file = line.substring(3).trim();
    if (!file) continue;

    if (x === '?' && y === '?') {
      untracked.push(file);
      continue;
    }
    if (x !== ' ' && x !== '?') staged.push(file);
    if (y !== ' ' && y !== '?') unstaged.push(file);
  }

  return { staged, unstaged, untracked };
}

export class GitService {
  private async git(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024, windowsHide: true });
    return stdout;
  }

  /** Run a git command without throwing, for the agent's tool surface. */
  async run(cwd: string, args: string[]): Promise<GitCommandResult> {
    try {
      const stdout = await this.git(cwd, args);
      return { stdout, stderr: '', exitCode: 0 };
    } catch (e: any) {
      return {
        stdout: e?.stdout?.toString?.() ?? '',
        stderr: e?.stderr?.toString?.() ?? e?.message ?? 'git command failed',
        exitCode: typeof e?.code === 'number' ? e.code : 1
      };
    }
  }

  async isGitRepo(cwd: string): Promise<boolean> {
    try {
      await this.git(cwd, ['rev-parse', '--is-inside-work-tree']);
      return true;
    } catch {
      return false;
    }
  }

  /** `origin`'s URL, or the first remote there is. Null when there is none. */
  async getRemote(cwd: string): Promise<string | null> {
    const origin = await this.run(cwd, ['remote', 'get-url', 'origin']);
    if (origin.exitCode === 0 && origin.stdout.trim()) return origin.stdout.trim();

    const listed = await this.run(cwd, ['remote']);
    const first = listed.stdout.split('\n').map((line) => line.trim()).filter(Boolean)[0];
    if (!first) return null;
    const url = await this.run(cwd, ['remote', 'get-url', first]);
    return url.stdout.trim() || null;
  }

  /**
   * The status bar's view of a folder: is this a repository, does it have a
   * remote, and what is on the working tree.
   *
   * `isRepo: false` is a real answer, not a failure — it is what tells the
   * interface to leave git out of the corner of the screen entirely.
   */
  async getStatus(cwd: string): Promise<GitStatusSummary> {
    const empty = { branch: '', isClean: true, staged: [], unstaged: [], untracked: [] };
    if (!cwd) return { ...empty, isRepo: false, remote: null };

    if (!(await this.isGitRepo(cwd))) return { ...empty, isRepo: false, remote: null };

    try {
      const branch = (await this.git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
      const statusOut = await this.git(cwd, ['status', '--porcelain']);
      const lines = statusOut.split('\n').filter(Boolean);
      const remote = await this.getRemote(cwd);

      return { branch, isClean: lines.length === 0, ...parsePorcelain(statusOut), isRepo: true, remote };
    } catch {
      // A repository with no commits yet has no HEAD to name; that is not a
      // reason to pretend the folder is not a repository.
      const remote = await this.getRemote(cwd);
      return { branch: '', isClean: true, staged: [], unstaged: [], untracked: [], isRepo: true, remote };
    }
  }

  async getDiff(cwd: string, filePath?: string, staged = false): Promise<string> {
    const args = staged ? ['diff', '--cached'] : ['diff'];
    if (filePath) args.push('--', filePath);
    const result = await this.run(cwd, args);
    return result.stdout || result.stderr;
  }

  async getLog(cwd: string, limit = 15): Promise<GitLogEntry[]> {
    const result = await this.run(cwd, [
      'log',
      `-n`,
      String(Math.max(1, Math.min(limit, 200))),
      '--pretty=format:%h|%an|%ad|%s',
      '--date=short'
    ]);
    if (!result.stdout.trim()) return [];
    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, author, date, ...msgParts] = line.split('|');
        return { hash, author, date, message: msgParts.join('|') };
      });
  }

  async getBranches(cwd: string): Promise<GitBranchInfo[]> {
    const result = await this.run(cwd, ['branch', '--no-color']);
    if (!result.stdout.trim()) return [];
    return result.stdout
      .split('\n')
      .filter((l) => l.trim())
      .map((line) => {
        const current = line.startsWith('*');
        const name = line.replace(/^\*?\s*/, '').trim();
        return { name, current };
      });
  }

  async commit(cwd: string, message: string): Promise<string> {
    // Argument arrays avoid quoting/injection problems entirely.
    await this.git(cwd, ['add', '-A']);
    const result = await this.run(cwd, ['commit', '-m', message]);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `git commit failed with code ${result.exitCode}`);
    }
    return result.stdout;
  }
}

export const gitService = new GitService();
