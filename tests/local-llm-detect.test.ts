/**
 * The local-LLM nudge rules.
 *
 * The whole feature is a single question asked at most once per install, so
 * almost everything that can go wrong is a decision made before any network
 * call: whether to ask at all, and whether an answer from a local runtime
 * deserves the user's attention. Those decisions live in pure functions and
 * are decided here.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  LocalLlmDetectService,
  offerFromPayload,
  shouldOfferLocalLlm,
  LOCAL_RUNTIMES
} from '../src/main/local-llm/local-detect';

describe('local-llm — whether the user is ever asked', () => {
  it('asks a fresh user who has local providers off', () => {
    expect(shouldOfferLocalLlm({})).toBe(true);
    expect(shouldOfferLocalLlm(undefined)).toBe(false);
  });

  it('never asks someone who already enabled local providers', () => {
    expect(shouldOfferLocalLlm({ localProvidersEnabled: true })).toBe(false);
  });

  it('never asks again after "not now"', () => {
    expect(shouldOfferLocalLlm({ localLlmPromptDismissedAt: 1234 })).toBe(false);
  });
});

describe('local-llm — what counts as an offer, per runtime', () => {
  const [ollama, lmstudio] = LOCAL_RUNTIMES;

  it('covers both shipped runtimes', () => {
    expect(LOCAL_RUNTIMES.map((r) => r.vendor)).toEqual(['ollama', 'lmstudio']);
  });

  it('ollama: /api/tags with models becomes an offer with the count', () => {
    expect(offerFromPayload(ollama.vendor, ollama.countModels, { models: [{ name: 'llama3' }, { name: 'qwen2' }] })).toEqual({
      vendor: 'ollama',
      modelCount: 2
    });
  });

  it('lmstudio: OpenAI-shaped /v1/models with data becomes an offer', () => {
    expect(offerFromPayload(lmstudio.vendor, lmstudio.countModels, { data: [{ id: 'qwen2.5-7b' }] })).toEqual({
      vendor: 'lmstudio',
      modelCount: 1
    });
  });

  it('a server with no models pulled is not an offer — nothing could back a seat', () => {
    expect(offerFromPayload(ollama.vendor, ollama.countModels, { models: [] })).toBeNull();
    expect(offerFromPayload(ollama.vendor, ollama.countModels, {})).toBeNull();
    expect(offerFromPayload(lmstudio.vendor, lmstudio.countModels, { data: [] })).toBeNull();
    expect(offerFromPayload(lmstudio.vendor, lmstudio.countModels, null)).toBeNull();
    expect(offerFromPayload(ollama.vendor, ollama.countModels, 'garbage')).toBeNull();
  });
});

describe('local-llm — the probe', () => {
  /** A window stub: present means the app is on screen. */
  const windowStub = () => ({ isDestroyed: () => false, webContents: { send: vi.fn() } } as unknown as any);

  const service = (fetchImpl: any, win: any = windowStub()) => {
    const svc = new LocalLlmDetectService(fetchImpl);
    svc.setWindowProvider(() => win);
    return svc;
  };

  it('pushes the first runtime that answers, one timeout per probe', async () => {
    const send = vi.fn();
    const win = { isDestroyed: () => false, webContents: { send } } as unknown as any;
    const fetchImpl = vi
      .fn()
      // Ollama hangs *the way real fetch hangs*: it rejects when the caller's
      // AbortSignal fires (the 1.5 s per-runtime timeout). LM Studio answers.
      .mockImplementationOnce((_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('The operation was aborted')));
        })
      )
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'qwen2.5-7b' }] }) });
    const svc = service(fetchImpl, win);
    const offer = await svc.probeAll();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(offer).toEqual({ vendor: 'lmstudio', modelCount: 1 });
    expect(send).toHaveBeenCalledWith(expect.anything(), { vendor: 'lmstudio', modelCount: 1 });
  });

  it('nothing listening is silence — no push, no throw', async () => {
    const send = vi.fn();
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const svc = service(fetchImpl, { isDestroyed: () => false, webContents: { send } } as unknown as any);
    expect(await svc.probeAll()).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('an error status or a model-less server stays quiet', async () => {
    const send = vi.fn();
    const okFalse = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    const noModels = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }) });
    const win = { isDestroyed: () => false, webContents: { send } } as unknown as any;
    expect(await service(okFalse, win).probeAll()).toBeNull();
    expect(await service(noModels, win).probeAll()).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('no window (startup race) means no push even when a runtime answers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [{ name: 'llama3' }] }) });
    const svc = new LocalLlmDetectService(fetchImpl);
    svc.setWindowProvider(() => null);
    expect(await svc.probeAll()).toBeNull();
  });

  it('start() with a dismissed flag never even schedules a probe', async () => {
    const fetchImpl = vi.fn();
    const svc = new LocalLlmDetectService(fetchImpl);
    svc.start({ localLlmPromptDismissedAt: 1 }, 0);
    // Longer than the (zero) delay would ever be: had a timer been scheduled,
    // the fetch would have fired by now.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
