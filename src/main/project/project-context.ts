import fs from 'fs';
import { fileService } from '../filesystem/file-service';
import { gitService } from '../git/git-service';
import { ProjectSuggestionInput } from '../../shared/project-suggestions';

/**
 * Gathers what the empty-state chips are built from (spec §5).
 *
 * Everything here answers "what is this project asking for right now": the
 * working tree git reports, the files most recently touched on disk, and the
 * TODO/FIXME markers the code carries. All three are read live per request —
 * the list sits behind an empty transcript, shown once per project switch, so
 * the cost of an honest answer is one walk of the tree, not a hot path.
 *
 * The walk reuses the file service's ignore handling (`.gitignore` plus
 * `.d4ideignore`), so generated folders are never read to build four buttons.
 */

/** A comment marker that reads as unfinished intent, not prose. */
const TODO_PATTERN = /\b(TODO|FIXME|HACK|XXX)\b/i;

/** Extensions worth opening to look for markers — source, config, docs. */
const MARKER_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro',
  '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.c', '.h', '.cpp',
  '.hpp', '.cs', '.swift', '.md', '.sql', '.sh', '.yml', '.yaml', '.json'
]);

/** Walks are capped twice: by wall clock and by files opened, so a huge or a very slow disk cannot stall the empty transcript. */
const SCAN_TIME_BUDGET_MS = 1500;
const MAX_FILES_SCANNED = 600;
const MAX_MARKERS = 12;
const MAX_RECENT_FILES = 5;
const MAX_MARKER_FILE_BYTES = 512 * 1024;
const MAX_WALK_DEPTH = 8;

/** The TODO markers inside one file's text, as `rel:line` strings. Pure. */
export function extractTodoMarkers(content: string, relativePath: string): string[] {
  const markers: string[] = [];
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index++) {
    if (TODO_PATTERN.test(lines[index])) {
      markers.push(`${relativePath}:${index + 1}`);
      if (markers.length >= MAX_MARKERS) break;
    }
  }
  return markers;
}

export interface ProjectContext {
  isRepo: boolean;
  workingTree: { staged: string[]; unstaged: string[]; untracked: string[] };
  recentFiles: string[];
  todoMarkers: string[];
}

export async function collectProjectContext(rootDir: string): Promise<ProjectContext> {
  const status = await gitService.getStatus(rootDir).catch(() => ({
    isRepo: false,
    branch: '',
    isClean: true,
    staged: [] as string[],
    unstaged: [] as string[],
    untracked: [] as string[],
    remote: null as string | null
  }));

  // One walk serves both answers: mtimes for "recently touched", and marker
  // extraction for the files worth opening. The rules come from the project
  // root, so a subtree is judged by the same .gitignore as its parent.
  const started = Date.now();
  const recent: { path: string; mtimeMs: number }[] = [];
  const markers: string[] = [];
  let filesScanned = 0;

  const rules = fileService.loadIgnoreRules(rootDir);

  const walk = (dir: string, depth: number): void => {
    if (filesScanned >= MAX_FILES_SCANNED || Date.now() - started > SCAN_TIME_BUDGET_MS) return;
    if (depth > MAX_WALK_DEPTH) return;

    // One level at a time: `getTree` with depth 1 lists this directory's
    // children under the root's ignore rules, and the recursion here decides
    // how deep to keep going once the budget is spent.
    const node = fileService.getTree(dir, 1, 0, rootDir, rules);
    for (const child of node.children ?? []) {
      if (filesScanned >= MAX_FILES_SCANNED || Date.now() - started > SCAN_TIME_BUDGET_MS) return;

      if (child.isDirectory) {
        walk(child.path, depth + 1);
        continue;
      }

      filesScanned++;
      try {
        const stat = fs.statSync(child.path);
        recent.push({ path: child.relativePath, mtimeMs: stat.mtimeMs });

        const dot = child.path.lastIndexOf('.');
        const ext = dot >= 0 ? child.path.slice(dot).toLowerCase() : '';
        if (MARKER_EXTENSIONS.has(ext) && stat.size <= MAX_MARKER_FILE_BYTES && markers.length < MAX_MARKERS) {
          const text = fs.readFileSync(child.path, 'utf8');
          markers.push(...extractTodoMarkers(text, child.relativePath));
        }
      } catch {
        // A file we cannot read is not a file we can describe; skip it.
      }
    }
  };

  try {
    walk(rootDir, 0);
  } catch {
    // No tree, no suggestions from disk — git's half below still stands.
  }

  recent.sort((a, b) => b.mtimeMs - a.mtimeMs);

  return {
    isRepo: !!status.isRepo,
    workingTree: { staged: status.staged, unstaged: status.unstaged, untracked: status.untracked },
    recentFiles: recent.slice(0, MAX_RECENT_FILES).map((entry) => entry.path),
    todoMarkers: markers.slice(0, MAX_MARKERS)
  };
}

/** The IPC payload: everything the pure builder needs, nothing else. */
export function toSuggestionInput(context: ProjectContext, language: 'th' | 'en'): ProjectSuggestionInput {
  return {
    language,
    isRepo: context.isRepo,
    workingTree: context.workingTree,
    recentFiles: context.recentFiles,
    todoMarkers: context.todoMarkers
  };
}
