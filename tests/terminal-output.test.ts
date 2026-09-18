import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutputCoalescer } from '../src/main/terminal/output-coalescer';
import { TerminalBus } from '../src/renderer/lib/terminal-bus';
import { scrollbackFor, minimapEnabled } from '../src/renderer/lib/device-profile';

describe('OutputCoalescer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('turns a burst into one message per terminal instead of one per chunk', () => {
    // The budget the terminal service actually uses: a 40,000-line flood
    // arrived as 39,803 separate messages before this existed.
    const sent: Array<[string, string]> = [];
    const coalescer = new OutputCoalescer({ intervalMs: 16, maxBatchChars: 256 * 1024, flush: (id, data) => sent.push([id, data]) });

    for (let i = 0; i < 500; i++) coalescer.push('a', `line ${i}\n`);

    expect(sent).toEqual([]);
    vi.advanceTimersByTime(16);
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe('a');
    expect(sent[0][1].split('\n').filter(Boolean)).toHaveLength(500);
  });

  it('holds a frame\u2019s worth of output rather than one chunk per message', () => {
    const sent: Array<[string, string]> = [];
    const coalescer = new OutputCoalescer({ intervalMs: 16, maxBatchChars: 256 * 1024, flush: (id, data) => sent.push([id, data]) });

    // 40,000 lines of the flood, spread over four frames as the pty delivered them.
    for (let frame = 0; frame < 4; frame++) {
      for (let i = 0; i < 10000; i++) coalescer.push('a', `flood-${frame}-${i}\n`);
      vi.advanceTimersByTime(16);
    }

    expect(sent.length).toBeLessThanOrEqual(4);
    const lines = sent.map(([, data]) => data).join('').split('\n').filter(Boolean);
    expect(lines).toHaveLength(40000);
    expect(lines[0]).toBe('flood-0-0');
    expect(lines[39999]).toBe('flood-3-9999');
  });

  it('keeps each terminal separate and in the order they first spoke', () => {
    const sent: Array<[string, string]> = [];
    const coalescer = new OutputCoalescer({ intervalMs: 16, maxBatchChars: 1024, flush: (id, data) => sent.push([id, data]) });

    coalescer.push('b', 'b1');
    coalescer.push('a', 'a1');
    coalescer.push('b', 'b2');
    vi.advanceTimersByTime(16);

    expect(sent).toEqual([
      ['b', 'b1b2'],
      ['a', 'a1']
    ]);
  });

  it('flushes immediately once one terminal overruns the batch budget', () => {
    const sent: Array<[string, string]> = [];
    const coalescer = new OutputCoalescer({ intervalMs: 16, maxBatchChars: 10, flush: (id, data) => sent.push([id, data]) });

    coalescer.push('a', 'x'.repeat(11));

    expect(sent).toEqual([['a', 'x'.repeat(11)]]);
    expect(coalescer.pendingChars()).toBe(0);
  });

  it('ships what is held on demand, so an exit notice lands after its output', () => {
    const sent: Array<[string, string]> = [];
    const coalescer = new OutputCoalescer({ intervalMs: 1000, maxBatchChars: 4096, flush: (id, data) => sent.push([id, data]) });

    coalescer.push('a', 'partial');
    coalescer.flushNow();
    coalescer.push('a', '[Process exited]');
    coalescer.flushNow();

    expect(sent.map(([, data]) => data)).toEqual(['partial', '[Process exited]']);
    expect(coalescer.pendingChars('a')).toBe(0);
  });

  it('drops the text held for a terminal that is no longer displayed', () => {
    const sent: Array<[string, string]> = [];
    const coalescer = new OutputCoalescer({ intervalMs: 16, maxBatchChars: 4096, flush: (id, data) => sent.push([id, data]) });

    coalescer.push('gone', 'never seen');
    coalescer.forget('gone');
    vi.advanceTimersByTime(50);

    expect(sent).toEqual([]);
  });

  it('survives a failing flush and still empties its buffer', () => {
    let calls = 0;
    const coalescer = new OutputCoalescer({
      intervalMs: 16,
      maxBatchChars: 4096,
      flush: () => {
        calls++;
        throw new Error('window closed');
      }
    });

    coalescer.push('a', 'hello');
    expect(() => vi.advanceTimersByTime(16)).not.toThrow();
    expect(calls).toBe(1);
    expect(coalescer.pendingChars()).toBe(0);
  });

  it('stops accepting work once disposed', () => {
    const sent: Array<[string, string]> = [];
    const coalescer = new OutputCoalescer({ intervalMs: 16, maxBatchChars: 4096, flush: (id, data) => sent.push([id, data]) });

    coalescer.push('a', 'before');
    coalescer.dispose();
    coalescer.push('a', 'after');
    vi.advanceTimersByTime(100);

    expect(sent).toEqual([['a', 'before']]);
  });
});

describe('TerminalBus', () => {
  function fakeBridge() {
    const listeners = new Set<(payload: { id: string; data: string }) => void>();
    const watches: Array<[string, boolean]> = [];
    return {
      watches,
      emit: (payload: { id: string; data: string }) => listeners.forEach((l) => l(payload)),
      listenerCount: () => listeners.size,
      bridge: {
        terminalWatch: async (id: string, watching: boolean) => {
          watches.push([id, watching]);
        },
        onTerminalData: (callback: (payload: { id: string; data: string }) => void) => {
          listeners.add(callback);
          return () => listeners.delete(callback);
        }
      }
    };
  }

  it('uses a single IPC subscription no matter how many terminals are open', () => {
    const fake = fakeBridge();
    const bus = new TerminalBus(() => fake.bridge);

    const offA = bus.attach('a', () => {});
    const offB = bus.attach('b', () => {});
    const offC = bus.attach('c', () => {});
    expect(fake.listenerCount()).toBe(1);

    offA();
    offB();
    expect(fake.listenerCount()).toBe(1);
    offC();
    expect(fake.listenerCount()).toBe(0);
  });

  it('delivers output only to the terminal it belongs to', () => {
    const fake = fakeBridge();
    const bus = new TerminalBus(() => fake.bridge);
    const seen: string[] = [];

    const offA = bus.attach('a', (data) => seen.push(`a:${data}`));
    const offB = bus.attach('b', (data) => seen.push(`b:${data}`));

    fake.emit({ id: 'b', data: 'from b' });
    fake.emit({ id: 'nobody', data: 'dropped' });
    fake.emit({ id: 'a', data: 'from a' });

    expect(seen).toEqual(['b:from b', 'a:from a']);
    offA();
    offB();
  });

  it('tells main which terminals are on screen, and releases them in order', () => {
    const fake = fakeBridge();
    const bus = new TerminalBus(() => fake.bridge);

    const offA = bus.attach('a', () => {});
    const offB = bus.attach('b', () => {});
    offA();
    offB();

    expect(fake.watches).toEqual([
      ['a', true],
      ['b', true],
      ['a', false],
      ['b', false]
    ]);
    expect(bus.size()).toBe(0);
  });

  it('is inert when there is no bridge (the renderer-only preview)', () => {
    const bus = new TerminalBus(() => undefined);
    const off = bus.attach('a', () => {});
    expect(() => off()).not.toThrow();
    expect(bus.size()).toBe(0);
  });

  it('still works against a bridge that cannot be told anything', () => {
    const listeners = new Set<(payload: { id: string; data: string }) => void>();
    const bus = new TerminalBus(() => ({
      onTerminalData: (cb: (payload: { id: string; data: string }) => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      }
    }) as any);
    const seen: string[] = [];
    const off = bus.attach('a', (data) => seen.push(data));

    listeners.forEach((l) => l({ id: 'a', data: 'hello' }));
    expect(seen).toEqual(['hello']);
    off();
  });

  it('detaching twice does not unwatch a terminal that has been re-attached', () => {
    const fake = fakeBridge();
    const bus = new TerminalBus(() => fake.bridge);

    const first = bus.attach('a', () => {});
    const second = bus.attach('b', () => {});
    first();
    first();
    second();

    expect(fake.watches.filter(([, watching]) => watching === false)).toHaveLength(2);
  });
});

describe('scrollbackFor', () => {
  it('keeps less history where memory is short and the full history where it is not', () => {
    expect(scrollbackFor(1)).toBe(500);
    expect(scrollbackFor(2)).toBe(500);
    expect(scrollbackFor(4)).toBe(1500);
    expect(scrollbackFor(8)).toBe(3000);
    expect(scrollbackFor(16)).toBe(5000);
  });

  it('falls back to the full history when the machine will not say', () => {
    // jsdom reports no deviceMemory; guessing small would silently cut history.
    expect(scrollbackFor(NaN)).toBe(5000);
    expect(scrollbackFor(undefined)).toBe(5000);
  });
});

describe('minimapEnabled', () => {
  it('drops the minimap on a small machine and keeps it elsewhere', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'deviceMemory');
    const set = (value: number | undefined) =>
      Object.defineProperty(navigator, 'deviceMemory', { value, configurable: true });

    try {
      set(2);
      expect(minimapEnabled()).toBe(false);
      set(4);
      expect(minimapEnabled()).toBe(false);
      set(8);
      expect(minimapEnabled()).toBe(true);
      set(undefined);
      expect(minimapEnabled()).toBe(true);
    } finally {
      if (original) Object.defineProperty(navigator, 'deviceMemory', original);
      else delete (navigator as any).deviceMemory;
    }
  });
});
