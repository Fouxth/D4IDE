import path from 'path';
import fs from 'fs';
import { ContextItem } from '../../../shared/types';
import { PROJECT_RULE_FILES, mergeRuleFiles } from '../../../shared/rules';
import { fileService } from '../../filesystem/file-service';
import { readRulesFile } from './rules-files';

const SECRET_PATTERNS = [
  /-----BEGIN\s+(RSA|OPENSSH|EC|PGP)?\s*PRIVATE\s+KEY-----/i,
  /sk-[a-zA-Z0-9]{32,}/i,
  /AIza[0-9A-Za-z-_]{35}/i,
  /(password|secret|api_key|token)\s*=\s*['"][^'"]+['"]/i
];

export class ContextEngine {
  isLikelySecret(content: string, filename: string): boolean {
    const base = path.basename(filename).toLowerCase();
    if (base.startsWith('.env') || base.endsWith('.pem') || base.endsWith('.key')) {
      return true;
    }
    return SECRET_PATTERNS.some((p) => p.test(content));
  }

  redactSecrets(content: string): string {
    let sanitized = content;
    sanitized = sanitized.replace(/sk-[a-zA-Z0-9]{24,}/gi, 'sk-[REDACTED_API_KEY]');
    sanitized = sanitized.replace(/AIza[0-9A-Za-z-_]{35}/gi, 'AIza[REDACTED_GEMINI_KEY]');
    return sanitized;
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Every rule file the project keeps, not just the first one found.
   *
   * Returning at the first file meant that adding `.d4ide/rules.md` silently
   * dropped everything written in `D4IDE.md` — the project's own documentation,
   * and often the file the user had been keeping rules in. Each file is now
   * labelled with its name so a surprising rule can be traced to its source, and
   * the whole body is capped so a rules file that grew into an essay cannot cost
   * more than the task.
   */
  loadProjectRules(projectPath: string): string {
    if (!projectPath) return '';
    const files = PROJECT_RULE_FILES.map((name) => ({
      name,
      content: readRulesFile(path.join(projectPath, name)) ?? ''
    })).filter((file) => file.content.trim().length > 0);
    return mergeRuleFiles(files);
  }

  resolveMention(mention: string, projectPath: string): ContextItem | null {
    if (mention.startsWith('@')) {
      const target = mention.slice(1);
      const fullPath = path.isAbsolute(target) ? target : path.join(projectPath, target);

      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          const raw = fileService.readFile(fullPath);
          const sanitized = this.redactSecrets(raw);
          return {
            id: `mention_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            type: 'file',
            name: path.basename(fullPath),
            path: fullPath,
            content: sanitized,
            tokenCount: this.estimateTokens(sanitized),
            isPinned: false
          };
        }
      }
    }
    return null;
  }
}

export const contextEngine = new ContextEngine();
