import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ContextEngine } from '../src/main/ai/context/context-engine';

describe('ContextEngine', () => {
  const engine = new ContextEngine();

  it('detects secret files and sensitive keys', () => {
    expect(engine.isLikelySecret('SOME_VAR=123', '.env')).toBe(true);
    expect(engine.isLikelySecret('SOME_VAR=123', '.env.local')).toBe(true);
    expect(engine.isLikelySecret('const x = "sk-12345678901234567890123456789012";', 'app.ts')).toBe(true);
    expect(engine.isLikelySecret('const app = express();', 'server.ts')).toBe(false);
  });

  it('redacts sensitive API keys from content', () => {
    const raw = 'const key = "sk-abcdef123456789012345678901234";';
    const redacted = engine.redactSecrets(raw);
    expect(redacted).toContain('[REDACTED_API_KEY]');
    expect(redacted).not.toContain('abcdef123456789012345678901234');
  });

  it('estimates token counts accurately', () => {
    const text = 'Hello world! This is a test.';
    const tokens = engine.estimateTokens(text);
    expect(tokens).toBe(Math.ceil(text.length / 4));
  });

  /**
   * Rules come from three files a project may keep, and returning at the first
   * one found meant adding `.d4ide/rules.md` silently threw away what was in
   * `D4IDE.md` — often the file the user had been writing rules in all along.
   */
  describe('project rules', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd4ide-rules-'));
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('reads every rule file, labelled by where it came from', () => {
      fs.writeFileSync(path.join(dir, 'D4IDE.md'), 'โปรเจกต์นี้คือระบบอสังหา', 'utf8');
      fs.mkdirSync(path.join(dir, '.d4ide'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.d4ide', 'rules.md'), '- อย่าแตะ legacy', 'utf8');

      const rules = engine.loadProjectRules(dir);
      expect(rules).toContain('ระบบอสังหา');
      expect(rules).toContain('อย่าแตะ legacy');
      expect(rules).toContain('D4IDE.md');
    });

    it('returns nothing for a project with no rules at all', () => {
      const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'd4ide-empty-'));
      expect(engine.loadProjectRules(empty)).toBe('');
      fs.rmSync(empty, { recursive: true, force: true });
    });
  });
});
