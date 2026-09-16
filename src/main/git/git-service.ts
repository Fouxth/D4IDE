import { exec } from 'child_process';
import { promisify } from 'util';
import { GitStatusSummary } from '../../shared/types';

const execAsync = promisify(exec);

export class GitService {
  async isGitRepo(cwd: string): Promise<boolean> {
    try {
      await execAsync('git rev-parse --is-inside-work-tree', { cwd });
      return true;
    } catch {
      return false;
    }
  }

  async getStatus(cwd: string): Promise<GitStatusSummary> {
    try {
      const { stdout: branchOut } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd });
      const branch = branchOut.trim();

      const { stdout: statusOut } = await execAsync('git status --porcelain', { cwd });
      const lines = statusOut.split('\n').filter(Boolean);

      const staged: string[] = [];
      const unstaged: string[] = [];
      const untracked: string[] = [];

      for (const line of lines) {
        const x = line[0];
        const y = line[1];
        const file = line.substring(3).trim();

        if (x === '?' && y === '?') {
          untracked.push(file);
        } else {
          if (x !== ' ' && x !== '?') staged.push(file);
          if (y !== ' ' && y !== '?') unstaged.push(file);
        }
      }

      return {
        branch,
        isClean: lines.length === 0,
        staged,
        unstaged,
        untracked
      };
    } catch {
      return {
        branch: 'unknown',
        isClean: true,
        staged: [],
        unstaged: [],
        untracked: []
      };
    }
  }

  async getDiff(cwd: string, filePath?: string): Promise<string> {
    try {
      const target = filePath ? ` -- "${filePath}"` : '';
      const { stdout } = await execAsync(`git diff${target}`, { cwd });
      return stdout;
    } catch (e: any) {
      return e.message || '';
    }
  }

  async getLog(cwd: string, limit = 15): Promise<{ hash: string; message: string; author: string; date: string }[]> {
    try {
      const { stdout } = await execAsync(`git log -n ${limit} --pretty=format:"%h|%an|%ad|%s" --date=short`, { cwd });
      return stdout.split('\n').filter(Boolean).map((line) => {
        const [hash, author, date, ...msgParts] = line.split('|');
        return {
          hash,
          author,
          date,
          message: msgParts.join('|')
        };
      });
    } catch {
      return [];
    }
  }

  async commit(cwd: string, message: string): Promise<string> {
    // Stage all and commit
    await execAsync('git add -A', { cwd });
    const { stdout } = await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd });
    return stdout;
  }
}

export const gitService = new GitService();
