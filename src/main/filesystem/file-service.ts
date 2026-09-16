import fs from 'fs';
import path from 'path';
import { FileNode } from '../../shared/types';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-electron',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  'vendor',
  '.vscode',
  '.idea'
]);

export class FileService {
  getTree(dirPath: string, maxDepth = 6, currentDepth = 0): FileNode {
    const stats = fs.statSync(dirPath);
    const node: FileNode = {
      name: path.basename(dirPath),
      path: dirPath,
      relativePath: '',
      isDirectory: stats.isDirectory()
    };

    if (!stats.isDirectory() || currentDepth >= maxDepth) {
      return node;
    }

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const children: FileNode[] = [];

      for (const entry of entries) {
        if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
          continue;
        }

        const fullPath = path.join(dirPath, entry.name);
        try {
          if (entry.isDirectory()) {
            children.push(this.getTree(fullPath, maxDepth, currentDepth + 1));
          } else {
            const fileStat = fs.statSync(fullPath);
            children.push({
              name: entry.name,
              path: fullPath,
              relativePath: '',
              isDirectory: false,
              size: fileStat.size
            });
          }
        } catch {
          // Ignore unreadable entries
        }
      }

      // Sort directories first, then alphabetical
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
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf8');
  }

  createFile(filePath: string, content = ''): void {
    if (fs.existsSync(filePath)) {
      throw new Error(`File already exists: ${filePath}`);
    }
    this.writeFile(filePath, content);
  }

  deleteFile(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      return;
    }
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      fs.rmSync(filePath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(filePath);
    }
  }

  renameFile(oldPath: string, newPath: string): void {
    if (!fs.existsSync(oldPath)) {
      throw new Error(`Path does not exist: ${oldPath}`);
    }
    const dir = path.dirname(newPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.renameSync(oldPath, newPath);
  }

  searchFiles(rootDir: string, query: string, maxResults = 100): string[] {
    const results: string[] = [];
    const lowerQuery = query.toLowerCase();

    const walk = (current: string) => {
      if (results.length >= maxResults) return;
      try {
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (IGNORED_DIRS.has(entry.name)) continue;
            walk(path.join(current, entry.name));
          } else {
            if (entry.name.toLowerCase().includes(lowerQuery)) {
              results.push(path.relative(rootDir, path.join(current, entry.name)));
              if (results.length >= maxResults) break;
            }
          }
        }
      } catch {
        // Skip permission errors
      }
    };

    walk(rootDir);
    return results;
  }

  grep(rootDir: string, query: string, maxResults = 100): { file: string; line: number; text: string }[] {
    const results: { file: string; line: number; text: string }[] = [];
    const lowerQuery = query.toLowerCase();

    const walk = (current: string) => {
      if (results.length >= maxResults) return;
      try {
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (IGNORED_DIRS.has(entry.name)) continue;
            walk(path.join(current, entry.name));
          } else {
            const ext = path.extname(entry.name).toLowerCase();
            // Skip binary files
            if (['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.exe', '.bin', '.dll', '.so'].includes(ext)) {
              continue;
            }
            const fullPath = path.join(current, entry.name);
            try {
              const stat = fs.statSync(fullPath);
              if (stat.size > 2 * 1024 * 1024) continue; // Skip files > 2MB

              const content = fs.readFileSync(fullPath, 'utf8');
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].toLowerCase().includes(lowerQuery)) {
                  results.push({
                    file: path.relative(rootDir, fullPath),
                    line: i + 1,
                    text: lines[i].trim()
                  });
                  if (results.length >= maxResults) return;
                }
              }
            } catch {
              // Skip unreadable files
            }
          }
        }
      } catch {
        // Skip errors
      }
    };

    walk(rootDir);
    return results;
  }
}

export const fileService = new FileService();
