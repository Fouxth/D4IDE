import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Bug,
  Database,
  Download,
  ExternalLink,
  FolderOpen,
  Info,
  Loader2,
  Minimize2,
  RefreshCw,
  RotateCcw,
  Stethoscope,
  Trash2
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from '../../stores/toastStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { LogChannel, LogLevel, LogRecord, UpdateStatus } from '../../../shared/types';
import { formatBytes, formatRelativeTime } from '../../lib/format';

const LEVEL_STYLES: Record<LogLevel, string> = {
  debug: 'text-d4-dimmed',
  info: 'text-d4-muted',
  warn: 'text-d4-warning',
  error: 'text-d4-error'
};

const CHANNELS: LogChannel[] = ['app', 'agent', 'provider', 'terminal'];

/**
 * Logs (spec §66): four separate streams, levels, search, and a one-click way to
 * hand the folder to someone else. Redaction happens in the main process — what
 * arrives here is already safe to copy.
 */
export const LogsTab: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettingsStore();
  const [records, setRecords] = useState<LogRecord[]>([]);
  const [channel, setChannel] = useState<LogChannel | 'all'>('all');
  const [level, setLevel] = useState<LogLevel | 'all'>('all');
  const [search, setSearch] = useState('');
  const [counts, setCounts] = useState<Record<LogLevel, number> | null>(null);

  const refresh = useCallback(async () => {
    if (!window.electronAPI) return;
    const [list, tally] = await Promise.all([
      window.electronAPI.readLogs({
        channel: channel === 'all' ? undefined : channel,
        level: level === 'all' ? undefined : level,
        search: search || undefined,
        limit: 300
      }),
      window.electronAPI.logCounts()
    ]);
    setRecords(list);
    setCounts(tally);
  }, [channel, level, search]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const levelChip = (value: LogLevel | 'all') => (
    <button
      key={value}
      onClick={() => setLevel(value)}
      className={`px-2 py-0.5 rounded-sm text-[10px] capitalize ${
        level === value ? 'bg-d4-accent/20 text-d4-accent' : 'text-d4-dimmed hover:text-d4-text'
      }`}
    >
      {value === 'all' ? t('logs.all') : value}
      {value !== 'all' && counts ? ` ${counts[value] ?? 0}` : ''}
    </button>
  );

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-d4-text">{t('settings.logs')}</h3>
        <p className="text-[11px] text-d4-dimmed mt-0.5">{t('logs.subtitle')}</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center bg-d4-panel border border-d4-border rounded-sm p-0.5">
          <button
            onClick={() => setChannel('all')}
            className={`px-2 py-0.5 rounded-sm text-[10px] ${
              channel === 'all' ? 'bg-d4-accent/20 text-d4-accent' : 'text-d4-dimmed hover:text-d4-text'
            }`}
          >
            {t('logs.all')}
          </button>
          {CHANNELS.map((entry) => (
            <button
              key={entry}
              onClick={() => setChannel(entry)}
              className={`px-2 py-0.5 rounded-sm text-[10px] capitalize ${
                channel === entry ? 'bg-d4-accent/20 text-d4-accent' : 'text-d4-dimmed hover:text-d4-text'
              }`}
            >
              {entry}
            </button>
          ))}
        </div>

        <div className="flex items-center bg-d4-panel border border-d4-border rounded-sm p-0.5">
          {levelChip('all')}
          {(['debug', 'info', 'warn', 'error'] as LogLevel[]).map((value) => levelChip(value))}
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('logs.search')}
          className="flex-1 min-w-[140px] px-2 py-1 bg-d4-surface border border-d4-border rounded-sm text-[11px] text-d4-text outline-none focus:border-d4-accent/60"
        />

        <button onClick={() => void refresh()} className="d4-chip" title={t('logs.refresh')}>
          <RefreshCw className="w-3 h-3" />
        </button>
        <button
          onClick={async () => {
            await window.electronAPI?.openLogDirectory();
          }}
          className="d4-chip"
          title={t('logs.openFolder')}
        >
          <FolderOpen className="w-3 h-3" />
        </button>
        <button
          onClick={async () => {
            await window.electronAPI?.clearLogs();
            toast.info(t('logs.cleared'));
            void refresh();
          }}
          className="d4-chip hover:text-d4-error"
          title={t('logs.clear')}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      <div className="bg-d4-surface border border-d4-border rounded p-2.5 flex items-center justify-between">
        <div className="text-[11px] text-d4-muted">{t('logs.level')}</div>
        <select
          value={settings?.logLevel || 'info'}
          onChange={async (e) => {
            const next = e.target.value as LogLevel;
            await window.electronAPI?.setLogLevel(next);
            await updateSettings({ logLevel: next });
          }}
          className="bg-d4-panel border border-d4-border rounded-sm text-[11px] px-2 py-1 text-d4-text outline-none"
        >
          {(['debug', 'info', 'warn', 'error'] as LogLevel[]).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>

      <div className="border border-d4-border rounded bg-d4-bg font-mono text-[10.5px] max-h-[340px] overflow-y-auto select-text">
        {records.length === 0 ? (
          <div className="p-6 text-center text-d4-dimmed font-sans text-[11px]">{t('logs.empty')}</div>
        ) : (
          records.map((record) => (
            <div key={record.id} className="flex gap-2 px-2.5 py-1 border-b border-d4-border-subtle last:border-0">
              <span className="text-d4-dimmed shrink-0">{new Date(record.timestamp).toLocaleTimeString()}</span>
              <span className={`shrink-0 w-11 uppercase ${LEVEL_STYLES[record.level]}`}>{record.level}</span>
              <span className="text-d4-dimmed shrink-0 w-16">{record.channel}</span>
              <span className="text-d4-text break-all">
                {record.message}
                {record.context ? <span className="text-d4-dimmed"> {JSON.stringify(record.context)}</span> : null}
              </span>
            </div>
          ))
        )}
      </div>

      <AppStorageSection />
    </div>
  );
};

/**
 * D4IDE's own storage, filed under diagnostics rather than under "Database".
 *
 * That tab is the *project's* database, which is what a user opening it wants to
 * know; the app's own SQLite file is an internal detail. The maintenance it
 * needs — verify, back up, compact — still belongs somewhere reachable, because
 * losing a backup button to a tidier layout would be a bad trade.
 */
const AppStorageSection: React.FC = () => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (kind: 'quick' | 'backup' | 'compact') => {
    if (!window.electronAPI || busy) return;
    setBusy(kind);
    try {
      if (kind === 'backup') {
        const file = await window.electronAPI.dbBackup();
        if (file) toast.success(t('database.backupDone'), file);
        else toast.error(t('database.backupFailed'));
      } else if (kind === 'compact') {
        const sizes = await window.electronAPI.dbVacuum();
        if (sizes) {
          toast.success(
            t('database.compactDone', { before: formatBytes(sizes.before), after: formatBytes(sizes.after) })
          );
        } else toast.error(t('database.unavailable'));
      } else {
        const result = await window.electronAPI.dbCheck(false);
        if (result.ok) toast.success(t('database.checkOk'));
        else toast.error(t('database.checkFailed'), result.problems[0]);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-d4-surface border border-d4-border rounded p-2.5 space-y-2">
      <div className="flex items-center space-x-2 text-[11px] text-d4-muted">
        <Database className="w-3.5 h-3.5" />
        <span>{t('logs.appStorage')}</span>
      </div>
      <div className="flex items-center space-x-2">
        <button
          onClick={() => run('quick')}
          disabled={!!busy}
          className="flex items-center space-x-1 px-2 py-1 bg-d4-panel border border-d4-border rounded text-[11px] text-d4-muted hover:text-d4-text disabled:opacity-50"
        >
          {busy === 'quick' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Stethoscope className="w-3 h-3" />}
          <span>{t('database.quickCheck')}</span>
        </button>
        <button
          onClick={() => run('backup')}
          disabled={!!busy}
          className="flex items-center space-x-1 px-2 py-1 bg-d4-panel border border-d4-border rounded text-[11px] text-d4-muted hover:text-d4-text disabled:opacity-50"
        >
          {busy === 'backup' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Archive className="w-3 h-3" />}
          <span>{t('database.backupNow')}</span>
        </button>
        <button
          onClick={() => run('compact')}
          disabled={!!busy}
          className="flex items-center space-x-1 px-2 py-1 bg-d4-panel border border-d4-border rounded text-[11px] text-d4-muted hover:text-d4-text disabled:opacity-50"
        >
          {busy === 'compact' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Minimize2 className="w-3 h-3" />}
          <span>{t('database.compact')}</span>
        </button>
      </div>
    </div>
  );
};

/**
 * Updates (spec §83). The state machine lives in the main process; this view
 * only reflects it and offers the two actions the user is allowed to take.
 */
export const UpdateTab: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!window.electronAPI) return;
    void window.electronAPI.getUpdateStatus().then(setStatus);
    const unsubscribe = window.electronAPI.onUpdateStatus(setStatus);
    return () => {
      unsubscribe();
    };
  }, []);

  const run = async (action: () => Promise<UpdateStatus>) => {
    setBusy(true);
    try {
      setStatus(await action());
    } finally {
      setBusy(false);
    }
  };

  const label: Record<UpdateStatus['state'], string> = {
    idle: t('update.upToDate'),
    checking: t('update.checking'),
    available: t('update.available', { version: status.version || '' }),
    downloading: t('update.downloading', { percent: status.percent ?? 0 }),
    ready: t('update.ready', { version: status.version || '' }),
    error: t('update.error'),
    unsupported: t('update.unsupported')
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-d4-text">{t('settings.updates')}</h3>
        <p className="text-[11px] text-d4-dimmed mt-0.5">{t('update.subtitle')}</p>
      </div>

      <div className="bg-d4-surface border border-d4-border rounded p-3 space-y-2 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="text-d4-text font-semibold">D4IDE 1.0.0</span>
          {status.state === 'checking' || status.state === 'downloading' ? (
            <RefreshCw className="w-3 h-3 animate-spin text-d4-accent" />
          ) : null}
        </div>
        <div className={status.state === 'error' ? 'text-d4-error' : 'text-d4-muted'}>
          {label[status.state]}
          {status.error && status.state === 'error' ? <span className="block text-d4-dimmed">{status.error}</span> : null}
        </div>
        {status.checkedAt ? (
          <div className="text-d4-dimmed">
            {t('update.lastChecked', { time: formatRelativeTime(status.checkedAt) })}
          </div>
        ) : null}
        {status.notes ? <div className="text-d4-muted border-l-2 border-d4-border pl-2">{status.notes}</div> : null}
      </div>

      <div className="flex items-center gap-2">
        <button
          disabled={busy}
          onClick={() => void run(() => window.electronAPI!.checkForUpdates())}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-d4-surface border border-d4-border text-[11px] text-d4-text hover:bg-d4-subtle disabled:opacity-40"
        >
          <RefreshCw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} />
          {t('update.check')}
        </button>

        {status.state === 'available' && (
          <button
            disabled={busy}
            onClick={() => void run(() => window.electronAPI!.downloadUpdate())}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-d4-accent text-black text-[11px] font-medium disabled:opacity-40"
          >
            <Download className="w-3 h-3" />
            {t('update.download')}
          </button>
        )}

        {status.state === 'ready' && (
          <button
            disabled={busy}
            onClick={() => void run(() => window.electronAPI!.installUpdate())}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-d4-accent text-black text-[11px] font-medium disabled:opacity-40"
          >
            <RotateCcw className="w-3 h-3" />
            {t('update.install')}
          </button>
        )}
      </div>

      {status.state === 'unsupported' && (
        <div className="flex items-start gap-2 text-[11px] text-d4-dimmed">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <p>{t('update.unsupportedHint')}</p>
        </div>
      )}

      {status.state === 'error' && (
        <div className="flex items-start gap-2 text-[11px] text-d4-warning">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <p>{t('update.errorHint')}</p>
        </div>
      )}

      <div className="flex items-center gap-2 text-[10px] text-d4-dimmed">
        <Bug className="w-3 h-3" />
        <span>{t('update.logsHint')}</span>
        <button onClick={() => window.electronAPI?.openLogDirectory()} className="text-d4-accent hover:underline">
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
