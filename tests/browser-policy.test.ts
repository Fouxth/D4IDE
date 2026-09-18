import { describe, expect, it } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { checkBrowserUrl, hasUrlScheme, summarizeText } from '../src/main/browser/browser-service';

/**
 * The URL policy is the security boundary of the browser tools: it decides
 * which pages the agent is allowed to drive. It is a pure function so it can be
 * tested hard — a regression here would let a compromised or confused model
 * point the automation browser at the open internet, or worse, at arbitrary
 * files on the machine.
 */
const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'd4ide-browser-test-'));

const allowed = (url: string) => {
  const result = checkBrowserUrl(url, projectPath);
  expect(result, `expected ${url} to be allowed, got: ${result.ok ? '' : result.reason}`).toMatchObject({ ok: true });
  return result.ok ? result.url : '';
};

const refused = (url: string) => {
  const result = checkBrowserUrl(url, projectPath);
  expect(result.ok, `expected ${url} to be refused`).toBe(false);
  return result.ok ? '' : result.reason;
};

describe('browser sandbox — allowed targets', () => {
  it('opens the local dev server', () => {
    expect(allowed('http://localhost:5173')).toContain('localhost:5173');
    expect(allowed('http://127.0.0.1:3000/app')).toContain('127.0.0.1:3000');
    expect(allowed('http://[::1]:8080')).toContain('::1');
  });

  it('accepts the scheme-less shortcut a model tends to write', () => {
    expect(allowed('localhost:5173')).toBe('http://localhost:5173/');
    expect(allowed('my-pc:5173')).toContain('my-pc:5173');
    expect(allowed('192.168.1.20:8080')).toContain('192.168.1.20:8080');
    expect(allowed('localhost:5173/app?tab=1')).toContain('localhost:5173/app?tab=1');
  });

  it('still recognises a real scheme, and does not mistake a port for one', () => {
    expect(hasUrlScheme('http://localhost:5173')).toBe(true);
    expect(hasUrlScheme('file:///c:/x/preview.html')).toBe(true);
    expect(hasUrlScheme('data:text/html,<h1>x</h1>')).toBe(true);
    expect(hasUrlScheme('javascript:alert(1)')).toBe(true);
    expect(hasUrlScheme('localhost:5173')).toBe(false);
    expect(hasUrlScheme('my-pc:8080/x')).toBe(false);
  });

  it('allows private network addresses', () => {
    expect(allowed('http://192.168.1.20:8080')).toContain('192.168.1.20');
    expect(allowed('http://10.0.0.5')).toContain('10.0.0.5');
    expect(allowed('http://172.16.4.4')).toContain('172.16.4.4');
  });

  it('allows an HTML file inside the project', () => {
    const file = path.join(projectPath, 'preview.html');
    const url = `file:///${file.replace(/\\/g, '/')}`;
    expect(allowed(url)).toContain('preview.html');
  });

  it('allows about:blank and inline HTML for scratch work', () => {
    expect(allowed('about:blank')).toBe('about:blank');
    expect(allowed('data:text/html,<h1>hi</h1>')).toContain('data:text/html');
  });
});

describe('browser sandbox — refusals', () => {
  it('blocks the public internet', () => {
    expect(refused('https://example.com')).toMatch(/sandbox/i);
    expect(refused('https://api.openai.com/v1/models')).toMatch(/fetch_url/);
  });

  it('blocks file URLs outside the project', () => {
    const outside = path.join(os.tmpdir(), 'd4ide-outside.txt');
    const url = `file:///${outside.replace(/\\/g, '/')}`;
    expect(refused(url)).toMatch(/inside the current project/i);
  });

  it('blocks a sibling directory that merely shares a prefix', () => {
    // "project-backup" starts with the project path, so a naive startsWith check leaks it.
    const sibling = `${projectPath}-backup${path.sep}secret.html`;
    expect(refused(`file:///${sibling.replace(/\\/g, '/')}`)).toMatch(/inside the current project/i);
  });

  it('blocks non-web schemes', () => {
    expect(refused('ftp://localhost/file')).toMatch(/scheme/i);
    expect(refused('javascript:alert(1)')).toMatch(/scheme/i);
  });

  it('reports an unparseable value instead of throwing', () => {
    expect(refused('')).toMatch(/required/i);
    expect(refused('http://')).toMatch(/valid URL/i);
  });
});

describe('browser sandbox — page text', () => {
  it('collapses blank lines and trailing space but keeps indentation', () => {
    expect(summarizeText('a\r\n\n\n\n  b\t\nc   ')).toBe('a\n\n  b\nc');

    const long = 'x'.repeat(500);
    const result = summarizeText(long, 100);
    expect(result).toHaveLength(100 + '\n…[truncated]'.length);
    expect(result.endsWith('…[truncated]')).toBe(true);
  });
});
