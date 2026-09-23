import React from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu, X } from 'lucide-react';
import { useLocalLlmStore } from '../stores/localLlmStore';

/**
 * The local-LLM nudge, in the same corner the update prompt lives in.
 *
 * One runtime, one question, two buttons: "enable" does everything the
 * settings screens would (flip the switch, test the provider, list the
 * models), "not now" is forever. Shown only when the main process actually
 * heard a runtime answer — never as a guess.
 */
export const LocalLlmPrompt: React.FC = () => {
  const { t } = useTranslation();
  const { offer, busy, accept, dismiss } = useLocalLlmStore();
  if (!offer) return null;

  return (
    <div
      role="dialog"
      aria-label={t('localLlm.aria')}
      className="fixed bottom-9 right-3 z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-md border border-blue-400/30 bg-d4-panel shadow-2xl"
    >
      <div className="flex items-start gap-2 px-3 py-2.5">
        <Cpu className="w-4 h-4 mt-0.5 shrink-0 text-blue-300" />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-d4-text font-semibold leading-snug">{t('localLlm.title', { vendor: 'Ollama' })}</div>
          <div className="text-[11px] text-d4-muted mt-0.5 leading-relaxed">
            {t('localLlm.body', { count: offer.modelCount })}
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void accept()}
              className="px-2.5 py-1 rounded-sm bg-d4-accent text-black text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? t('localLlm.enabling') : t('localLlm.enable')}
            </button>
            <button
              type="button"
              onClick={() => void dismiss()}
              title={t('localLlm.notNow')}
              className="px-2.5 py-1 rounded-sm border border-d4-border text-[11px] text-d4-muted hover:text-d4-text"
            >
              {t('localLlm.notNow')}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void dismiss()}
          aria-label={t('localLlm.notNow')}
          className="p-1 rounded-sm text-d4-dimmed hover:text-d4-text shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
