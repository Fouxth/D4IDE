import React, { useEffect, useState } from 'react';
import {
  X,
  ChevronRight,
  ChevronDown,
  Check,
  Download,
  Upload,
  Play,
  Trash2,
  FileClock,
  ChevronLeft,
  Cpu,
  Globe,
  Shield,
  ArrowUpRight,
  Sun,
  Moon,
  Wand2
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAgentStore } from '../../stores/agentStore';
import { useProject } from '../../stores/projectStore';
import { useSpacesStore } from '../../stores/spacesStore';
import { toast } from '../../stores/toastStore';
import { PermissionMode, SessionSummary, ToolAuditEntry } from '../../../shared/types';
import { THEME_IDS, normalizeTheme } from '../../../shared/theme';
import { APP_VERSION } from '../../../shared/version';
import { UsageDashboard } from '../usage/UsageDashboard';
import { LogsTab, UpdateTab } from './DiagnosticsTabs';
import { McpTab } from './McpTab';
import { DatabaseTab } from './DatabaseTab';
import { AccountTab } from './AccountTab';
import { ProjectTab } from './ProjectTab';
import { SkillsTab } from './SkillsTab';
import { FONT_SIZE_STEPS } from '../../../shared/appearance';
import { notify, previewSound } from '../../lib/notify';
import { useEscapeToClose } from '../../lib/use-escape';
import { formatRelativeTime, formatDuration } from '../../lib/format';
import { projectName } from '../../lib/session-badge';

/**
 * Settings, laid out the way the reference client does it.
 *
 * A full-window surface, not a dialog: the title in the top-left corner, a plain
 * word list down the left (no icons — the words are the icons), one page of
 * content at a time with a heading and a one-line explanation, and the way back
 * to the workspace pinned at the bottom of the nav. Everything that used to have
 * its own rail entry is still reachable: pages carry the sections that belong to
 * them, and sections fold away when they are not the reason the page was opened.
 *
 * The names the rest of the app calls (`openSettings('logs')`, `'usage'`, …) are
 * resolved through `PAGE_ALIASES`, so an old entry point lands on the right page
 * with the right section unfolded rather than nowhere.
 */

export type SettingsPageId = 'general' | 'appearance' | 'connectors' | 'projects' | 'skills' | 'providers';

/**
 * Old tab names, and where each one lives now.
 *
 * This is the price of shrinking thirteen rail entries to six: every caller that
 * asked for a page by name keeps working, and `section` is how the page it lands
 * on knows which part to unfold and scroll to.
 */
const PAGE_ALIASES: Record<string, { page: SettingsPageId; section?: string }> = {
  account: { page: 'general', section: 'account' },
  language: { page: 'general', section: 'language' },
  notifications: { page: 'general', section: 'notifications' },
  permissions: { page: 'general', section: 'permissions' },
  agent: { page: 'general', section: 'agent' },
  sessions: { page: 'general', section: 'sessions' },
  usage: { page: 'general', section: 'usage' },
  logs: { page: 'general', section: 'logs' },
  database: { page: 'general', section: 'database' },
  update: { page: 'general', section: 'update' },
  about: { page: 'general', section: 'about' },
  mcp: { page: 'connectors' },
  project: { page: 'projects' },
  providers: { page: 'providers' }
};

export type SettingsTabId = SettingsPageId | keyof typeof PAGE_ALIASES;

const PAGES: SettingsPageId[] = ['general', 'appearance', 'connectors', 'projects', 'skills', 'providers'];

/** Any name the app might still call this dialog with, resolved to a page. */
export function resolveSettingsTarget(tab?: string): { page: SettingsPageId; section?: string } {
  if (!tab) return { page: 'general' };
  if ((PAGES as string[]).includes(tab)) return { page: tab as SettingsPageId };
  return PAGE_ALIASES[tab] ?? { page: 'general' };
}

/** Sections that are open when nothing in particular was asked for. */
const SECTIONS_OPEN_BY_DEFAULT = ['language', 'notifications', 'permissions', 'agent'];

const sectionsFor = (requested?: string): Record<string, boolean> =>
  Object.fromEntries(
    [...SECTIONS_OPEN_BY_DEFAULT, ...(requested ? [requested] : [])].map((id) => [id, true])
  );

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: string;
  /** Where "Add provider" leads: keys and models live in the provider dialog. */
  onOpenProviders?: (view?: 'list' | 'add') => void;
  /** Opens one of the remembered projects, so the Projects page can switch. */
  onOpenProject?: (path: string) => void;
}

/** The heading every page starts with, in the reference client's rhythm. */
const PageHeader: React.FC<{ title: string; hint: string; children?: React.ReactNode }> = ({
  title,
  hint,
  children
}) => (
  <div className="space-y-1.5">
    <h1 className="text-2xl font-semibold text-d4-text">{title}</h1>
    <p className="text-[13px] text-d4-muted leading-relaxed">{hint}</p>
    {children}
  </div>
);

/** One foldable group inside a page, with a hairline above it. */
const Section: React.FC<{
  id: string;
  title: string;
  hint?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ id, title, hint, open, onToggle, children }) => (
  <section id={`settings-section-${id}`} className="border-t border-d4-border-subtle pt-4">
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="w-full flex items-center gap-2 text-left group"
    >
      {open ? (
        <ChevronDown className="w-4 h-4 text-d4-dimmed shrink-0" />
      ) : (
        <ChevronRight className="w-4 h-4 text-d4-dimmed shrink-0" />
      )}
      <span className="text-[13px] font-medium text-d4-text">{title}</span>
      {hint && <span className="ml-auto hidden sm:block text-[11px] text-d4-dimmed">{hint}</span>}
    </button>
    {open && <div className="pt-3.5 pl-6">{children}</div>}
  </section>
);

// ---------------------------------------------------------------- sessions

const SessionsTab: React.FC<{ onClose: () => void; embedded?: boolean }> = ({ onClose, embedded }) => {
  const { t } = useTranslation();
  const { projectPath } = useProject((s) => ({ projectPath: s.projectPath }));
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [audit, setAudit] = useState<ToolAuditEntry[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const resumeSession = useAgentStore((state) => state.resumeSession);

  const refresh = async () => {
    if (!window.electronAPI) return;
    const [sessionList, auditList] = await Promise.all([
      window.electronAPI.listSessions(),
      window.electronAPI.listToolAudit(40)
    ]);
    setSessions(sessionList);
    setAudit(auditList);
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="space-y-5 select-text">
      {!embedded && (
        <div>
          <h3 className="text-sm font-semibold text-d4-text">{t('sessions.title')}</h3>
          <p className="text-[11px] text-d4-dimmed mt-0.5">{t('sessions.subtitle')}</p>
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="text-center py-8 text-d4-dimmed text-xs">{t('sessions.empty')}</div>
      ) : (
        <div className="space-y-2">
          {sessions.map((session) => (
            <div key={session.id} className="bg-d4-surface border border-d4-border rounded p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-d4-text truncate">{session.title || session.id}</div>
                  <div className="text-[10px] text-d4-dimmed font-mono truncate">
                    {session.projectPath} · {session.modelId}
                  </div>
                </div>
                <div className="flex items-center space-x-2 shrink-0">
                  <span className="text-[10px] text-d4-dimmed">{formatRelativeTime(session.updatedAt)}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${
                      session.status === 'completed'
                        ? 'border-emerald-500/30 text-emerald-400'
                        : session.status === 'failed'
                          ? 'border-red-500/30 text-red-400'
                          : session.status === 'running'
                            ? 'border-amber-500/30 text-amber-400'
                            : 'border-d4-border text-d4-muted'
                    }`}
                    title={session.status === 'running' ? t('sessions.interrupted') : undefined}
                  >
                    {t(`sessions.status_${session.status}`, session.status)}
                  </span>

                  {/* Replay this run in the agent view and keep talking in it (spec §45). */}
                  <button
                    onClick={async () => {
                      const resumed = await resumeSession(session.id);
                      if (resumed) {
                        toast.success(t('sessions.resumed'));
                        onClose();
                      } else {
                        toast.error(t('sessions.resumeFailed'));
                      }
                    }}
                    title={t('sessions.resume')}
                    className="text-d4-dimmed hover:text-d4-accent"
                  >
                    <Play className="w-3 h-3" />
                  </button>

                  <button
                    onClick={async () => {
                      if (confirmDelete !== session.id) {
                        // Deleting a session removes its transcript too, so ask first.
                        setConfirmDelete(session.id);
                        return;
                      }
                      if (!window.electronAPI) return;
                      await window.electronAPI.deleteSession(session.id);
                      if (session.projectPath && !projectPath) {
                        await window.electronAPI.openProjectPath(session.projectPath);
                      }
                      setConfirmDelete(null);
                      refresh();
                    }}
                    className={
                      confirmDelete === session.id
                        ? 'text-red-400 font-semibold'
                        : 'text-d4-dimmed hover:text-red-400'
                    }
                    title={confirmDelete === session.id ? t('sessions.confirmDelete') : t('sessions.delete')}
                  >
                    {confirmDelete === session.id ? (
                      <span className="text-[10px]">{t('sessions.confirmDelete')}</span>
                    ) : (
                      <Trash2 className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <div className="text-d4-dimmed text-[11px] uppercase font-semibold flex items-center space-x-1.5">
          <FileClock className="w-3.5 h-3.5" />
          <span>{t('sessions.audit')}</span>
        </div>
        {audit.length === 0 ? (
          <div className="text-center py-6 text-d4-dimmed text-xs">{t('sessions.noAudit')}</div>
        ) : (
          <div className="bg-d4-surface border border-d4-border rounded overflow-hidden">
            {audit.map((entry) => (
              <div
                key={entry.id}
                className="px-3 py-1.5 text-[11px] border-b border-d4-border/40 last:border-0 flex items-start justify-between gap-2"
              >
                <div className="min-w-0">
                  <span className="font-mono text-d4-text">{entry.toolName}</span>
                  <span className="text-d4-dimmed"> · {entry.mode}</span>
                  {entry.decision && <span className="text-d4-dimmed"> · {entry.decision}</span>}
                  <div className="text-[10px] text-d4-dimmed truncate font-mono">{entry.argsPreview}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className={entry.allowed ? 'text-emerald-400' : 'text-red-400'}>
                    {entry.allowed ? t('sessions.allowed') : t('sessions.blocked')}
                  </div>
                  <div className="text-[10px] text-d4-dimmed">
                    {entry.durationMs ? formatDuration(entry.durationMs) : ''} {formatRelativeTime(entry.timestamp)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ pages

const GeneralPage: React.FC<{ onClose: () => void; openSection?: string; onOpenProviders?: (view?: 'list' | 'add') => void }> = ({ onClose, openSection, onOpenProviders }) => {
  const { t } = useTranslation();
  const { settings, updateSettings, setLanguage } = useSettingsStore();
  const { clearSession } = useAgentStore();
  const [open, setOpen] = useState<Record<string, boolean>>(() => sectionsFor(openSection));
  const toggle = (id: string) => setOpen((prev) => ({ ...prev, [id]: !prev[id] }));

  // The caller that asked for `openSettings('logs')` gets the logs section open:
  // otherwise the request lands on a page full of folded rows and looks ignored.
  useEffect(() => {
    if (!openSection) return;
    setOpen((prev) => ({ ...prev, [openSection]: true }));
  }, [openSection]);

  if (!settings) return null;

  const soundOptions = [
    { id: 'system' as const, label: t('settings.notifySoundSystem') },
    { id: 'chime' as const, label: t('settings.notifySoundChime') },
    { id: 'ping' as const, label: t('settings.notifySoundPing') },
    { id: 'pop' as const, label: t('settings.notifySoundPop') },
    { id: 'none' as const, label: t('settings.notifySoundNone') }
  ];

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------- language */}
      <Section id="language" title={t('settings.language')} open={!!open.language} onToggle={() => toggle('language')}>
        <p className="text-[11px] text-d4-dimmed mb-2.5">{t('settings.languageHint')}</p>
        <div className="inline-flex items-center rounded-md border border-d4-border bg-d4-surface p-0.5">
          {(['th', 'en'] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => setLanguage(lang)}
              className={`px-3.5 py-1.5 rounded text-[12px] transition-colors ${
                settings.language === lang ? 'bg-d4-panel text-d4-text font-medium' : 'text-d4-dimmed hover:text-d4-text'
              }`}
            >
              {lang === 'th' ? t('settings.languageThai') : t('settings.languageEnglish')}
            </button>
          ))}
        </div>
      </Section>

      {/* -------------------------------------------------- notifications */}
      <Section
        id="notifications"
        title={t('settings.notifyTitle')}
        open={!!open.notifications}
        onToggle={() => toggle('notifications')}
      >
        <div className="space-y-4 max-w-xl">
          <label className="flex items-start justify-between gap-3">
            <span>
              <span className="block text-[12px] text-d4-text">{t('settings.notifyTitle')}</span>
              <span className="block text-[11px] text-d4-dimmed mt-0.5">{t('settings.notifyHint')}</span>
            </span>
            <input
              type="checkbox"
              checked={settings.desktopNotifications}
              onChange={(e) => updateSettings({ desktopNotifications: e.target.checked })}
              className="accent-teal-500 w-4 h-4 cursor-pointer mt-0.5 shrink-0"
            />
          </label>

          <div className="space-y-1.5">
            <span className="text-[11px] text-d4-muted">{t('settings.notifySound')}</span>
            <div className="flex flex-wrap items-center gap-1">
              {soundOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    updateSettings({ notificationSound: option.id });
                    // A sound is chosen by ear: play whatever was picked,
                    // including silence, so the choice is not a guess.
                    if (option.id !== 'system') window.setTimeout(previewSound, 60);
                  }}
                  className={`px-2.5 py-1 rounded-sm text-[11px] border transition-colors ${
                    (settings.notificationSound ?? 'chime') === option.id
                      ? 'border-d4-accent bg-d4-accent/15 text-d4-accent'
                      : 'border-d4-border text-d4-muted hover:text-d4-text'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => previewSound()}
              className="px-2.5 py-1 rounded-sm text-[11px] border border-d4-border text-d4-muted hover:text-d4-text"
            >
              {t('settings.notifyPreview')}
            </button>
            <button
              type="button"
              onClick={() => {
                // The real path, not a mock: this is the same call a finished task
                // makes, so an OS permission problem shows up here rather than at
                // 2 a.m. during a long run.
                notify(t('notify.taskCompleted'), t('notify.taskCompletedBody'), 'task');
                toast.info(t('settings.notifyTest'));
              }}
              className="px-2.5 py-1 rounded-sm text-[11px] border border-d4-border text-d4-muted hover:text-d4-text"
            >
              {t('settings.notifyTest')}
            </button>
          </div>
        </div>
      </Section>

      {/* ----------------------------------------------------- permissions */}
      <Section
        id="permissions"
        title={t('settings.permissions')}
        open={!!open.permissions}
        onToggle={() => toggle('permissions')}
      >
        <div className="space-y-3 max-w-xl">
          <p className="text-[11px] text-d4-dimmed">{t('settings.permissionHint')}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {(['safe', 'ask', 'full'] as PermissionMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  updateSettings({ permissionMode: mode });
                  toast.info(t('settings.permissionChanged', { mode }));
                }}
                className={`text-left p-3 rounded-md border transition-all ${
                  settings.permissionMode === mode
                    ? 'border-d4-accent bg-d4-accent/10 text-d4-text'
                    : 'border-d4-border bg-d4-surface text-d4-muted hover:border-d4-dimmed'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold capitalize text-xs flex items-center gap-1.5">
                    <Shield className="w-3 h-3" />
                    {mode}
                  </span>
                  {settings.permissionMode === mode && <Check className="w-4 h-4 text-d4-accent" />}
                </div>
                <p className="text-[11px] text-d4-dimmed leading-snug">
                  {mode === 'safe' && t('settings.permissionSafe')}
                  {mode === 'ask' && t('settings.permissionAsk')}
                  {mode === 'full' && t('settings.permissionFull')}
                </p>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-d4-dimmed leading-relaxed">{t('settings.guardrailNote')}</p>
        </div>
      </Section>

      {/* ---------------------------------------------------------- agent */}
      <Section
        id="agent"
        title={t('settings.agentSettings')}
        open={!!open.agent}
        onToggle={() => toggle('agent')}
      >
        <div className="space-y-2.5 max-w-xl">
          {(
            [
              { key: 'autoRunTests' as const, label: t('settings.autoRunTests') },
              { key: 'autoRunBuild' as const, label: t('settings.autoRunBuild') },
              { key: 'autoFallback' as const, label: t('settings.autoFallback') }
            ]
          ).map((entry) => (
            <label
              key={entry.key}
              className="flex items-center justify-between p-2.5 bg-d4-surface border border-d4-border rounded text-[12px] text-d4-text"
            >
              <span>{entry.label}</span>
              <input
                type="checkbox"
                checked={settings[entry.key]}
                onChange={(e) => updateSettings({ [entry.key]: e.target.checked } as any)}
                className="accent-teal-500 w-4 h-4 cursor-pointer"
              />
            </label>
          ))}

          {(
            [
              { key: 'maxAgentSteps' as const, label: t('settings.maxAgentSteps'), step: 1 },
              { key: 'toolTimeoutMs' as const, label: t('settings.toolTimeout'), step: 10000 },
              { key: 'retryLimit' as const, label: t('settings.retryLimit'), step: 1 }
            ]
          ).map((field) => (
            <div
              key={field.key}
              className="p-2.5 bg-d4-surface border border-d4-border rounded flex items-center justify-between text-[12px] text-d4-text"
            >
              <span>{field.label}</span>
              <input
                type="number"
                step={field.step}
                value={settings[field.key] as number}
                onChange={(e) => updateSettings({ [field.key]: parseInt(e.target.value) || 0 } as any)}
                className="w-24 bg-d4-panel border border-d4-border rounded px-2 py-1 text-xs text-d4-text text-right outline-none font-mono"
              />
            </div>
          ))}

          <div className="p-2.5 bg-d4-surface border border-d4-border rounded space-y-1.5">
            <span className="text-[11px] text-d4-muted flex items-center gap-1.5">
              <Cpu className="w-3 h-3" />
              {t('settings.checkpointFrequency')}
            </span>
            <div className="flex items-center space-x-1">
              {(['write', 'task', 'off'] as const).map((freq) => (
                <button
                  key={freq}
                  type="button"
                  onClick={() => updateSettings({ checkpointFrequency: freq })}
                  className={`px-2.5 py-1 rounded-sm text-[11px] ${
                    settings.checkpointFrequency === freq
                      ? 'bg-d4-accent/20 text-d4-accent'
                      : 'text-d4-muted hover:text-d4-text'
                  }`}
                >
                  {t(`settings.checkpoint_${freq}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="p-2.5 bg-d4-surface border border-d4-border rounded space-y-1.5">
            <span className="text-[11px] text-d4-muted">{t('settings.routingProfile')}</span>
            <div className="flex items-center space-x-1">
              {(['quality', 'balanced', 'cost', 'fast'] as const).map((profile) => (
                <button
                  key={profile}
                  type="button"
                  onClick={() => updateSettings({ routingProfile: profile })}
                  className={`px-2.5 py-1 rounded-sm text-[11px] ${
                    settings.routingProfile === profile
                      ? 'bg-d4-accent/20 text-d4-accent'
                      : 'text-d4-muted hover:text-d4-text'
                  }`}
                >
                  {t(`settings.routing_${profile}`)}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-d4-dimmed">{t('settings.routingHint')}</p>
          </div>
        </div>
      </Section>

      {/* -------------------------------------------------------- account */}
      <Section id="account" title={t('auth.account')} open={!!open.account} onToggle={() => toggle('account')}>
        <AccountTab embedded />
      </Section>

      {/* ------------------------------------------------------- sessions */}
      <Section id="sessions" title={t('settings.sessions')} open={!!open.sessions} onToggle={() => toggle('sessions')}>
        <SessionsTab onClose={onClose} embedded />
      </Section>

      {/* ---------------------------------------------------------- usage */}
      <Section id="usage" title={t('settings.budgets')} open={!!open.usage} onToggle={() => toggle('usage')}>
        {/* The AI-team card can hand a broken seat to the provider hub's local
            models — closing the settings modal is how that hand-off starts. */}
        <UsageDashboard embedded onRequestProviders={() => { onClose(); onOpenProviders?.('list'); }} />
      </Section>

      {/* ---------------------------------------------------- diagnostics */}
      <Section id="logs" title={t('settings.logs')} open={!!open.logs} onToggle={() => toggle('logs')}>
        <LogsTab embedded />
      </Section>
      <Section id="database" title={t('settings.database')} open={!!open.database} onToggle={() => toggle('database')}>
        <DatabaseTab />
      </Section>
      <Section id="update" title={t('settings.updates')} open={!!open.update} onToggle={() => toggle('update')}>
        <UpdateTab embedded />
      </Section>

      {/* ---------------------------------------------------------- about */}
      <Section id="about" title={t('settings.about')} open={!!open.about} onToggle={() => toggle('about')}>
        <div className="space-y-3 max-w-xl">
          <div className="bg-d4-surface border border-d4-border rounded p-3 space-y-1.5 text-[11px] text-d4-muted">
            <div className="text-d4-text font-semibold">D4IDE {APP_VERSION}</div>
            <p>{t('settings.aboutText')}</p>
            <p className="text-d4-dimmed">{t('settings.privacyNote')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                clearSession();
                toast.info(t('settings.sessionCleared'));
              }}
              className="px-3 py-1.5 border border-d4-border rounded text-[11px] text-d4-muted hover:text-d4-text"
            >
              {t('settings.clearSession')}
            </button>
            <button
              type="button"
              onClick={async () => {
                const file = await window.electronAPI?.exportSettings();
                if (file) toast.success(t('settings.exported'), file);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-d4-border rounded text-[11px] text-d4-muted hover:text-d4-text"
            >
              <Download className="w-3 h-3" />
              {t('settings.exportSettings')}
            </button>
            <button
              type="button"
              onClick={async () => {
                const result = await window.electronAPI?.importSettings();
                if (!result) return;
                if (result.ok) {
                  await useSettingsStore.getState().loadSettings();
                  toast.success(t('settings.imported'));
                } else {
                  toast.error(t('settings.importFailed'), result.error);
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-d4-border rounded text-[11px] text-d4-muted hover:text-d4-text"
            >
              <Upload className="w-3 h-3" />
              {t('settings.importSettings')}
            </button>
          </div>
          <p className="text-[10px] text-d4-dimmed">{t('settings.exportNote')}</p>
        </div>
      </Section>
    </div>
  );
};

const AppearancePage: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettingsStore();
  if (!settings) return null;

  /** Each theme, shown by the thing it changes rather than by its name alone. */
  const themes: { id: (typeof THEME_IDS)[number]; label: string; hint: string; icon: React.ComponentType<{ className?: string }> }[] = [
    {
      id: 'd4-dark',
      label: t('settings.theme_d4-dark'),
      hint: t('settings.theme_d4-darkHint'),
      icon: Moon
    },
    {
      id: 'd4-light',
      label: t('settings.theme_d4-light'),
      hint: t('settings.theme_d4-lightHint'),
      icon: Sun
    },
    {
      id: 'freebuff',
      label: t('settings.theme_freebuff'),
      hint: t('settings.theme_freebuffHint'),
      icon: Wand2
    }
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-2.5 max-w-xl">
        <div>
          <h2 className="text-[13px] font-medium text-d4-text">{t('settings.themeTitle')}</h2>
          <p className="text-[11px] text-d4-dimmed mt-0.5">{t('settings.themeHint')}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {themes.map((theme) => {
            const Icon = theme.icon;
            const active = normalizeTheme(settings.theme) === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => updateSettings({ theme: theme.id })}
                className={`text-left rounded-md border p-3 transition-all ${
                  active ? 'border-d4-accent bg-d4-accent/10' : 'border-d4-border bg-d4-surface hover:border-d4-dimmed'
                }`}
              >
                <span className="flex items-center gap-2 text-[12px] text-d4-text font-medium">
                  <Icon className="w-3.5 h-3.5" />
                  {theme.label}
                  {active && <Check className="w-3.5 h-3.5 text-d4-accent ml-auto" />}
                </span>
                <span className="block mt-1 text-[11px] text-d4-dimmed leading-snug">{theme.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-d4-border-subtle pt-4 space-y-2.5 max-w-xl">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-d4-text">{t('settings.fontSize')}</span>
          <span className="text-[11px] text-d4-dimmed">{t('settings.fontSizeHint')}</span>
        </div>
        <div className="flex items-center gap-1">
          {[
            { size: FONT_SIZE_STEPS[0], label: t('settings.fontSmall') },
            { size: FONT_SIZE_STEPS[1], label: t('settings.fontMedium') },
            { size: FONT_SIZE_STEPS[2], label: t('settings.fontLarge') },
            { size: FONT_SIZE_STEPS[3], label: t('settings.fontHuge') }
          ].map((option) => (
            <button
              key={option.size}
              type="button"
              onClick={() => updateSettings({ fontSize: option.size })}
              className={`flex-1 px-2 py-1.5 rounded-sm text-[11px] border transition-colors ${
                settings.fontSize === option.size
                  ? 'border-d4-accent bg-d4-accent/15 text-d4-accent font-medium'
                  : 'border-d4-border text-d4-muted hover:text-d4-text'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

const ProjectsPage: React.FC<{ onOpenProject?: (path: string) => void }> = ({ onOpenProject }) => {
  const { t } = useTranslation();
  const { projectPath } = useProject((s) => ({ projectPath: s.projectPath }));
  const spaces = useSpacesStore((state) => state.spaces);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-[13px] font-medium text-d4-text">{t('settings.projectsSwitch')}</h2>
        <p className="text-[11px] text-d4-dimmed">{t('settings.projectsSwitchHint')}</p>
        <div className="flex flex-wrap gap-2">
          {spaces.length === 0 && <span className="text-[11px] text-d4-dimmed">{t('settings.projectsNone')}</span>}
          {spaces.map((space) => {
            const active = space === projectPath;
            return (
              <button
                key={space}
                type="button"
                onClick={() => {
                  if (!active) onOpenProject?.(space);
                }}
                title={space}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-[12px] transition-colors ${
                  active
                    ? 'border-d4-accent bg-d4-accent/10 text-d4-text'
                    : 'border-d4-border text-d4-muted hover:text-d4-text hover:border-d4-muted'
                }`}
              >
                {active && <Check className="w-3 h-3 text-d4-accent" />}
                {projectName(space) || space}
              </button>
            );
          })}
        </div>
      </div>

      {/* The project's own page: what it is and how its screens should look. */}
      <div className="border-t border-d4-border-subtle pt-4">
        <ProjectTab />
      </div>
    </div>
  );
};

const ProvidersPage: React.FC<{ onOpenProviders?: (view?: 'list' | 'add') => void }> = ({ onOpenProviders }) => {
  const { t } = useTranslation();
  const { providers } = useSettingsStore();

  /**
   * A provider counts as set up when it has a key or has served models. The key
   * itself never reaches the renderer — `hasApiKey` is the sanitized flag that
   * the main process sends instead (spec §29).
   */
  const configured = providers.filter(
    (provider) => provider.hasApiKey || (provider.models?.length ?? 0) > 0
  );

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-[13px] font-medium text-d4-text">{t('settings.providersOwn')}</h2>
        <p className="text-[11px] text-d4-dimmed">{t('settings.providersOwnHint')}</p>
      </div>

      {/*
       * The actions sit above the list, not under it: a machine with a dozen
       * providers configured would otherwise put "Add provider" below the fold,
       * and the one button the page exists for should never need scrolling to.
       */}
      {configured.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenProviders?.('add')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-d4-accent text-black text-[12px] font-semibold hover:brightness-110 transition-all"
          >
            {t('providers.addProvider')}
          </button>
          <button
            type="button"
            onClick={() => onOpenProviders?.('list')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-d4-border text-[12px] text-d4-muted hover:text-d4-text transition-colors"
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
            {t('providers.manageKeys')}
          </button>
        </div>
      )}

      {configured.length === 0 ? (
        <div className="rounded-lg border border-d4-border bg-d4-surface/60 p-8 text-center space-y-2.5">
          <h3 className="text-[15px] font-semibold text-d4-text">{t('providers.connectTitle')}</h3>
          <p className="text-[12px] text-d4-dimmed max-w-md mx-auto leading-relaxed">{t('providers.connectHint')}</p>
          <button
            type="button"
            onClick={() => onOpenProviders?.('add')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-d4-accent text-black text-[12px] font-semibold hover:brightness-110 transition-all"
          >
            {t('providers.addProvider')}
          </button>
        </div>
      ) : (
        <div className="border-t border-d4-border-subtle">
          {configured.map((provider) => (
            <div
              key={provider.id}
              className="flex items-center gap-3 border-b border-d4-border-subtle py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-d4-text truncate">{provider.name || provider.id}</div>
                <div className="text-[11px] text-d4-dimmed font-mono truncate">
                  {provider.baseUrl || provider.id}
                </div>
              </div>
              <span className="shrink-0 text-[11px] text-d4-dimmed">
                {t('providers.modelsCount', { count: provider.models?.length ?? 0 })}
              </span>
              {provider.keyUnreadable ? (
                <span className="shrink-0 text-[10px] text-d4-warning">
                  {t('providers.keyUnreadableShort')}
                </span>
              ) : provider.hasApiKey ? (
                <span className="shrink-0 text-[10px] text-emerald-400">{t('providers.configured')}</span>
              ) : (
                <span className="shrink-0 text-[10px] text-d4-dimmed">{t('providers.status.not_configured')}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-d4-dimmed flex items-center gap-1.5">
        <Globe className="w-3 h-3" />
        {t('settings.savedImmediately')}
      </p>
      <p className="text-[11px] text-d4-dimmed leading-relaxed">{t('providers.customKeyNote')}</p>
    </div>
  );
};

// ------------------------------------------------------------ the modal

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  initialTab,
  onOpenProviders,
  onOpenProject
}) => {
  const { t } = useTranslation();
  const { settings } = useSettingsStore();
  const spaces = useSpacesStore((state) => state.spaces);
  const { projectPath } = useProject((s) => ({ projectPath: s.projectPath }));
  const requested = resolveSettingsTarget(initialTab);
  const [page, setPage] = useState<SettingsPageId>(() => requested.page);
  const [expandedGroups, setExpandedGroups] = useState<string[]>(['projects']);

  // The rail, the status bar and the palette all open specific pages, so follow
  // the request — and when it names a section, that section is opened for the
  // caller, because it is the reason they asked for this page at all.
  useEffect(() => {
    if (!isOpen) return;
    const target = resolveSettingsTarget(initialTab);
    setPage(target.page);
    if (target.section) setExpandedGroups((groups) => [...groups, 'projects']);
    if (target.section) {
      window.setTimeout(() => {
        document
          .getElementById(`settings-section-${target.section}`)
          ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }, 80);
    }
  }, [isOpen, initialTab]);

  useEscapeToClose(isOpen, onClose);

  if (!isOpen || !settings) return null;

  /**
   * One nav row.
   *
   * A group is *two* buttons — the label and the chevron — because nesting a
   * clickable arrow inside a clickable row is invalid HTML: the inner control
   * never receives the press on some platforms, and a screen reader announces one
   * button with two jobs.
   */
  const navItem = (id: SettingsPageId, label: string, children?: React.ReactNode) => {
    const active = page === id;
    const expandable = !!children;
    const expanded = expandedGroups.includes(id);
    const rowClass = (isActive: boolean) =>
      `text-left text-[13px] transition-colors ${
        isActive ? 'text-d4-text font-medium' : 'text-d4-muted hover:text-d4-text'
      }`;
    return (
      <div key={id}>
        <div
          className={`flex items-center rounded-md ${active ? 'bg-d4-surface' : 'hover:bg-d4-surface/50'}`}
        >
          <button type="button" onClick={() => setPage(id)} className={`flex-1 min-w-0 px-3 py-2 rounded-md ${rowClass(active)}`}>
            <span className="block truncate">{label}</span>
          </button>
          {expandable && (
            <button
              type="button"
              onClick={() =>
                setExpandedGroups((groups) =>
                  groups.includes(id) ? groups.filter((entry) => entry !== id) : [...groups, id]
                )
              }
              aria-expanded={expanded}
              aria-label={t(expanded ? 'settings.collapseGroup' : 'settings.expandGroup')}
              className="px-2 py-2 text-d4-dimmed hover:text-d4-text"
            >
              {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
        {expandable && expanded && <div className="mt-0.5 pl-3">{children}</div>}
      </div>
    );
  };

  const navChild = (label: string, onClick: () => void, active = false, title?: string) => (
    <button
      key={`${label}-${title ?? ''}`}
      type="button"
      onClick={onClick}
      title={title}
      className={`w-full text-left px-3 py-1.5 rounded-md text-[12px] truncate transition-colors ${
        active ? 'bg-d4-surface text-d4-text' : 'text-d4-dimmed hover:text-d4-text hover:bg-d4-surface/40'
      }`}
    >
      {label}
    </button>
  );

  const titles: Record<SettingsPageId, { title: string; hint: string }> = {
    general: { title: t('settings.page_general'), hint: t('settings.pageHint_general') },
    appearance: { title: t('settings.page_appearance'), hint: t('settings.pageHint_appearance') },
    connectors: { title: t('settings.page_connectors'), hint: t('settings.pageHint_connectors') },
    // The reference client titles this page with the project's name, and so does
    // this one: the page is about *that* project, not about projects in general.
    projects: {
      title: projectName(projectPath || '') || t('settings.page_projects'),
      hint: t('settings.pageHint_projects')
    },
    skills: { title: t('settings.page_skills'), hint: t('settings.pageHint_skills') },
    providers: { title: t('settings.page_apiProviders'), hint: t('settings.pageHint_apiProviders') }
  };

  return (
    <div className="fixed inset-0 z-50 bg-d4-bg flex select-none">
      {/* ------------------------------------------------------------- nav */}
      <aside className="w-60 shrink-0 border-r border-d4-border-subtle flex flex-col">
        <div className="px-4 pt-5 pb-3">
          <h2 className="text-[17px] font-semibold text-d4-text">{t('settings.title')}</h2>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-0.5">
          {navItem('general', t('settings.page_general'))}
          {navItem('appearance', t('settings.page_appearance'))}
          {navItem('connectors', t('settings.page_connectors'))}
          {navItem(
            'projects',
            t('settings.page_projects'),
            <>
              {spaces.length === 0 && (
                <span className="block px-3 py-1.5 text-[12px] text-d4-dimmed">{t('settings.projectsNone')}</span>
              )}
              {spaces.map((space) =>
                navChild(
                  projectName(space) || space,
                  () => {
                    setPage('projects');
                    if (space !== projectPath) onOpenProject?.(space);
                  },
                  space === projectPath,
                  space
                )
              )}
            </>
          )}
          {navItem('skills', t('settings.page_skills'))}
          {navItem('providers', t('settings.page_apiProviders'))}
        </nav>

        <div className="border-t border-d4-border-subtle p-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full flex items-center gap-1.5 px-3 py-2 rounded-md text-[12px] text-d4-muted hover:text-d4-text hover:bg-d4-surface transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            {t('settings.backToWorkspace')}
          </button>
        </div>
      </aside>

      {/* --------------------------------------------------------- content */}
      <div className="flex-1 min-w-0 overflow-y-auto relative">
        <button
          type="button"
          onClick={onClose}
          title={t('common.close')}
          className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-md text-d4-muted hover:text-d4-text hover:bg-d4-surface transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="px-10 py-8 max-w-3xl">
          <PageHeader title={titles[page].title} hint={titles[page].hint} />

          <div className="mt-6">
            {page === 'general' && <GeneralPage onClose={onClose} openSection={requested.section} onOpenProviders={onOpenProviders} />}
            {page === 'appearance' && <AppearancePage />}
            {page === 'connectors' && <McpTab embedded />}
            {page === 'projects' && <ProjectsPage onOpenProject={onOpenProject} />}
            {page === 'skills' && <SkillsTab />}
            {page === 'providers' && <ProvidersPage onOpenProviders={onOpenProviders} />}
          </div>

          <div className="h-16" />
        </div>
      </div>
    </div>
  );
};
