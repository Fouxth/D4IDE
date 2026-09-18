import fs from 'fs';
import path from 'path';
import type { Browser, BrowserContext, ConsoleMessage, Page } from 'playwright-core';

/**
 * Loaded on first use rather than at import time: the browser is a tool, so a
 * broken or pruned `playwright-core` install must degrade to "these tools are
 * unavailable" instead of preventing the whole agent from starting.
 */
async function loadChromium(): Promise<(typeof import('playwright-core'))['chromium']> {
  try {
    const { chromium } = await import('playwright-core');
    return chromium;
  } catch (error) {
    throw new Error(
      'Browser automation is unavailable because playwright-core could not be loaded. ' +
        `Reinstall dependencies (pnpm install). (${(error as Error)?.message ?? 'unknown error'})`
    );
  }
}

/**
 * Browser automation for the agent (spec §82).
 *
 * Uses `playwright-core` against a browser that is already on the machine —
 * Edge ships with Windows and Chrome is usually present — so the app never has
 * to download a 150 MB browser bundle. Every action is sandboxed to the task:
 * navigation is limited to loopback/private addresses and to `file://` URLs
 * inside the project, so a page under test cannot be used to reach the open
 * internet. `fetch_url` exists for reading public documentation instead.
 */

export interface BrowserPageState {
  url: string;
  title: string;
  status: number | null;
}

export interface BrowserLogEntry {
  level: string;
  text: string;
  timestamp: number;
}

export type UrlPolicyResult = { ok: true; url: string } | { ok: false; reason: string };

const MAX_LOGS = 300;
const IDLE_SHUTDOWN_MS = 10 * 60 * 1000;
const LAUNCH_CHANNELS: (string | undefined)[] = ['msedge', 'chrome', undefined];

/** Hosts the sandbox allows: the machine itself and its private network. */
function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (host === '0.0.0.0') return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    return false;
  }

  // Bare machine names (dev servers announced as http://my-pc:5173).
  return !host.includes('.') && host.length > 0;
}

/**
 * Decides whether a value carries a real URL scheme or is just a host with a
 * port. "localhost:5173" looks identical to the scheme "localhost:", and reading
 * it that way made the documented host:port shortcut fail with a confusing
 * message, so a colon followed only by digits (and then a path, query or end) is
 * treated as a port instead.
 */
export function hasUrlScheme(input: string): boolean {
  const scheme = input.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!scheme) return false;
  return !/^\d+([/?#]|$)/.test(input.slice(scheme[0].length));
}

/**
 * Normalises and vets a URL before the browser is allowed to load it. Exported
 * for tests: this is the security boundary of the browser tools.
 */
export function checkBrowserUrl(rawUrl: string, projectPath: string): UrlPolicyResult {
  const input = String(rawUrl || '').trim();
  if (!input) return { ok: false, reason: 'A URL is required.' };

  if (input === 'about:blank') return { ok: true, url: input };
  if (/^data:text\/html/i.test(input)) return { ok: true, url: input };

  // Allow "localhost:5173" style shortcuts from the model.
  const withScheme = hasUrlScheme(input) ? input : `http://${input}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, reason: `"${rawUrl}" is not a valid URL.` };
  }

  if (parsed.protocol === 'file:') {
    let target: string;
    try {
      target = decodeURIComponent(parsed.pathname).replace(/^\/([a-zA-Z]:)/, '$1');
    } catch {
      return { ok: false, reason: 'The file URL could not be decoded.' };
    }
    const resolved = path.resolve(target);
    const root = path.resolve(projectPath);
    const inside = resolved === root || resolved.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
    if (!inside) {
      return { ok: false, reason: 'file:// URLs are limited to files inside the current project.' };
    }
    return { ok: true, url: `file:///${resolved.replace(/\\/g, '/')}` };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `The "${parsed.protocol}" scheme is not allowed in the browser sandbox.` };
  }

  if (!isAllowedHost(parsed.hostname)) {
    return {
      ok: false,
      reason:
        `"${parsed.hostname}" is outside the project sandbox. The browser tool may only reach localhost, ` +
        'private network addresses, or files inside the project — use fetch_url to read public documentation.'
    };
  }

  return { ok: true, url: parsed.toString() };
}

/** Collapses a page text dump so it fits comfortably in a model context. */
export function summarizeText(text: string, limit = 6000): string {
  const cleaned = String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned.length > limit ? `${cleaned.slice(0, limit)}\n…[truncated]` : cleaned;
}

class BrowserService {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private logs: BrowserLogEntry[] = [];
  private idleTimer: NodeJS.Timeout | null = null;
  private launching: Promise<Page> | null = null;
  private usedChannel = '';

  /** The browser binary actually in use, for diagnostics in the UI. */
  getChannel(): string {
    return this.usedChannel;
  }

  isRunning(): boolean {
    return !!this.page;
  }

  private async launch(): Promise<Page> {
    if (this.page) return this.page;
    if (this.launching) return this.launching;

    this.launching = (async () => {
      const chromium = await loadChromium();
      let lastError: unknown;
      for (const channel of LAUNCH_CHANNELS) {
        try {
          this.browser = await chromium.launch({ channel, headless: true });
          this.usedChannel = channel ?? 'bundled-chromium';
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!this.browser) {
        throw new Error(
          'No browser could be launched for automation. Install Microsoft Edge or Google Chrome, then try again. ' +
            `(${(lastError as Error)?.message?.split('\n')[0] ?? 'unknown error'})`
        );
      }

      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
        acceptDownloads: false,
        ignoreHTTPSErrors: true
      });
      // Automation must never hang the agent loop.
      this.context.setDefaultTimeout(15000);

      this.page = await this.context.newPage();
      this.attachLogCapture(this.page);
      return this.page;
    })();

    try {
      return await this.launching;
    } finally {
      this.launching = null;
    }
  }

  private attachLogCapture(page: Page): void {
    page.on('console', (message: ConsoleMessage) => {
      this.pushLog(message.type(), message.text());
    });
    page.on('pageerror', (error: Error) => {
      this.pushLog('pageerror', error.message);
    });
    page.on('crash', () => {
      this.pushLog('crash', 'The page crashed.');
    });
    page.on('dialog', (dialog) => {
      // Never leave a modal blocking the automation.
      this.pushLog('dialog', `${dialog.type()}: ${dialog.message()}`);
      dialog.dismiss().catch(() => undefined);
    });
  }

  private pushLog(level: string, text: string): void {
    this.logs.push({ level, text: text.slice(0, 2000), timestamp: Date.now() });
    if (this.logs.length > MAX_LOGS) this.logs.splice(0, this.logs.length - MAX_LOGS);
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      void this.close();
    }, IDLE_SHUTDOWN_MS);
    // Do not keep the app alive just for the browser watchdog.
    this.idleTimer.unref?.();
  }

  async navigate(projectPath: string, url: string): Promise<BrowserPageState & { channel: string }> {
    const policy = checkBrowserUrl(url, projectPath);
    if (!policy.ok) throw new Error(policy.reason);

    const page = await this.launch();
    this.touch();

    const response = await page.goto(policy.url, { waitUntil: 'domcontentloaded' });
    // Give client-side rendering a moment, then fall back to the raw DOM.
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);

    return {
      url: page.url(),
      title: await page.title().catch(() => ''),
      status: response?.status() ?? null,
      channel: this.usedChannel
    };
  }

  async click(projectPath: string, selector: string): Promise<BrowserPageState & { text: string }> {
    const page = await this.requirePage(projectPath);
    this.touch();
    await page.click(selector, { timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => undefined);
    return {
      url: page.url(),
      title: await page.title().catch(() => ''),
      status: null,
      text: summarizeText(await this.visibleText(page), 1500)
    };
  }

  async fill(projectPath: string, selector: string, value: string): Promise<{ selector: string; value: string }> {
    const page = await this.requirePage(projectPath);
    this.touch();
    await page.fill(selector, value, { timeout: 10000 });
    return { selector, value };
  }

  async inspect(projectPath: string, selector?: string): Promise<BrowserPageState & { text: string; elements: number }> {
    const page = await this.requirePage(projectPath);
    this.touch();

    let text = '';
    let elements = 0;
    if (selector) {
      const locator = page.locator(selector);
      elements = await locator.count();
      if (elements === 0) throw new Error(`No element matched selector "${selector}" on ${page.url()}.`);
      text = await locator.first().innerText({ timeout: 10000 }).catch(async () => {
        return (await locator.first().textContent()) ?? '';
      });
    } else {
      text = await this.visibleText(page);
      elements = await page.locator('body *').count();
    }

    return {
      url: page.url(),
      title: await page.title().catch(() => ''),
      status: null,
      text: summarizeText(text),
      elements
    };
  }

  /** Full-page vs viewport screenshot written inside the project (spec §25). */
  async screenshot(projectPath: string, opts: { fullPage?: boolean; label?: string } = {}): Promise<{
    file: string;
    relativePath: string;
    bytes: number;
    url: string;
  }> {
    const page = await this.requirePage(projectPath);
    this.touch();

    const dir = path.join(projectPath, '.d4ide', 'screenshots');
    fs.mkdirSync(dir, { recursive: true });
    // Keep agent artifacts out of the user's git status.
    const ignoreFile = path.join(dir, '.gitignore');
    if (!fs.existsSync(ignoreFile)) {
      try {
        fs.writeFileSync(ignoreFile, '*\n', 'utf8');
      } catch {
        // Non-fatal: the folder is still usable.
      }
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeLabel = (opts.label || '').replace(/[^\w-]+/g, '-').slice(0, 40);
    const file = path.join(dir, `${stamp}${safeLabel ? `-${safeLabel}` : ''}.png`);
    const buffer = await page.screenshot({ type: 'png', fullPage: opts.fullPage === true });
    fs.writeFileSync(file, buffer);

    return {
      file,
      relativePath: path.relative(projectPath, file).replace(/\\/g, '/'),
      bytes: buffer.length,
      url: page.url()
    };
  }

  async readConsole(opts: { limit?: number; level?: string; clear?: boolean } = {}): Promise<{
    entries: BrowserLogEntry[];
    total: number;
    url: string;
  }> {
    const page = this.page;
    const level = opts.level?.toLowerCase();
    const filtered = level ? this.logs.filter((entry) => entry.level.toLowerCase() === level) : this.logs;
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), MAX_LOGS);
    const entries = filtered.slice(-limit);
    if (opts.clear) this.logs = this.logs.filter((entry) => !entries.includes(entry));

    return {
      entries,
      total: this.logs.length,
      url: page ? page.url() : ''
    };
  }

  private async visibleText(page: Page): Promise<string> {
    const body = await page.locator('body').innerText({ timeout: 10000 }).catch(async () => {
      return (await page.content()).replace(/<[^>]+>/g, ' ');
    });
    return body || '';
  }

  private async requirePage(projectPath: string): Promise<Page> {
    if (!this.page) {
      throw new Error(
        'No page is open yet. Call browser_navigate first (for example to the dev server URL of this project).'
      );
    }
    void projectPath;
    return this.page;
  }

  async close(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    const browser = this.browser;
    this.page = null;
    this.context = null;
    this.browser = null;
    this.usedChannel = '';
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}

export const browserService = new BrowserService();
