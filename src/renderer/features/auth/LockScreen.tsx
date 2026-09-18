import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, ExternalLink, KeyRound, Loader2 } from 'lucide-react';
import { DeviceCodePrompt } from '../../../shared/types';
import { GitHubMark, GoogleMark } from './brand-marks';
import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';

/**
 * The sign-in gate (spec §7).
 *
 * The app is usable only after GitHub or Google sign-in, so this replaces the
 * IDE rather than floating over it — a modal can be dismissed, a replacement
 * cannot. Each flow explains what is about to happen *before* it opens a browser
 * or shows a code, because both flows hand the user off to another application
 * and an unexplained hand-off looks like a hang.
 *
 * Both flows need a public client id. Rather than shipping one and asking people
 * to trust it, the screen takes the id, says where to create it, and stores it in
 * settings where it can be changed later.
 */
export const LockScreen: React.FC = () => {
  const { t } = useTranslation();
  const { state, signingIn, signIn, load } = useAuthStore();
  const { settings, updateSettings } = useSettingsStore();
  const [prompt, setPrompt] = useState<DeviceCodePrompt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [clientIdDraft, setClientIdDraft] = useState('');
  const [setupFor, setSetupFor] = useState<'github' | 'google' | null>(null);

  useEffect(() => {
    if (!window.electronAPI) return;
    return window.electronAPI.onAuthPrompt((next: DeviceCodePrompt) => setPrompt(next));
  }, []);

  const start = async (provider: 'github' | 'google') => {
    setError(null);
    setPrompt(null);
    const result = await signIn(provider);
    if (!result.ok) {
      if (result.error === 'no-client-id') {
        setSetupFor(provider);
        return;
      }
      setError(result.error || t('auth.failed'));
    }
  };

  const saveClientId = async () => {
    const value = clientIdDraft.trim();
    if (!value || !setupFor) return;
    await updateSettings(setupFor === 'github' ? { githubClientId: value } : { googleClientId: value });
    setClientIdDraft('');
    setSetupFor(null);
    await load();
  };

  const githubReady = !!settings?.githubClientId;
  const googleReady = !!settings?.googleClientId;

  return (
    <div className="fixed inset-0 z-[100] bg-d4-bg flex items-center justify-center select-none text-xs">
      <div className="w-[520px] max-h-[90vh] overflow-y-auto bg-d4-panel border border-d4-border rounded-xl shadow-2xl p-7 space-y-5">
        <div className="space-y-1.5 text-center">
          <div className="flex items-center justify-center gap-2 text-d4-accent text-lg font-bold tracking-tight">
            <KeyRound className="w-5 h-5" />
            D4IDE
          </div>
          <h1 className="text-d4-text text-sm font-semibold">{t('auth.title')}</h1>
          <p className="text-[11px] text-d4-dimmed leading-relaxed">{t('auth.subtitle')}</p>
        </div>

        {error && (
          <div className="rounded border border-d4-error/40 bg-d4-error/10 text-d4-error p-2.5 text-[11px] leading-relaxed">
            {error}
          </div>
        )}

        {prompt?.userCode && !prompt.browserOpened && (
          <div className="rounded border border-d4-accent/40 bg-d4-accent/10 p-3 space-y-2">
            <div className="text-[11px] text-d4-text font-semibold">{t('auth.deviceCodeTitle')}</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-center font-mono text-base tracking-[0.3em] text-d4-accent bg-d4-bg border border-d4-border rounded py-2">
                {prompt.userCode}
              </code>
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(prompt.userCode);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="d4-icon-button w-8 h-8"
                title={t('auth.copyCode')}
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <button
              onClick={() => window.electronAPI?.openExternal(prompt.verificationUri)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded border border-d4-border text-[11px] text-d4-text hover:border-d4-accent/60"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              {t('auth.openGithub')}
            </button>
            <p className="text-[10px] text-d4-dimmed leading-relaxed">{t('auth.deviceCodeHint')}</p>
          </div>
        )}

        {setupFor && (
          <div className="rounded border border-d4-border bg-d4-surface p-3 space-y-2">
            <div className="text-[11px] text-d4-text font-semibold">
              {setupFor === 'github' ? t('auth.githubSetupTitle') : t('auth.googleSetupTitle')}
            </div>
            <ol className="text-[11px] text-d4-dimmed leading-relaxed list-decimal pl-4 space-y-1">
              {(t(setupFor === 'github' ? 'auth.githubSetupSteps' : 'auth.googleSetupSteps', {
                returnObjects: true
              }) as unknown as string[]).map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
            <button
              onClick={() =>
                window.electronAPI?.openExternal(
                  setupFor === 'github' ? 'https://github.com/settings/developers' : 'https://console.cloud.google.com/apis/credentials'
                )
              }
              className="flex items-center gap-1.5 text-[11px] text-d4-accent hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              {setupFor === 'github' ? 'github.com/settings/developers' : 'console.cloud.google.com/apis/credentials'}
            </button>
            <div className="flex items-center gap-2">
              <input
                value={clientIdDraft}
                onChange={(event) => setClientIdDraft(event.target.value)}
                placeholder={t('auth.clientIdPlaceholder')}
                className="flex-1 bg-d4-bg border border-d4-border rounded px-2.5 py-1.5 text-[11px] text-d4-text font-mono focus:outline-none focus:border-d4-accent"
              />
              <button
                onClick={saveClientId}
                disabled={!clientIdDraft.trim()}
                className="px-3 py-1.5 rounded bg-d4-accent text-black text-[11px] font-semibold disabled:opacity-40"
              >
                {t('common.save')}
              </button>
            </div>
            <button onClick={() => setSetupFor(null)} className="text-[11px] text-d4-dimmed hover:text-d4-text">
              {t('auth.back')}
            </button>
          </div>
        )}

        {!setupFor && (
          <div className="space-y-2">
            <button
              onClick={() => void start('github')}
              disabled={signingIn}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-d4-surface border border-d4-border text-[12px] text-d4-text font-medium hover:border-d4-accent/60 disabled:opacity-50"
            >
              {signingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitHubMark />}
              <span>{t('auth.withGithub')}</span>
              {!githubReady && <span className="text-[10px] text-d4-dimmed">· {t('auth.needsSetup')}</span>}
            </button>

            <button
              onClick={() => void start('google')}
              disabled={signingIn}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-d4-surface border border-d4-border text-[12px] text-d4-text font-medium hover:border-d4-accent/60 disabled:opacity-50"
            >
              {signingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <GoogleMark />}
              <span>{t('auth.withGoogle')}</span>
              {!googleReady && <span className="text-[10px] text-d4-dimmed">· {t('auth.needsSetup')}</span>}
            </button>
          </div>
        )}

        <p className="text-[10px] text-d4-dimmed leading-relaxed text-center">{t('auth.privacyNote')}</p>
      </div>
    </div>
  );
};


