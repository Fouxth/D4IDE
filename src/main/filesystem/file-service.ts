import fs from 'fs';
import path from 'path';
import { FileNode } from '../../shared/types';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-electron',
  'build',
  'out',
  '.next',
  '.nuxt',
  'coverage',
  'vendor',
  '.vscode',
  '.idea',
  '.turbo',
  '.cache',
  '__pycache__',
  'target',
  'release'
]);

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.webp',
  '.pdf',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.zip',
  '.gz',
  '.tar',
  '.7z',
  '.mp3',
  '.mp4',
  '.woff',
  '.woff2',
  '.ttf',
  '.lock'
]);

interface IgnoreRule {
  regex: RegExp;
  negated: boolean;
}

/**
 * Compiles `.gitignore` / `.d4ideignore` entries into match rules.
 * Supports the common subset: comments, negation, directory-only patterns,
 * anchored patterns and `**` wildcards.
 */
export function compileIgnorePatterns(lines: string[]): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const negated = line.startsWith('!');
    let pattern = negated ? line.slice(1) : line;
    const directoryOnly = pattern.endsWith('/');
    if (directoryOnly) pattern = pattern.slice(0, -1);

    const anchored = pattern.startsWith('/');
    if (anchored) pattern = pattern.slice(1);
    if (!pattern) continue;

    const body = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/\u0000/g, '.*');

    // Unanchored patterns match at any depth; anchored ones match from the root.
    const prefix = anchored ? '^' : '(^|/)';
    const suffix = directoryOnly ? '(/|$)' : '(/.*)?$';
    rules.push({ regex: new RegExp(`${prefix}${body}${suffix}`), negated });
  }
  return rules;
}

export function isIgnored(relativePath: string, rules: IgnoreRule[]): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  let ignored = false;
  for (const rule of rules) {
    if (rule.regex.test(normalized)) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}

export class FileService {
  /** Read and compile the project's ignore files. */
  loadIgnoreRules(rootDir: string): IgnoreRule[] {
    const files = ['.gitignore', '.d4ideignore', '.d4ide/.d4ideignore'];
    const lines: string[] = [];
    for (const rel of files) {
      const full = path.join(rootDir, rel);
      try {
        if (fs.existsSync(full)) lines.push(...fs.readFileSync(full, 'utf8').split('\n'));
      } catch {
        // Ignore unreadable ignore files.
      }
    }
    return compileIgnorePatterns(lines);
  }

  getTree(dirPath: string, maxDepth = 6, currentDepth = 0, rootDir?: string, rules?: IgnoreRule[]): FileNode {
    const root = rootDir ?? dirPath;
    const ignoreRules = rules ?? this.loadIgnoreRules(root);
    const stats = fs.statSync(dirPath);
    const node: FileNode = {
      name: path.basename(dirPath),
      path: dirPath,
      relativePath: path.relative(root, dirPath).replace(/\\/g, '/'),
      isDirectory: stats.isDirectory()
    };

    if (!stats.isDirectory() || currentDepth >= maxDepth) return node;

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const children: FileNode[] = [];

      for (const entry of entries) {
        if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
        const fullPath = path.join(dirPath, entry.name);
        const rel = path.relative(root, fullPath).replace(/\\/g, '/');
        if (isIgnored(rel, ignoreRules)) continue;

        try {
          if (entry.isDirectory()) {
            children.push(this.getTree(fullPath, maxDepth, currentDepth + 1, root, ignoreRules));
          } else {
            children.push({
              name: entry.name,
              path: fullPath,
              relativePath: rel,
              isDirectory: false,
              size: fs.statSync(fullPath).size
            });
          }
        } catch {
          // Skip unreadable entries.
        }
      }

      children.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      node.children = children;
    } catch (e) {
      console.error(`Failed to read directory ${dirPath}:`, e);
    }

    return node;
  }

  readFile(filePath: string): string {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }
    return fs.readFileSync(filePath, 'utf8');
  }

  writeFile(filePath: string, content: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  }

  createFile(filePath: string, content = ''): void {
    if (fs.existsSync(filePath)) {
      throw new Error(`File already exists: ${filePath}`);
    }
    this.writeFile(filePath, content);
  }

  deleteFile(filePath: string): void {
    if (!fs.existsSync(filePath)) return;
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) fs.rmSync(filePath, { recursive: true, force: true });
    else fs.unlinkSync(filePath);
  }

  renameFile(oldPath: string, newPath: string): void {
    if (!fs.existsSync(oldPath)) throw new Error(`Path does not exist: ${oldPath}`);
    const dir = path.dirname(newPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.renameSync(oldPath, newPath);
  }

  /** Walk the tree once, honouring ignore rules, and hand every file to the visitor. */
  private walkFiles(rootDir: string, visitor: (fullPath: string, relativePath: string) => boolean | void): void {
    const rules = this.loadIgnoreRules(rootDir);
    const walk = (current: string): boolean => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        return false;
      }

      for (const entry of entries) {
        if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
        const fullPath = path.join(current, entry.name);
        const rel = path.relative(rootDir, fullPath).replace(/\\/g, '/');
        if (isIgnored(rel, rules)) continue;

        if (entry.isDirectory()) {
          if (walk(fullPath)) return true;
        } else {
          if (visitor(fullPath, rel)) return true;
        }
      }
      return false;
    };
    walk(rootDir);
  }

  searchFiles(rootDir: string, query: string, maxResults = 100): string[] {
    const results: string[] = [];
    const lowerQuery = query.toLowerCase();

    this.walkFiles(rootDir, (_full, rel) => {
      if (path.basename(rel).toLowerCase().includes(lowerQuery)) {
        results.push(rel);
        if (results.length >= maxResults) return true;
      }
    });

    return results;
  }

  grep(rootDir: string, query: string, maxResults = 100): { file: string; line: number; text: string }[] {
    const results: { file: string; line: number; text: string }[] = [];
    const lowerQuery = query.toLowerCase();

    this.walkFiles(rootDir, (fullPath, rel) => {
      const ext = path.extname(fullPath).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) return;

      try {
        if (fs.statSync(fullPath).size > 2 * 1024 * 1024) return;
        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(lowerQuery)) {
            results.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 400) });
            if (results.length >= maxResults) return true;
          }
        }
      } catch {
        // Skip unreadable files.
      }
    });

    return results;
  }
}

export const fileService = new FileService();
