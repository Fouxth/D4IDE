import { describe, it, expect } from 'vitest';
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
});
