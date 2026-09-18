import { beforeEach, describe, expect, it } from 'vitest';
import { logService, redact } from '../src/main/logging/log-service';

/**
 * Redaction is the promise that makes logs safe to attach to a bug report, so it
 * is tested against the shapes that actually leak: authorization headers, vendor
 * key formats, assignments in JSON, JWTs and private keys.
 */
describe('log redaction', () => {
  it('removes bearer tokens and authorization headers', () => {
    expect(redact('Authorization: Bearer abcdef1234567890')).toBe('Authorization: [redacted]');
    expect(redact('authorization=Bearer ey1abc.def')).not.toContain('ey1abc');
    expect(redact('Bearer sk-live-abcdefghijklmnop')).toContain('[redacted]');
  });

  it('catches provider keys by their shape', () => {
    expect(redact('key sk-proj-abcdefghijklmnopqrst')).not.toContain('abcdefghijklmnopqrst');
    expect(redact('sk-ant-api03-abcdefghijklmnop')).not.toContain('api03-abcdefghijklmnop');
    expect(redact('AIzaSyA1234567890abcdefghijklmnopqrs')).not.toContain('AIzaSy');
    expect(redact('xai-abcdefghijklmnop')).not.toContain('xai-abcdefghijklmnop');
  });

  it('catches key/value assignments however they are written', () => {
    expect(redact('api_key = "supersecretvalue"')).not.toContain('supersecretvalue');
    expect(redact('{"apiKey":"sk-abcdefghijklmnop"}')).not.toContain('sk-abcdefghijklmnop');
    expect(redact('password: hunter2hunter2')).not.toContain('hunter2hunter2');
    expect(redact('client_secret=abcdefg12345')).not.toContain('abcdefg12345');
  });

  it('catches JWTs and private key blocks', () => {
    expect(redact('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP')).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----';
    expect(redact(pem)).toBe('[redacted-private-key]');
  });

  it('walks nested objects and arrays', () => {
    const cleaned = redact({
      provider: { id: 'openai', apiKey: 'sk-abcdefghijklmnop', headers: ['Authorization: Bearer abcdef123456'] },
      note: 'plain text stays'
    }) as any;

    expect(cleaned.provider.apiKey).toBe('[redacted-key]');
    expect(JSON.stringify(cleaned)).not.toContain('abcdefghijklmnop');
    expect(cleaned.provider.id).toBe('openai');
    expect(cleaned.note).toBe('plain text stays');
  });

  it('leaves other value types alone', () => {
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
  });
});

describe('log service', () => {
  beforeEach(() => {
    logService.clear();
    logService.setLevel('debug');
  });

  it('keeps the four streams apart', () => {
    logService.info('app', 'app line');
    logService.info('agent', 'agent line');
    logService.warn('provider', 'provider line');
    logService.error('terminal', 'terminal line');

    expect(logService.read({ channel: 'agent' }).map((r) => r.message)).toEqual(['agent line']);
    expect(logService.read({ channel: 'provider' })[0].level).toBe('warn');
    expect(logService.read()).toHaveLength(4);
  });

  it('drops records below the configured level', () => {
    logService.setLevel('warn');
    logService.debug('app', 'noisy');
    logService.info('app', 'also noisy');
    logService.error('app', 'important');

    expect(logService.read().map((r) => r.message)).toEqual(['important']);
  });

  it('filters by level, text and limit, newest first', () => {
    logService.info('app', 'first');
    logService.error('app', 'second problem');
    logService.info('app', 'third');

    expect(logService.read({ level: 'error' })).toHaveLength(1);
    expect(logService.read({ search: 'problem' })[0].message).toBe('second problem');
    expect(logService.read({ limit: 2 }).map((r) => r.message)).toEqual(['third', 'second problem']);
  });

  it('redacts on the way in, not on the way out', () => {
    logService.error('provider', 'request failed', { authorization: 'Bearer abcdefghijkl' });
    const record = logService.read({ channel: 'provider' })[0];
    expect(JSON.stringify(record)).not.toContain('abcdefghijkl');
    expect(JSON.stringify(record)).toContain('[redacted]');
  });

  it('counts records per level', () => {
    logService.info('app', 'a');
    logService.warn('agent', 'b');
    logService.error('app', 'c');

    const counts = logService.counts();
    expect(counts.info).toBe(1);
    expect(counts.warn).toBe(1);
    expect(counts.error).toBe(1);
  });
});
