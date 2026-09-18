import { describe, it, expect } from 'vitest';
import { compileIgnorePatterns, isIgnored } from '../src/main/filesystem/file-service';

const match = (lines: string[], path: string) => isIgnored(path, compileIgnorePatterns(lines));

describe('compileIgnorePatterns / isIgnored', () => {
  it('ignores files and folders named by simple patterns', () => {
    expect(match(['node_modules'], 'node_modules/react/index.js')).toBe(true);
    expect(match(['*.log'], 'logs/app.log')).toBe(true);
    expect(match(['*.log'], 'src/app.ts')).toBe(false);
  });

  it('supports directory-only patterns', () => {
    expect(match(['coverage/'], 'coverage/lcov.info')).toBe(true);
    expect(match(['coverage/'], 'src/coverage.ts')).toBe(false);
  });

  it('supports anchored patterns that only match from the root', () => {
    expect(match(['/dist'], 'dist/bundle.js')).toBe(true);
    expect(match(['/dist'], 'src/dist/bundle.js')).toBe(false);
  });

  it('supports negation, letting an exception win', () => {
    const rules = ['*.env', '!.env.example'];
    expect(match(rules, '.env')).toBe(true);
    expect(match(rules, '.env.example')).toBe(false);
  });

  it('handles comments and blank lines', () => {
    const rules = compileIgnorePatterns(['# a comment', '', '  ', '.d4ide']);
    expect(rules).toHaveLength(1);
    expect(isIgnored('.d4ide/rules.md', rules)).toBe(true);
  });

  it('supports globstar patterns', () => {
    expect(match(['**/generated/**'], 'src/api/generated/client.ts')).toBe(true);
    expect(match(['src/**/*.snap'], 'src/a/b/c.snap')).toBe(true);
  });

  it('ignores the secret handling rules from .d4ideignore', () => {
    const rules = ['.env', '.env.*', 'secrets/', '*.pem', '*.key'];
    expect(match(rules, '.env.local')).toBe(true);
    expect(match(rules, 'secrets/prod.json')).toBe(true);
    expect(match(rules, 'certs/server.pem')).toBe(true);
    expect(match(rules, 'src/config/env.ts')).toBe(false);
  });
});
