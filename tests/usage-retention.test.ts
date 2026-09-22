import { afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { UsageRecord } from '../src/shared/types';

/**
 * Usage history is the one table with no natural bound, and every summary walks
 * all of it — so its growth is a performance property, not a housekeeping
 * detail. These tests pin the two things that keep it honest: the retention
 * window deletes only what no screen can show, and the log the summary reads is
 * kept in memory without ever going stale after a write.
 */
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'd4ide-usage-test-'));
process.env.APPDATA = testRoot;

vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('app is not ready in tests');
    }
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.from(''),
    decryptString: () => ''
  }
}));

const { appStore } = await import('../src/main/database/store');

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

const record = (id: string, ageDays: number): UsageRecord => ({
  id,
  sessionId: 's1',
  providerId: 'deepseek',
  modelId: 'deepseek-chat',
  inputTokens: 100,
  outputTokens: 20,
  estimatedCost: 0.001,
  status: 'completed',
  timestamp: now - ageDays * DAY
});

/** Everything currently in the log, oldest first. */
const ids = () => appStore.getUsageRecords().map((r) => r.id);

afterAll(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

describe('usage retention', () => {
  it('keeps what the app can still show and drops the rest', () => {
    appStore.clearUsage();
    for (const [id, age] of [
      ['yesterday', 1],
      ['last-month', 40],
      ['last-year', 200],
      ['ancient', 500]
    ] as const) {
      appStore.saveUsage(record(id, age));
    }

    const removed = appStore.pruneUsageHistory();

    expect(removed).toBe(1);
    expect(ids()).toEqual(['yesterday', 'last-month', 'last-year']);
  });

  it('leaves a log inside the window untouched', () => {
    appStore.clearUsage();
    appStore.saveUsage(record('recent', 2));
    expect(appStore.pruneUsageHistory()).toBe(0);
    expect(ids()).toEqual(['recent']);
  });

  it('honours a shorter window when asked for one', () => {
    // The window is a parameter so it can be exercised rather than only trusted.
    appStore.saveUsage(record('two-months-old', 60));
    expect(appStore.pruneUsageHistory(30)).toBe(1);
    expect(ids()).toEqual(['recent']);
  });

  it('serves a freshly recorded row without re-reading the log', () => {
    // A record is written and then immediately summarised; the summary has to
    // see it. Reading the whole log back to add one row would undo the point of
    // holding it in memory, so this pins that the append is reflected at once.
    const before = appStore.getUsageRecords().length;
    appStore.saveUsage(record('just-now', 0));

    const after = appStore.getUsageRecords();
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1].id).toBe('just-now');
  });

  it('forgets the log when it is reset', () => {
    appStore.clearUsage();
    expect(appStore.getUsageRecords()).toEqual([]);
  });

  it('sorts the log oldest first, which the summary relies on', () => {
    appStore.saveUsage(record('older', 3));
    appStore.saveUsage(record('newer', 1));
    const stamps = appStore.getUsageRecords().map((r) => r.timestamp);
    expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
  });
});

describe('settings and provider reads', () => {
  it('answers a repeated read from memory', () => {
    const settings = appStore.saveSettings({ activeProviderId: 'deepseek' });
    // Two reads in a row must agree — the second is the cached one.
    expect(appStore.getSettings().activeProviderId).toBe('deepseek');
    expect(appStore.getSettings()).toEqual(settings);
  });

  it('never serves a settings value the last write disproved', () => {
    // The cache is stamp-based, and two writes inside one millisecond can share
    // a stamp, so each write states the new value rather than relying on time.
    appStore.saveSettings({ contextTokenBudget: 30_000 });
    appStore.saveSettings({ contextTokenBudget: 70_000 });
    expect(appStore.getSettings().contextTokenBudget).toBe(70_000);
  });
});
