/**
 * The local-LLM nudge rules.
 *
 * The whole feature is a single question asked at most once per install, so
 * almost everything that can go wrong is a decision made before any network
 * call: whether to ask at all, and whether an answer from `localhost:11434`
 * deserves the user's attention. Those decisions live in pure functions and
 * are decided here.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  LocalLlmDetectService,
  offerFromTagsPayload,
  shouldOfferLocalLlm,
  OLLAMA_TAGS_URL
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

describe('local-llm — what counts as an offer', () => {
  it('a server with models becomes an offer with the count', () => {
    expect(offerFromTagsPayload({ models: [{ name: 'llama3' }, { name: 'qwen2' }] })).toEqual({
      vendor: 'ollama',
      modelCount: 2
    });
  });

  it('a server with no models pulled is not an offer — nothing could back a seat', () => {
    expect(offerFromTagsPayload({ models: [] })).toBeNull();
    expect(offerFromTagsPayload({})).toBeNull();
    expect(offerFromTagsPayload(null)).toBeNull();
    expect(offerFromTagsPayload('garbage')).toBeNull();
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

  it('probes Ollama once, with a timeout, and pushes the offer', async () => {
    const send = vi.fn();
    const win = { isDestroyed: () => false, webContents: { send } } as unknown as any;
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [{ name: 'llama3' }] }) });
    const svc = service(fetchImpl, win);
    const offer = await svc.probe();
    expect(fetchImpl).toHaveBeenCalledWith(OLLAMA_TAGS_URL, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(offer).toEqual({ vendor: 'ollama', modelCount: 1 });
    expect(send).toHaveBeenCalledWith(expect.anything(), { vendor: 'ollama', modelCount: 1 });
  });

  it('nothing listening is silence — no push, no throw', async () => {
    const send = vi.fn();
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const svc = service(fetchImpl, { isDestroyed: () => false, webContents: { send } } as unknown as any);
    expect(await svc.probe()).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('an error status or a model-less server stays quiet', async () => {
    const send = vi.fn();
    const okFalse = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    const noModels = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [] }) });
    const win = { isDestroyed: () => false, webContents: { send } } as unknown as any;
    expect(await service(okFalse, win).probe()).toBeNull();
    expect(await service(noModels, win).probe()).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('no window (startup race) means no probe at all', async () => {
    const fetchImpl = vi.fn();
    const svc = new LocalLlmDetectService(fetchImpl);
    svc.setWindowProvider(() => null);
    expect(await svc.probe()).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
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
