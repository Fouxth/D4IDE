/**
 * Periodic health check of the provider the user is actually talking to.
 *
 * The Test button answers "does it work right now?" — but nobody re-presses it
 * every few minutes, so a gateway that dies mid-afternoon stays green on screen
 * until the next message fails. This service probes the active provider on a
 * schedule and, when the probe fails, tells the renderer at once so the warning
 * lands *before* the user's next prompt does.
 *
 * Deliberately narrow: only the active provider is watched, because that is the
 * only one whose failure costs the user something this minute. The other
 * providers keep the status their last real interaction or test produced.
 *
 * The recommendation comes from evidence, not optimism: when the active provider
 * fails, every other ready provider is probed too, and only one that *answered*
 * is offered as the fallback. A switch button to an untested guess would be the
 * same trust problem the status dots used to have.
 */

import { appStore } from '../../database/store';
import { logService } from '../../logging/log-service';
import { providerManager } from './provider-manager';
import { IPC_CHANNELS } from '../../../shared/ipc-events';
import type { ProviderHealthStatus, ProviderTestResult } from '../../../shared/types';

export interface HealthCheckDecision {
  /** `null` parks the schedule — disabled, or suppressed while a run is live. */
  delayMs: number | null;
  reason: string;
}

/**
 * When the next probe may run.
 *
 * - Disabled or no active provider → park.
 * - An agent run in flight → park; the probe would spend the very quota the run
 *   needs, and the run itself is a far better health signal than a synthetic one.
 * - A provider that just failed is re-probed sooner (half the interval) so the
 *   "is it back?" answer is not a full wait away; a recovery clears it.
 */
export function decideNextHealthCheck(options: {
  enabled: boolean;
  hasActiveProvider: boolean;
  agentBusy: boolean;
  lastResult: 'ok' | 'fail' | null;
  intervalMinutes: number;
  now?: number;
  lastCheckAt?: number;
}): HealthCheckDecision {
  if (!options.enabled) return { delayMs: null, reason: 'disabled' };
  if (!options.hasActiveProvider) return { delayMs: null, reason: 'no-active-provider' };
  if (options.agentBusy) return { delayMs: null, reason: 'agent-busy' };
  const intervalMs = Math.max(1, options.intervalMinutes) * 60_000;
  const backoff = options.lastResult === 'fail' ? 0.5 : 1;
  const base = Math.round(intervalMs * backoff);
  // Without a `now` the caller is scheduling from scratch, so nothing has
  // elapsed yet; with one, the wait is what is left of the interval.
  const elapsed = options.now === undefined ? 0 : (options.now ?? 0) - (options.lastCheckAt ?? 0);
  const delayMs = Math.max(0, base - Math.min(Math.max(elapsed, 0), base));
  return { delayMs, reason: options.lastResult === 'fail' ? 'retry-after-failure' : 'interval' };
}

/**
 * The probe schedule must not spend the user's tokens: one `/models` request
 * per interval is the whole cost. Providers whose model list is public are
 * verified the same way the Test button verifies them, so the verdicts agree.
 */

export class HealthCheckService {
  private timer: NodeJS.Timeout | null = null;
  private started = false;
  private busy = false;
  private agentBusy = false;
  private lastResult: 'ok' | 'fail' | null = null;
  private lastCheckAt = 0;
  private status: ProviderHealthStatus = { state: 'unknown' };
  /** Late-bound, because the window is created after the services. */
  private getWindow: () => Electron.BrowserWindow | null = () => null;

  setWindowProvider(provider: () => Electron.BrowserWindow | null): void {
    this.getWindow = provider;
  }

  getStatus(): ProviderHealthStatus {
    return this.status;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.schedule('startup');
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Re-read the switches after the user changed them. */
  reconfigure(): void {
    if (!this.started) return;
    this.schedule('settings');
  }

  /** A run in flight outranks the probe — see `decideNextHealthCheck`. */
  setAgentBusy(busy: boolean): void {
    const wasBusy = this.agentBusy;
    this.agentBusy = busy;
    if (wasBusy && !busy) this.schedule('agent-idle');
  }

  private schedule(reason: string): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.started) return;

    const settings = appStore.getSettings();
    const activeId = settings.activeProviderId;
    const decision = decideNextHealthCheck({
      enabled: settings.providerHealthCheckEnabled !== false,
      // Auto-routing picks a provider per request, so no single endpoint is
      // "the one being talked to" — a probe of `models[0]` would answer a
      // question nobody asked. Park until a concrete provider is chosen.
      hasActiveProvider: !!activeId && activeId !== 'auto',
      agentBusy: this.agentBusy,
      lastResult: this.lastResult,
      intervalMinutes: settings.providerHealthCheckIntervalMinutes ?? 10,
      lastCheckAt: this.lastCheckAt
    });

    if (decision.delayMs === null) {
      logService.info('app', 'Provider health checks parked', { reason: decision.reason, trigger: reason });
      return;
    }

    const delayMs = decision.delayMs;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.probe('interval');
    }, delayMs);
    // A timer must never be the reason the process stays alive.
    this.timer.unref?.();
    logService.info('app', 'Next provider health check scheduled', { inMs: delayMs, reason: decision.reason, trigger: reason });
  }

  /**
   * Probe the active provider now. Safe against overlap (`busy`), and cheap by
   * design: it reuses `testConnection`, so a healthy probe costs one models
   * request and refreshes the same status the hub shows.
   */
  async probe(trigger: string): Promise<ProviderHealthStatus> {
    if (this.busy) return this.status;
    this.busy = true;
    try {
      const settings = appStore.getSettings();
      const activeId = settings.activeProviderId;
      if (!activeId || activeId === 'auto') {
        // The schedule already parks auto-routing, so this only guards a probe
        // that was triggered while the switch to auto was in flight.
        this.lastResult = null;
        return this.publish({ state: 'unknown' }, 'auto-routing');
      }
      const conf = appStore.getProviders().find((p) => p.id === activeId);
      if (!conf || !conf.enabled) return this.publish({ state: 'unknown' }, 'no-active-provider');

      const result = await providerManager.testConnection(conf.id, undefined, conf.baseUrl, conf.models[0]?.id);
      this.lastCheckAt = Date.now();
      // Gated-model failures authenticate the key (`testConnection` documents
      // the verdict), so they are health, not sickness.
      const healthy = result.success || result.errorKind === 'model_not_found';
      this.lastResult = healthy ? 'ok' : 'fail';
      if (healthy) {
        return this.publish({ state: 'ok', providerId: conf.id, checkedAt: this.lastCheckAt }, 'probe-ok');
      }
      // The warning goes out first — the banner must not wait on the fallback
      // search — and the switch button follows in its own push the moment a
      // candidate answers. No round trip through the renderer in between.
      const down = await this.publish(
        {
          state: 'down',
          providerId: conf.id,
          providerName: conf.name,
          errorKind: result.errorKind,
          error: result.error,
          checkedAt: this.lastCheckAt
        },
        'probe-failed'
      );
      return this.attachFallback(down);
    } catch (e) {
      this.lastCheckAt = Date.now();
      this.lastResult = 'fail';
      logService.warn('app', 'Provider health probe threw', { trigger, error: (e as Error)?.message });
      const down = this.publish(
        { state: 'down', errorKind: 'unavailable', error: (e as Error)?.message, checkedAt: this.lastCheckAt },
        'probe-exception'
      );
      return this.attachFallback(down);
    } finally {
      this.busy = false;
      this.schedule('probe-finished');
    }
  }

  /**
   * When the active provider is down, probe every other ready provider and
   * attach the best one that actually answered to the status — ordered the way
   * the hub orders them (working first, then price). Untested providers are
   * never offered: the switch button exists only when the target is *known* to
   * work, which is what makes pressing it a safe act.
   */
  private async attachFallback(down: ProviderHealthStatus): Promise<ProviderHealthStatus> {
    const settings = appStore.getSettings();
    const activeId = settings.activeProviderId;
    const usable = providerManager
      .getUsableProviders()
      .filter((p) => p.id !== activeId)
      .sort((a, b) => {
        // Cheapest known entry first; models without a price sort last.
        const cheapest = (p: typeof a) =>
          p.models.reduce<number | null>((min, m) => {
            const price = m.inputPricePerMillion;
            if (price === undefined) return min;
            return min === null || price < min ? price : min;
          }, null);
        const priceA = cheapest(a);
        const priceB = cheapest(b);
        if (priceA === null && priceB === null) return a.name.localeCompare(b.name);
        if (priceA === null) return 1;
        if (priceB === null) return -1;
        return priceA - priceB;
      });
    for (const candidate of usable) {
      const result: ProviderTestResult = await providerManager.testConnection(
        candidate.id,
        undefined,
        candidate.baseUrl,
        candidate.models[0]?.id
      );
      // Same verdict rule as everywhere else: an authenticated-but-gated model
      // is a working key.
      if (result.success || result.errorKind === 'model_not_found') {
        const withFallback: ProviderHealthStatus = {
          ...down,
          fallbackProviderId: candidate.id,
          fallbackProviderName: candidate.name,
          fallbackModelId: candidate.models[0]?.id
        };
        this.status = withFallback;
        const window = this.getWindow();
        if (window && !window.isDestroyed()) {
          window.webContents.send(IPC_CHANNELS.PROVIDER_HEALTH_STATUS, withFallback);
        }
        return withFallback;
      }
    }
    return down;
  }

  private publish(next: ProviderHealthStatus, reason: string): ProviderHealthStatus {
    this.status = next;
    const window = this.getWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.PROVIDER_HEALTH_STATUS, this.status);
    }
    logService.info('app', 'Provider health published', { state: this.status.state, reason });
    return this.status;
  }
}

export const providerHealthService = new HealthCheckService();
