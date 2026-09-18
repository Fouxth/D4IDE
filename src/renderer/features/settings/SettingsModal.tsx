import React, { useEffect, useState } from 'react';
import {
  X,
  Globe,
  Shield,
  Cpu,
  Key,
  DollarSign,
  Check,
  History,
  Info,
  Trash2,
  FileClock,
  Play,
  ScrollText,
  Download,
  Upload,
  RefreshCw,
  Plug,
  Database,
  FolderTree,
  UserRound
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAgentStore } from '../../stores/agentStore';
import { useProject } from '../../stores/projectStore';
import { toast } from '../../stores/toastStore';
import { LogLevel, LogRecord, PermissionMode, SessionSummary, ToolAuditEntry, UpdateStatus } from '../../../shared/types';
import { ProviderHub } from '../providers/ProviderHub';
import { UsageDashboard } from '../usage/UsageDashboard';
import { LogsTab, UpdateTab } from './DiagnosticsTabs';
import { McpTab } from './McpTab';
import { DatabaseTab } from './DatabaseTab';
import { AccountTab } from './AccountTab';
import { ProjectTab } from './ProjectTab';
import { useEscapeToClose } from '../../lib/use-escape';
import { formatRelativeTime, formatDuration } from '../../lib/format';

export type SettingsTabId =
  | 'language'
  | 'providers'
  | 'permissions'
  | 'agent'
  | 'usage'
  | 'sessions'
  | 'mcp'
  | 'logs'
  | 'update'
  | 'database'
  | 'account'
  | 'project'
  | 'about';

type TabId = SettingsTabId;

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: TabId;
}

const SessionsTab: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation();
  const { projectPath } = useProject((s) => ({ projectPath: s.projectPath }));
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [audit, setAudit] = useState<ToolAuditEntry[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const resumeSession = useAgentStore((state) => state.resumeSession);

  const refresh = async () => {
    if (!window.electronAPI) return;
    const [sessionList, auditList] = await Promise.all([window.electronAPI.listSessions(), window.electronAPI.listToolAudit(40)]);
    setSessions(sessionList);
    setAudit(auditList);
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="space-y-5 select-text">
      <div>
        <h3 className="text-sm font-semibold text-d4-text">{t('sessions.title')}</h3>
        <p className="text-[11px] text-d4-dimmed mt-0.5">{t('sessions.subtitle')}</p>
      </div>

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
              <div key={entry.id} className="px-3 py-1.5 text-[11px] border-b border-d4-border/40 last:border-0 flex items-start justify-between gap-2">
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

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, initialTab = 'providers' }) => {
  const { t } = useTranslation();
  const { settings, updateSettings, setLanguage } = useSettingsStore();
  const { clearSession } = useAgentStore();
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  // The rail and the status bar open specific pages, so follow the request.
  useEffect(() => {
    if (isOpen) setActiveTab(initialTab);
  }, [isOpen, initialTab]);

  useEscapeToClose(isOpen, onClose);

  if (!isOpen || !settings) return null;

  const categories: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'account', label: t('auth.account'), icon: UserRound },
    { id: 'providers', label: t('settings.providers'), icon: Key },
    { id: 'usage', label: t('settings.budgets'), icon: DollarSign },
    { id: 'permissions', label: t('settings.permissions'), icon: Shield },
    { id: 'project', label: t('settings.project'), icon: FolderTree },
    { id: 'agent', label: t('settings.agentSettings'), icon: Cpu },
    { id: 'sessions', label: t('settings.sessions'), icon: History },
    { id: 'mcp', label: t('settings.mcp'), icon: Plug },
    { id: 'logs', label: t('settings.logs'), icon: ScrollText },
    { id: 'database', label: t('settings.database'), icon: Database },
    { id: 'update', label: t('settings.updates'), icon: RefreshCw },
    { id: 'language', label: t('settings.language'), icon: Globe },
    { id: 'about', label: t('settings.about'), icon: Info }
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center select-none text-xs">
      <div className="w-[920px] h-[640px] bg-d4-panel border border-d4-border rounded-lg shadow-2xl flex flex-col overflow-hidden animate-in fade-in duration-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-d4-border bg-d4-bg/50">
          <span className="font-semibold text-d4-text text-sm">{t('settings.title')}</span>
          <button onClick={onClose} className="text-d4-dimmed hover:text-d4-text rounded p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          <div className="w-52 bg-d4-bg border-r border-d4-border p-2 space-y-1 shrink-0">
            {categories.map((cat) => {
              const Icon = cat.icon;
              const isActive = activeTab === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveTab(cat.id)}
                  className={`w-full flex items-center space-x-2 px-3 py-2 rounded-sm transition-colors text-left ${
                    isActive ? 'bg-d4-surface text-d4-accent font-medium' : 'text-d4-muted hover:text-d4-text hover:bg-d4-surface/40'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex-1 p-5 overflow-y-auto">
            {activeTab === 'providers' && <ProviderHub />}
            {activeTab === 'usage' && <UsageDashboard />}
            {activeTab === 'sessions' && <SessionsTab onClose={onClose} />}

            {activeTab === 'permissions' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-d4-text">{t('settings.permissionMode')}</h3>
                  <p className="text-[11px] text-d4-dimmed mt-0.5">{t('settings.permissionHint')}</p>
                </div>
                <div className="space-y-2.5">
                  {(['safe', 'ask', 'full'] as PermissionMode[]).map((mode) => (
                    <label
                      key={mode}
                      onClick={() => {
                        updateSettings({ permissionMode: mode });
                        toast.info(t('settings.permissionChanged', { mode }));
                      }}
                      className={`block p-3 rounded border cursor-pointer transition-all ${
                        settings.permissionMode === mode
                          ? 'border-d4-accent bg-d4-accent/10 text-d4-text'
                          : 'border-d4-border bg-d4-surface text-d4-muted hover:border-d4-dimmed'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold capitalize text-xs">{mode}</span>
                        {settings.permissionMode === mode && <Check className="w-4 h-4 text-d4-accent" />}
                      </div>
                      <p className="text-[11px] text-d4-dimmed">
                        {mode === 'safe' && t('settings.permissionSafe')}
                        {mode === 'ask' && t('settings.permissionAsk')}
                        {mode === 'full' && t('settings.permissionFull')}
                      </p>
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-d4-dimmed leading-relaxed">{t('settings.guardrailNote')}</p>
              </div>
            )}

            {activeTab === 'agent' && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-d4-text">{t('settings.agentSettings')}</h3>
                <div className="space-y-2.5 max-w-lg">
                  <label className="flex items-center justify-between p-2.5 bg-d4-surface border border-d4-border rounded">
                    <span>{t('settings.autoRunTests')}</span>
                    <input
                      type="checkbox"
                      checked={settings.autoRunTests}
                      onChange={(e) => updateSettings({ autoRunTests: e.target.checked })}
                      className="accent-teal-500 w-4 h-4 cursor-pointer"
                    />
                  </label>
                  <label className="flex items-center justify-between p-2.5 bg-d4-surface border border-d4-border rounded">
                    <span>{t('settings.autoRunBuild')}</span>
                    <input
                      type="checkbox"
                      checked={settings.autoRunBuild}
                      onChange={(e) => updateSettings({ autoRunBuild: e.target.checked })}
                      className="accent-teal-500 w-4 h-4 cursor-pointer"
                    />
                  </label>
                  <label className="flex items-center justify-between p-2.5 bg-d4-surface border border-d4-border rounded">
                    <span>{t('settings.autoFallback')}</span>
                    <input
                      type="checkbox"
                      checked={settings.autoFallback}
                      onChange={(e) => updateSettings({ autoFallback: e.target.checked })}
                      className="accent-teal-500 w-4 h-4 cursor-pointer"
                    />
                  </label>

                  {[
                    { key: 'maxAgentSteps' as const, label: t('settings.maxAgentSteps'), step: 1 },
                    { key: 'toolTimeoutMs' as const, label: t('settings.toolTimeout'), step: 10000 },
                    { key: 'retryLimit' as const, label: t('settings.retryLimit'), step: 1 }
                  ].map((field) => (
                    <div
                      key={field.key}
                      className="p-2.5 bg-d4-surface border border-d4-border rounded flex items-center justify-between"
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
                    <span className="text-[11px] text-d4-muted">{t('settings.checkpointFrequency')}</span>
                    <div className="flex items-center space-x-1">
                      {(['write', 'task', 'off'] as const).map((freq) => (
                        <button
                          key={freq}
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
              </div>
            )}

            {activeTab === 'language' && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-d4-text">{t('settings.language')}</h3>
                <p className="text-d4-muted text-xs leading-relaxed">{t('settings.languageHint')}</p>
                <div className="space-y-2 max-w-sm pt-2">
                  {(['th', 'en'] as const).map((lang) => (
                    <label
                      key={lang}
                      onClick={() => setLanguage(lang)}
                      className={`flex items-center justify-between p-3 rounded border cursor-pointer transition-all ${
                        settings.language === lang
                          ? 'border-d4-accent bg-d4-accent/10 text-d4-text font-medium'
                          : 'border-d4-border bg-d4-surface text-d4-muted hover:border-d4-dimmed'
                      }`}
                    >
                      <span>{lang === 'th' ? t('settings.languageThai') : t('settings.languageEnglish')}</span>
                      {settings.language === lang && <Check className="w-4 h-4 text-d4-accent" />}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'mcp' && <McpTab />}
            {activeTab === 'logs' && <LogsTab />}
            {activeTab === 'database' && <DatabaseTab />}
            {activeTab === 'account' && <AccountTab />}
            {activeTab === 'project' && <ProjectTab />}
            {activeTab === 'update' && <UpdateTab />}

            {activeTab === 'about' && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-d4-text">{t('settings.about')}</h3>
                <div className="bg-d4-surface border border-d4-border rounded p-3 space-y-1.5 text-[11px] text-d4-muted">
                  <div className="text-d4-text font-semibold">D4IDE 1.0.0</div>
                  <p>{t('settings.aboutText')}</p>
                  <p className="text-d4-dimmed">{t('settings.privacyNote')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      clearSession();
                      toast.info(t('settings.sessionCleared'));
                    }}
                    className="px-3 py-1.5 border border-d4-border rounded text-[11px] text-d4-muted hover:text-d4-text"
                  >
                    {t('settings.clearSession')}
                  </button>

                  <button
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
