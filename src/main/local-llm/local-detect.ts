import { logService } from '../logging/log-service';
import { IPC_CHANNELS } from '../../shared/ipc-events';
import type { BrowserWindow } from 'electron';

/**
 * One-time "there is a local LLM right here" nudge (spec §26 neighbourhood).
 *
 * D4IDE ships Ollama and LM Studio as keyless presets, but a shipped preset is
 * only a guess until its server answers — and a user who just installed Ollama
 * has no reason to know D4IDE can talk to it. So, once per install, shortly
 * after launch, the main process asks `localhost:11434` for its model list. A
 * real answer is pushed to the renderer as an offer; enabling is one click on
 * the existing `localProvidersEnabled` switch, and "not now" writes a flag so
 * the question is never asked again.
 *
 * Everything that decides is exported pure and tested; the class is thin glue
 * around a timer, a fetch and a window.
 */

/** The one runtime probed for now — Ollama's local API is a stable, keyless GET. */
export const OLLAMA_TAGS_URL = 'http://127.0.0.1:11434/api/tags';

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
  vendor: 'ollama';
  /** How many models the runtime reported — shown in the nudge. */
  modelCount: number;
}

/**
 * Turns an `/api/tags` payload into an offer. Anything unexpected — non-JSON,
 * an error status, a model-less server (installed but nothing pulled yet) — is
 * null: a server with no models cannot back a single seat, so there is nothing
 * honest to invite the user to.
 */
export function offerFromTagsPayload(payload: unknown): LocalLlmOffer | null {
  if (!payload || typeof payload !== 'object') return null;
  const models = (payload as { models?: unknown }).models;
  if (!Array.isArray(models) || models.length === 0) return null;
  return { vendor: 'ollama', modelCount: models.length };
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
      void this.probe();
    }, delayMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Probe now (also the seam tests drive). Pushes an offer when one is earned. */
  async probe(): Promise<LocalLlmOffer | null> {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) return null;
    let offer: LocalLlmOffer | null = null;
    try {
      const response = await this.fetchImpl(OLLAMA_TAGS_URL, { signal: AbortSignal.timeout(1500) });
      if (response.ok) offer = offerFromTagsPayload(await response.json());
    } catch {
      // Nothing listening is the normal case; silence is the whole feature.
      return null;
    }
    if (!offer) return null;
    logService.info('app', 'A local LLM runtime answered — offering to enable it', { vendor: offer.vendor, models: offer.modelCount });
    window.webContents.send(IPC_CHANNELS.LOCAL_LLM_FOUND, offer);
    return offer;
  }
}

export const localLlmDetectService = new LocalLlmDetectService();
