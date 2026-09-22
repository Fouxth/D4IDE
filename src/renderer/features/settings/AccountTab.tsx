import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { GitHubMark, GoogleMark } from '../auth/brand-marks';
import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { toast } from '../../stores/toastStore';
import { formatRelativeTime } from '../../lib/format';

/**
 * Settings → Account.
 *
 * Sign-in is required to use the app, so this page is where it is explained,
 * configured and undone: the identity that is currently signed in, the public
 * client ids the flows need, and the switch that turns the gate on or off. The
 * token itself is never shown — only what it identifies.
 */
export const AccountTab: React.FC<{
  /** True when the page above already carries this heading (Settings → General). */
  embedded?: boolean;
}> = ({ embedded }) => {
  const { t } = useTranslation();
  const { state, signOut, signingIn, signIn } = useAuthStore();
  const { settings, updateSettings } = useSettingsStore();
  const [githubId, setGithubId] = useState(settings?.githubClientId || '');
  const [googleId, setGoogleId] = useState(settings?.googleClientId || '');

  const profile = state?.profile;
  const gateOn = settings?.requireLogin !== false;

  return (
    <div className="space-y-5 select-text">
      {!embedded && (
        <div>
          <h3 className="text-sm font-semibold text-d4-text flex items-center gap-1.5">
            <UserRound className="w-3.5 h-3.5" />
            {t('auth.account')}
          </h3>
          <p className="text-[11px] text-d4-dimmed mt-0.5">{t('auth.subtitle')}</p>
        </div>
      )}

      {/* Who is signed in */}
      <div className="bg-d4-surface border border-d4-border rounded p-3 flex items-center gap-3">
        {profile?.avatarUrl ? (
          <img src={profile.avatarUrl} alt="" className="w-10 h-10 rounded-full border border-d4-border" />
        ) : (
          <div className="w-10 h-10 rounded-full border border-d4-border bg-d4-bg flex items-center justify-center">
            {profile?.provider === 'google' ? <GoogleMark /> : <GitHubMark className="w-4 h-4 text-d4-muted" />}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {profile ? (
            <>
              <div className="text-[12px] text-d4-text font-semibold truncate">{profile.name || profile.login}</div>
              <div className="text-[11px] text-d4-dimmed truncate font-mono">
                {profile.login}
                {profile.email ? ` · ${profile.email}` : ''}
              </div>
              {state?.signedInAt && (
                <div className="text-[10px] text-d4-dimmed">
                  {t('auth.signedInAt', { when: formatRelativeTime(state.signedInAt) })}
                </div>
              )}
            </>
          ) : (
            <div className="text-[12px] text-d4-warning">{t('auth.failed')}</div>
          )}
        </div>
        <button
          onClick={async () => {
            await signOut();
            toast.info(t('auth.signOutHint'));
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-d4-border rounded text-[11px] text-d4-muted hover:text-d4-text shrink-0"
        >
          <LogOut className="w-3 h-3" />
          {t('auth.signOut')}
        </button>
      </div>

      {/* The gate itself */}
      <label className="flex items-center justify-between p-2.5 bg-d4-surface border border-d4-border rounded">
        <span className="min-w-0 pr-3">
          <span className="block text-[11px] text-d4-text">{t('auth.lockApp')}</span>
          <span className="block text-[10px] text-d4-dimmed mt-0.5">{t('auth.lockAppHint')}</span>
        </span>
        <input
          type="checkbox"
          checked={gateOn}
          onChange={(event) => updateSettings({ requireLogin: event.target.checked })}
          className="w-4 h-4 shrink-0 accent-d4-accent"
        />
      </label>

      {/* Client ids */}
      <div className="space-y-3">
        <div className="text-d4-dimmed text-[11px] uppercase font-semibold">{t('auth.clientIdHint')}</div>

        {(
          [
            { provider: 'github' as const, label: t('auth.githubClientId'), value: githubId, set: setGithubId, ready: state?.githubReady },
            { provider: 'google' as const, label: t('auth.googleClientId'), value: googleId, set: setGoogleId, ready: state?.googleReady }
          ]
        ).map((entry) => (
          <div key={entry.provider} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-d4-muted">{entry.label}</span>
              <span className={`text-[10px] ${entry.ready ? 'text-emerald-400' : 'text-d4-dimmed'}`}>
                {entry.ready ? t('auth.configured') : t('auth.notConfigured')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                value={entry.value}
                onChange={(event) => entry.set(event.target.value)}
                placeholder={t('auth.clientIdPlaceholder')}
                className="flex-1 bg-d4-bg border border-d4-border rounded px-2.5 py-1.5 text-[11px] font-mono text-d4-text focus:outline-none focus:border-d4-accent"
              />
              <button
                onClick={() =>
                  updateSettings(
                    entry.provider === 'github'
                      ? { githubClientId: entry.value.trim() }
                      : { googleClientId: entry.value.trim() }
                  )
                }
                className="px-3 py-1.5 rounded border border-d4-border text-[11px] text-d4-muted hover:text-d4-text"
              >
                {t('common.save')}
              </button>
              <button
                onClick={() => void signIn(entry.provider)}
                disabled={signingIn || !entry.value.trim()}
                className="px-3 py-1.5 rounded bg-d4-accent text-black text-[11px] font-semibold disabled:opacity-40"
              >
                {signingIn ? '…' : t('auth.signIn')}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-2 p-2.5 bg-d4-surface border border-d4-border rounded text-[11px] text-d4-dimmed leading-relaxed">
        <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400" />
        <span>{t('auth.tokenNote')}</span>
      </div>
    </div>
  );
};


