import React from 'react';
import { AlertTriangle, Loader2, RefreshCw, SwitchCamera, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHealthStore } from '../stores/healthStore';
import { providerErrorLabel } from '../lib/format';

/**
 * The warning that a provider died, shown where the user is about to type.
 *
 * Toasts disappear; the cause of a failed prompt should not. This banner stays
 * until the provider recovers (proven by a later probe), and — when the main
 * process found a fallback that answered its own probe — carries the one-click
 * switch. An untested guess is never offered: the button exists only when the
 * target is *known* to work, which is what makes pressing it a safe act.
 */
export const ProviderHealthBanner: React.FC = () => {
  const { t, i18n } = useTranslation();
  const status = useHealthStore((s) => s.status);
  const busy = useHealthStore((s) => s.busy);
  const fallbackHandled = useHealthStore((s) => s.fallbackHandled);
  const dismissed = useHealthStore((s) => s.dismissed);
  const probe = useHealthStore((s) => s.probe);
  const acceptFallback = useHealthStore((s) => s.acceptFallback);
  const dismissFallback = useHealthStore((s) => s.dismissFallback);
  const dismiss = useHealthStore((s) => s.dismiss);

  if (status.state !== 'down' || dismissed) return null;
  const name = status.providerName || status.providerId || t('providers.healthFallbackUnknown');
  const kindLabel = status.errorKind ? providerErrorLabel(status.errorKind, i18n.language === 'en' ? 'en' : 'th') : status.error;
  const showFallback = !!status.fallbackProviderId && !fallbackHandled;

  return (
    <div
      role="alert"
      className="mx-3 mt-2 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px]"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-red-300">{t('providers.healthDownTitle', { name })}</div>
        {kindLabel && <div className="mt-0.5 text-d4-dimmed">{kindLabel}</div>}
        {showFallback && (
          <div className="mt-1.5 flex items-center gap-2">
            <button
              onClick={() => void acceptFallback()}
              className="flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-300 hover:bg-emerald-500/25"
            >
              <SwitchCamera className="h-3 w-3" />
              <span>
                {t('providers.healthSwitchTo', { name: status.fallbackProviderName || status.fallbackProviderId })}
              </span>
            </button>
            <button onClick={dismissFallback} className="text-d4-dimmed hover:text-d4-text">
              {t('providers.healthDismissFallback')}
            </button>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={() => void probe()}
          disabled={busy}
          className="flex items-center gap-1 rounded border border-d4-border px-2 py-0.5 text-d4-dimmed hover:text-d4-text disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          <span>{t('providers.healthRecheck')}</span>
        </button>
        <button onClick={dismiss} aria-label={t('common.close')} className="text-d4-dimmed hover:text-d4-text">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};
