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
  Check,
  Minimize2,
  Package,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Stethoscope,
  Trash2
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from '../../stores/toastStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { currentVersion, useUpdateStore } from '../../stores/updateStore';
import { useCatalogStore } from '../../stores/catalogStore';
import { useAgentStore } from '../../stores/agentStore';
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
 * Updates (spec §83).
 *
 * Two steps, shown as two steps, because they are not the same decision:
 * fetching a build changes nothing on this machine, while installing closes the
 * app. The state machine and the check schedule live in the main process; this
 * view reflects them, and every action on it is a button the user pressed.
 */
export const UpdateTab: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettingsStore();
  const { status, busy, check, download, install } = useUpdateStore();
  const {
    status: catalog,
    busy: catalogBusy,
    check: catalogCheck,
    apply: catalogApply,
    discard: catalogDiscard,
    undo: catalogUndo
  } = useCatalogStore();
  const { status: agentStatus } = useAgentStore();

  const agentBusy = agentStatus === 'running' || agentStatus === 'planning' || agentStatus === 'waiting_approval';
  const checking = status.state === 'checking' || status.state === 'downloading';
  const autoCheck = settings?.updateCheckEnabled !== false;
  const autoCatalog = settings?.catalogCheckEnabled !== false;
  const skippedVersion = settings?.skippedUpdateVersion || '';
  const catalogDiff = catalog.diff;
  const catalogChanged = catalogDiff
    ? catalogDiff.providers.filter((provider) => provider.added.length > 0 || provider.changed.length > 0)
    : [];

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

      <div className="flex items-start gap-2 rounded border border-d4-border bg-d4-surface p-2 text-[11px] text-d4-muted">
        <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-d4-accent" />
        <p>{t('update.detectionOnly')}</p>
      </div>

      <div className="bg-d4-surface border border-d4-border rounded p-3 space-y-2 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="text-d4-text font-semibold">
            D4IDE {currentVersion}
          </span>
          {status.version && (status.state === 'available' || status.state === 'ready') ? (
            <span className={status.state === 'ready' ? 'text-d4-success font-semibold' : 'text-d4-accent font-semibold'}>
              → {status.version}
            </span>
          ) : null}
          {checking ? <RefreshCw className="w-3 h-3 animate-spin text-d4-accent" /> : null}
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
        {status.notes ? (
          <div className="space-y-1">
            <div className="text-d4-dimmed">{t('update.notesTitle')}</div>
            <div className="text-d4-muted border-l-2 border-d4-border pl-2 whitespace-pre-wrap max-h-40 overflow-auto">
              {status.notes}
            </div>
          </div>
        ) : null}
      </div>

      {/* Step one: fetch it. Step two: let it close the app. */}
      <div className="space-y-2">
        <div className="rounded border border-d4-border bg-d4-surface p-3 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-d4-text font-medium">
              <Download className="w-3.5 h-3.5 text-d4-accent" />
              {t('update.step1')}
            </div>
            {status.state === 'available' ? (
              <button
                disabled={busy}
                onClick={() => void download()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-d4-accent text-black text-[11px] font-medium disabled:opacity-40"
              >
                <Download className="w-3 h-3" />
                {t('update.download')}
              </button>
            ) : status.state === 'downloading' ? (
              <span className="font-mono text-d4-accent">{status.percent ?? 0}%</span>
            ) : status.state === 'ready' ? (
              <span className="flex items-center gap-1 text-d4-success">
                <Check className="w-3 h-3" />
                {t('update.readyToInstall')}
              </span>
            ) : (
              <span className="text-d4-dimmed">—</span>
            )}
          </div>
          <p className="mt-1 text-d4-dimmed">{t('update.step1HintLong')}</p>
          {status.state === 'downloading' ? (
            <div className="mt-2 h-1 rounded-full bg-d4-border overflow-hidden">
              <div
                className="h-full bg-d4-accent transition-[width] duration-300"
                style={{ width: `${Math.min(100, Math.max(0, status.percent ?? 0))}%` }}
              />
            </div>
          ) : null}
        </div>

        <div className="rounded border border-d4-border bg-d4-surface p-3 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-d4-text font-medium">
              <RotateCcw className="w-3.5 h-3.5 text-d4-accent" />
              {t('update.step2')}
            </div>
            <button
              disabled={busy || agentBusy || status.state !== 'ready'}
              title={agentBusy ? t('update.agentBusy') : t('update.step2HintLong')}
              onClick={() => void install()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-d4-accent text-black text-[11px] font-medium disabled:opacity-40"
            >
              <RotateCcw className="w-3 h-3" />
              {t('update.install')}
            </button>
          </div>
          <p className="mt-1 text-d4-dimmed">{t('update.step2HintLong')}</p>
          {status.state === 'ready' ? (
            <p className={`mt-1 ${agentBusy ? 'text-d4-warning' : 'text-d4-muted'}`}>
              {agentBusy ? t('update.agentBusy') : t('update.downloadedNote', { version: status.version || '' })}
            </p>
          ) : null}
        </div>
      </div>

      {/* Detection settings. There is deliberately no "download automatically":
          the rule this whole screen states is that nothing happens without a
          click, and a switch to the contrary would make that a lie. */}
      <div className="space-y-2 rounded border border-d4-border bg-d4-surface p-3 text-[11px]">
        <label className="flex items-center gap-2 text-d4-muted">
          <input
            type="checkbox"
            checked={autoCheck}
            onChange={(e) => updateSettings({ updateCheckEnabled: e.target.checked })}
            className="accent-d4-accent"
          />
          {t('update.autoCheck')}
        </label>
        <p className="text-d4-dimmed">{t('update.autoCheckHint')}</p>

        {autoCheck ? (
          <div className="space-y-2 pl-6">
            <label className="flex items-center gap-2 text-d4-muted">
              <input
                type="checkbox"
                checked={settings?.checkUpdatesOnLaunch !== false}
                onChange={(e) => updateSettings({ checkUpdatesOnLaunch: e.target.checked })}
                className="accent-d4-accent"
              />
              {t('update.checkOnLaunch')}
            </label>
            <p className="text-d4-dimmed">{t('update.checkOnLaunchHint')}</p>
            <label className="flex items-center gap-2 text-d4-muted">
              <span>{t('update.intervalLabel')}</span>
              <select
                value={settings?.updateCheckIntervalHours ?? 6}
                onChange={(e) => updateSettings({ updateCheckIntervalHours: Number(e.target.value) })}
                className="bg-d4-bg border border-d4-border rounded-sm px-1.5 py-0.5 text-[11px] text-d4-text"
              >
                {[1, 6, 12, 24].map((hours) => (
                  <option key={hours} value={hours}>
                    {t('update.hours', { count: hours })}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <div>
          <button
            disabled={busy}
            onClick={() => void check()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-d4-surface border border-d4-border text-[11px] text-d4-text hover:bg-d4-subtle disabled:opacity-40"
          >
            <RefreshCw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} />
            {t('update.check')}
          </button>
        </div>
      </div>

      {/* The same rule as the updater, applied to what the providers serve:
          ask, stage the difference, wait for a click. */}
      <div className="space-y-2 rounded border border-d4-border bg-d4-surface p-3 text-[11px]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-d4-text font-medium">
            <Package className="w-3.5 h-3.5 text-d4-accent" />
            {t('catalog.title')}
          </div>
          <div className="flex items-center gap-1.5">
            {catalog.state === 'changes' ? (
              <>
                <button
                  disabled={catalogBusy}
                  onClick={() => void catalogApply()}
                  className="px-3 py-1.5 rounded-sm bg-d4-accent text-black text-[11px] font-medium disabled:opacity-40"
                >
                  {t('catalog.apply')}
                </button>
                <button
                  disabled={catalogBusy}
                  onClick={() => void catalogDiscard()}
                  className="px-2 py-1.5 rounded-sm border border-d4-border text-d4-muted hover:text-d4-text disabled:opacity-40"
                >
                  {t('catalog.discard')}
                </button>
              </>
            ) : (
              <button
                disabled={catalogBusy}
                onClick={() => void catalogCheck()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-d4-surface border border-d4-border text-[11px] text-d4-text hover:bg-d4-subtle disabled:opacity-40"
              >
                <RefreshCw className={`w-3 h-3 ${catalogBusy || catalog.state === 'checking' ? 'animate-spin' : ''}`} />
                {t('catalog.checkNow')}
              </button>
            )}
            {catalog.undoAvailable ? (
              <button
                disabled={catalogBusy}
                onClick={() => void catalogUndo()}
                title={t('catalog.undoHint')}
                className="px-2 py-1.5 rounded-sm border border-d4-border text-d4-muted hover:text-d4-text disabled:opacity-40"
              >
                {t('catalog.undo')}
              </button>
            ) : null}
          </div>
        </div>
        <p className="text-d4-dimmed">{t('catalog.subtitle')}</p>

        {catalogDiff ? (
          <div className="space-y-1 border-t border-d4-border pt-2">
            <div className="flex items-center gap-3 text-d4-muted">
              <span>{t('catalog.added', { n: catalogDiff.totals.added })}</span>
              <span>{t('catalog.changed', { n: catalogDiff.totals.changed })}</span>
              {catalogDiff.totals.kept > 0 ? (
                <span className="text-d4-dimmed">{t('catalog.kept', { n: catalogDiff.totals.kept })}</span>
              ) : null}
            </div>

            {catalogChanged.length > 0 ? (
              <ul className="space-y-0.5">
                {catalogChanged.map((provider) => (
                  <li key={provider.providerId} className="text-d4-dimmed">
                    <span className="text-d4-muted">{provider.providerName}</span>
                    {provider.added.length > 0 ? ` · ${t('catalog.added', { n: provider.added.length })}` : ''}
                    {provider.changed.length > 0 ? ` · ${t('catalog.changed', { n: provider.changed.length })}` : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-d4-dimmed">{t('catalog.nothingNew')}</div>
            )}

            {catalogDiff.failures.length > 0 ? (
              <div className="text-d4-warning">{t('catalog.failed', { n: catalogDiff.failures.length })}</div>
            ) : null}
            <div className="text-d4-dimmed">
              {t('catalog.lastChecked', { time: formatRelativeTime(catalogDiff.checkedAt) })}
            </div>
          </div>
        ) : catalog.checkedAt ? (
          <div className="text-d4-dimmed">
            {t('catalog.lastChecked', { time: formatRelativeTime(catalog.checkedAt) })}
          </div>
        ) : null}

        {catalog.state === 'error' && catalog.error ? (
          <div className="text-d4-error">{catalog.error}</div>
        ) : null}

        <label className="flex items-center gap-2 text-d4-muted">
          <input
            type="checkbox"
            checked={autoCatalog}
            onChange={(e) => updateSettings({ catalogCheckEnabled: e.target.checked })}
            className="accent-d4-accent"
          />
          {t('catalog.autoCheck')}
        </label>
        {autoCatalog ? (
          <label className="flex items-center gap-2 pl-6 text-d4-muted">
            <span>{t('update.intervalLabel')}</span>
            <select
              value={settings?.catalogCheckIntervalHours ?? 24}
              onChange={(e) => updateSettings({ catalogCheckIntervalHours: Number(e.target.value) })}
              className="bg-d4-bg border border-d4-border rounded-sm px-1.5 py-0.5 text-[11px] text-d4-text"
            >
              {[6, 12, 24, 72].map((hours) => (
                <option key={hours} value={hours}>
                  {t('update.hours', { count: hours })}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {skippedVersion ? (
        <div className="flex items-center justify-between gap-2 rounded border border-d4-border bg-d4-surface p-2 text-[11px]">
          <span className="text-d4-dimmed">
            {t('update.skipManage')}: <span className="text-d4-muted font-mono">{skippedVersion}</span>
          </span>
          <button
            onClick={() => {
              // Saying "tell me about it again" is a request to look, so look.
              void updateSettings({ skippedUpdateVersion: '' }).then(() => check());
            }}
            className="px-2 py-1 rounded-sm border border-d4-border text-d4-muted hover:text-d4-text"
          >
            {t('update.unskip')}
          </button>
        </div>
      ) : null}

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
