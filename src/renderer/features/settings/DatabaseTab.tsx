import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Database as DatabaseIcon,
  HardDrive,
  HelpCircle,
  RefreshCw,
  Server,
  Table2
} from 'lucide-react';
import { DatabaseEngine, ProjectDatabaseReport } from '../../../shared/types';
import { useProject } from '../../stores/projectStore';

/**
 * Settings → Database: the database *this project* uses.
 *
 * It used to show the app's own SQLite file, which tells the user nothing about
 * the work in front of them. What is useful here is the project's storage — is
 * this a PostgreSQL project, where is that configured, what is still missing —
 * and that answer exists in the project's files, so it is read rather than
 * asked for. The report is computed in the main process from a fixed list of
 * configuration files; see `src/main/project/database-detector.ts` for the
 * signals it recognises and why a connection URL never comes back with its
 * password.
 */
const ENGINE_LABELS: Record<DatabaseEngine, string> = {
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  mongodb: 'MongoDB',
  sqlite: 'SQLite',
  libsql: 'libSQL / Turso',
  redis: 'Redis',
  clickhouse: 'ClickHouse',
  dynamodb: 'DynamoDB',
  firestore: 'Firestore',
  mssql: 'SQL Server',
  oracle: 'Oracle',
  unknown: 'Unknown'
};

/** Brand colours, so a glance at the page identifies the engine. */
const ENGINE_COLORS: Partial<Record<DatabaseEngine, string>> = {
  postgresql: 'text-sky-400',
  mysql: 'text-orange-400',
  mariadb: 'text-teal-400',
  mongodb: 'text-emerald-400',
  sqlite: 'text-blue-300',
  libsql: 'text-cyan-400',
  redis: 'text-red-400',
  clickhouse: 'text-amber-300',
  dynamodb: 'text-indigo-400',
  firestore: 'text-yellow-400',
  mssql: 'text-rose-400',
  oracle: 'text-red-300',
  unknown: 'text-d4-dimmed'
};

const targetLine = (finding: ProjectDatabaseReport['databases'][number]): string | null => {
  const target = finding.target;
  if (!target) return null;
  const host = target.host ? (target.port ? `${target.host}:${target.port}` : target.host) : '';
  const db = target.database || '';
  const parts = [host, db].filter(Boolean);
  return parts.length ? parts.join(' / ') : null;
};

export const DatabaseTab: React.FC = () => {
  const { t } = useTranslation();
  const { projectPath } = useProject((s) => ({ projectPath: s.projectPath }));
  const [report, setReport] = useState<ProjectDatabaseReport | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!window.electronAPI) return;
    setBusy(true);
    try {
      const next = (await window.electronAPI.projectDatabase(projectPath || undefined)) as ProjectDatabaseReport | null;
      setReport(next ?? { scanned: [], databases: [], tooling: [] });
    } catch {
      setReport({ scanned: [], databases: [], tooling: [] });
    } finally {
      setBusy(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const projectName = projectPath ? projectPath.split(/[/\\]/).pop() : null;

  return (
    <div className="space-y-3 select-text">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-d4-text flex items-center space-x-1.5">
            <DatabaseIcon className="w-3.5 h-3.5 text-d4-accent" />
            <span>{t('projectDb.title')}</span>
          </h3>
          <p className="text-[11px] text-d4-dimmed mt-0.5">
            {projectName ? `${projectName} · ${t('projectDb.subtitle')}` : t('projectDb.subtitle')}
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          disabled={busy || !projectPath}
          className="flex items-center space-x-1 px-2 py-1 bg-d4-surface border border-d4-border rounded text-[11px] text-d4-muted hover:text-d4-text disabled:opacity-40"
        >
          <RefreshCw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} />
          <span>{t('projectDb.refresh')}</span>
        </button>
      </div>

      {!projectPath ? (
        <div className="text-center py-10 text-d4-dimmed text-xs">{t('projectDb.noProject')}</div>
      ) : !report ? (
        <div className="text-center py-10 text-d4-dimmed text-xs">{t('projectDb.checking')}</div>
      ) : report.databases.length === 0 ? (
        <div className="bg-d4-surface border border-d4-border rounded p-4 space-y-2">
          <div className="flex items-center space-x-1.5 text-xs text-d4-text">
            <HelpCircle className="w-3.5 h-3.5 text-d4-dimmed" />
            <span>{t('projectDb.none')}</span>
          </div>
          <p className="text-[11px] text-d4-dimmed leading-relaxed">{t('projectDb.noneHint')}</p>
          {report.tooling.length > 0 && (
            <p className="text-[11px] text-d4-muted">
              {t('projectDb.tooling', { list: report.tooling.join(', ') })}
            </p>
          )}
          <p className="text-[10px] text-d4-dimmed">{t('projectDb.scanned', { count: report.scanned.length })}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {report.databases.map((finding) => {
            const target = targetLine(finding);
            return (
              <div key={finding.engine} className="bg-d4-surface border border-d4-border rounded-md overflow-hidden">
                <div className="flex items-center justify-between px-3.5 py-2.5 gap-2">
                  <div className="flex items-center space-x-2.5 min-w-0">
                    {finding.kind === 'cache' ? (
                      <HardDrive className={`w-4 h-4 shrink-0 ${ENGINE_COLORS[finding.engine]}`} />
                    ) : (
                      <Table2 className={`w-4 h-4 shrink-0 ${ENGINE_COLORS[finding.engine]}`} />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-d4-text text-xs">{ENGINE_LABELS[finding.engine]}</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-sm ${
                            finding.kind === 'cache'
                              ? 'bg-d4-panel text-d4-muted'
                              : 'bg-d4-accent/15 text-d4-accent'
                          }`}
                        >
                          {t(finding.kind === 'cache' ? 'projectDb.kind.cache' : 'projectDb.kind.database')}
                        </span>
                      </div>
                      {target && (
                        <div className="text-[10px] text-d4-dimmed font-mono truncate mt-0.5">
                          <Server className="w-3 h-3 inline mr-1 -mt-0.5" />
                          {target}
                          {finding.target?.user && ` · ${t('projectDb.user', { user: finding.target.user })}`}
                        </div>
                      )}
                    </div>
                  </div>
                  {finding.clients.length > 0 && (
                    <span className="text-[10px] text-d4-dimmed font-mono shrink-0">
                      {finding.clients.join(', ')}
                    </span>
                  )}
                </div>

                <div className="border-t border-d4-border px-3.5 py-2 space-y-1">
                  <div className="text-[10px] text-d4-dimmed uppercase tracking-wide">{t('projectDb.evidence')}</div>
                  {finding.evidence.map((item) => (
                    <div key={`${item.file}:${item.detail}`} className="text-[11px] text-d4-muted flex space-x-2">
                      <span className="font-mono text-d4-dimmed shrink-0">{item.file}</span>
                      <span className="truncate">{item.detail}</span>
                    </div>
                  ))}
                </div>

                {finding.missingEnv.length > 0 && (
                  <div className="border-t border-amber-500/20 bg-amber-500/5 px-3.5 py-2 flex items-start space-x-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <div className="text-[11px] text-amber-300/90">
                      {t('projectDb.missingEnv', { list: finding.missingEnv.join(', ') })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {report.tooling.length > 0 && (
            <p className="text-[11px] text-d4-muted px-1">
              {t('projectDb.tooling', { list: report.tooling.join(', ') })}
            </p>
          )}
          <p className="text-[10px] text-d4-dimmed px-1">{t('projectDb.scanned', { count: report.scanned.length })}</p>
        </div>
      )}
    </div>
  );
};
