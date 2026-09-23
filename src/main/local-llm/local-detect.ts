import { logService } from '../logging/log-service';
import { IPC_CHANNELS } from '../../shared/ipc-events';
import type { BrowserWindow } from 'electron';

/**
 * One-time "there is a local LLM right here" nudge (spec §26 neighbourhood).
 *
 * D4IDE ships Ollama and LM Studio as keyless presets, but a shipped preset is
 * only a guess until its server answers — and a user who just installed one of
 * them has no reason to know D4IDE can talk to it. So, once per install,
 * shortly after launch, the main process asks each known runtime for its model
 * list. A real answer is pushed to the renderer as an offer; enabling is one
 * click on the existing `localProvidersEnabled` switch, and "not now" writes a
 * flag so the question is never asked again.
 *
 * Everything that decides is exported pure and tested; the class is thin glue
 * around a timer, a fetch and a window.
 */

export interface LocalRuntime {
  /** The provider preset this runtime maps to — the thing enabling turns on. */
  vendor: string;
  url: string;
  /** Turns a response body into a model count, per runtime's API shape. */
  countModels: (payload: unknown) => number;
}

/** Ollama: GET /api/tags → { models: [...] }. */
const OLLAMA: LocalRuntime = {
  vendor: 'ollama',
  url: 'http://127.0.0.1:11434/api/tags',
  countModels: (payload) => {
    const models = (payload as { models?: unknown } | null)?.models;
    return Array.isArray(models) ? models.length : 0;
  }
};

/** LM Studio: OpenAI-shaped GET /v1/models → { data: [...] }. */
const LM_STUDIO: LocalRuntime = {
  vendor: 'lmstudio',
  url: 'http://127.0.0.1:1234/v1/models',
  countModels: (payload) => {
    const data = (payload as { data?: unknown } | null)?.data;
    return Array.isArray(data) ? data.length : 0;
  }
};

/** The runtimes probed, in the order their offers would win. */
export const LOCAL_RUNTIMES: readonly LocalRuntime[] = [OLLAMA, LM_STUDIO];

export interface LocalLlmSettingsGate {
  localProvidersEnabled?: boolean;
  localLlmPromptDismissedAt?: number;
}

/** Whether the nudge may run at all: dismissed or already-enabled users hear nothing. */
export function shouldOfferLocalLlm(settings: LocalLlmSettingsGate | undefined | null): boolean {
  if (!settings) return false;
  if (settings.localProvidersEnabled) return false;
  if (settings.localLlmPromptDismissedAt) return false;
  return true;
}

export interface LocalLlmOffer {
  vendor: string;
  /** How many models the runtime reported — shown in the nudge. */
  modelCount: number;
}

/**
 * A runtime's answer becomes an offer only when it names at least one model —
 * a server with nothing pulled cannot back a single seat, so there is nothing
 * honest to invite the user to.
 */
export function offerFromPayload(vendor: string, countModels: (payload: unknown) => number, payload: unknown): LocalLlmOffer | null {
  const modelCount = countModels(payload);
  return modelCount > 0 ? { vendor, modelCount } : null;
}

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export class LocalLlmDetectService {
  private timer: NodeJS.Timeout | null = null;
  private getWindow: () => BrowserWindow | null = () => null;

  constructor(private fetchImpl: FetchLike = fetch as unknown as FetchLike) {}

  setWindowProvider(provider: () => BrowserWindow | null): void {
    this.getWindow = provider;
  }

  /**
   * Ask once, `delayMs` after launch: late enough to lose no race with first
   * paint or the first agent request, early enough that the user is still
   * looking at the app. A timer never keeps the process alive.
   */
  start(settings: LocalLlmSettingsGate | undefined | null, delayMs = 8000): void {
    if (this.timer) clearTimeout(this.timer);
    if (!shouldOfferLocalLlm(settings)) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.probeAll();
    }, delayMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * Probe every runtime once (each with its own timeout — one hung server must
   * not blind the other) and push the first offer. Nothing listening is the
   * normal case; silence is the whole feature.
   */
  async probeAll(): Promise<LocalLlmOffer | null> {
    for (const runtime of LOCAL_RUNTIMES) {
      const offer = await this.probeOne(runtime);
      if (offer) {
        const window = this.getWindow();
        if (!window || window.isDestroyed()) return null;
        logService.info('app', 'A local LLM runtime answered — offering to enable it', {
          vendor: offer.vendor,
          models: offer.modelCount
        });
        window.webContents.send(IPC_CHANNELS.LOCAL_LLM_FOUND, offer);
        return offer;
      }
    }
    return null;
  }

  /** Kept for callers (and tests) that want one runtime's verdict directly. */
  async probeOne(runtime: LocalRuntime): Promise<LocalLlmOffer | null> {
    try {
      const response = await this.fetchImpl(runtime.url, { signal: AbortSignal.timeout(1500) });
      if (!response.ok) return null;
      return offerFromPayload(runtime.vendor, runtime.countModels, await response.json());
    } catch {
      return null;
    }
  }
}

export const localLlmDetectService = new LocalLlmDetectService();
