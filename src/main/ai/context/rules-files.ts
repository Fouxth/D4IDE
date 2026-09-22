import fs from 'fs';
import path from 'path';

/**
 * Where rules live on disk, and how they are read.
 *
 * Two files, two scopes, the same shape as skills so nothing new has to be
 * learned: `<dataDir>/rules.md` applies to every project, and
 * `<project>/.d4ide/rules.md` to the one the user is in. Both are plain
 * markdown — the user can edit them in the editor, in Notepad, or through the
 * RULES card, and the agent reads the same lines either way.
 *
 * Kept apart from the context engine so the runtime, the IPC handlers and the
 * card all agree on the paths instead of each spelling them out.
 */
export function userRulesPath(dataDir: string): string {
  return path.join(dataDir, 'rules.md');
}

export function projectRulesPath(projectPath: string): string {
  return path.join(projectPath, '.d4ide', 'rules.md');
}

/** `null` when the file is missing or unreadable — not `''`, which is a real answer. */
export function readRulesFile(file: string): string | null {
  try {
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export interface WriteResult {
  success: boolean;
  path?: string;
  scope?: 'global' | 'project';
  error?: string;
}

export function writeRulesFile(file: string, content: string, scope: 'global' | 'project'): WriteResult {
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
    return { success: true, path: file, scope };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
