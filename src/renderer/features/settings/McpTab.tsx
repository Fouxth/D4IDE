import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Square, RefreshCw, Server, Globe, Terminal, AlertTriangle, Check } from 'lucide-react';
import { McpServerConfig } from '../../../shared/types';
import { useProject } from '../../stores/projectStore';
import { toast } from '../../stores/toastStore';

interface McpToolSummary {
  serverId: string;
  serverName: string;
  tools: { name: string; description?: string }[];
}

/**
 * MCP servers (spec §42).
 *
 * Servers are declared in `.d4ide/mcp.json` rather than in this dialog, because
 * the file is part of the project and belongs in version control. What the page
 * adds is what the file cannot express: whether the server is actually running,
 * what it announced, and the reason it refused to start.
 */
export const McpTab: React.FC = () => {
  const { t } = useTranslation();
  const { projectPath } = useProject((s) => ({ projectPath: s.projectPath }));
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [discovered, setDiscovered] = useState<McpToolSummary[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = async () => {
    if (!window.electronAPI) return;
    const [list, tools] = await Promise.all([
      window.electronAPI.listMcp(projectPath ?? undefined),
      window.electronAPI.discoveredMcpTools()
    ]);
    setServers(list as McpServerConfig[]);
    setDiscovered(tools as McpToolSummary[]);
  };

  useEffect(() => {
    refresh();
  }, [projectPath]);

  const start = async (server: McpServerConfig) => {
    if (!window.electronAPI) return;
    setBusyId(server.id);
    try {
      const result = await window.electronAPI.startMcp(server, projectPath ?? undefined);
      if (result.success) {
        toast.success(t('mcp.connected', { name: server.name }), t('mcp.toolCount', { count: result.tools?.length ?? 0 }));
      } else {
        toast.error(t('mcp.connectFailed', { name: server.name }), result.error);
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const stop = async (server: McpServerConfig) => {
    if (!window.electronAPI) return;
    setBusyId(server.id);
    try {
      await window.electronAPI.stopMcp(server.id);
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const refreshTools = async (server: McpServerConfig) => {
    if (!window.electronAPI) return;
    setBusyId(server.id);
    try {
      const result = await window.electronAPI.refreshMcpTools(server.id);
      toast.info(t('mcp.toolsRefreshed', { name: server.name }), t('mcp.toolCount', { count: result.tools ?? 0 }));
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const toolsFor = (serverId: string) => discovered.find((entry) => entry.serverId === serverId)?.tools ?? [];

  const statusStyle = (status: McpServerConfig['status']) =>
    status === 'connected'
      ? 'border-emerald-500/30 text-emerald-400'
      : status === 'error'
        ? 'border-red-500/30 text-red-400'
        : status === 'connecting'
          ? 'border-amber-500/30 text-amber-400'
          : 'border-d4-border text-d4-muted';

  return (
    <div className="space-y-4 select-text">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-d4-text">{t('mcp.title')}</h3>
          <p className="text-[11px] text-d4-dimmed mt-0.5 leading-relaxed">{t('mcp.subtitle')}</p>
        </div>
        <button onClick={refresh} className="d4-chip shrink-0" title={t('mcp.refresh')}>
          <RefreshCw className="w-3 h-3" />
          <span>{t('mcp.refresh')}</span>
        </button>
      </div>

      <div className="text-[11px] bg-d4-surface border border-d4-border rounded p-3 leading-relaxed">
        <div className="text-d4-muted">{t('mcp.configPath')}</div>
        <code className="block mt-1 font-mono text-[10px] text-d4-dimmed break-all">
          {projectPath ? `${projectPath}\\.d4ide\\mcp.json` : t('mcp.noProject')}
        </code>
        <pre className="mt-2 font-mono text-[10px] text-d4-dimmed whitespace-pre-wrap">{`{
  "servers": [
    { "id": "fs", "name": "filesystem", "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] },
    { "id": "remote", "name": "remote", "transport": "http",
      "url": "https://example.com/mcp",
      "headers": { "authorization": "Bearer <token>" } }
  ]
}`}</pre>
      </div>

      {servers.length === 0 ? (
        <div className="text-center py-8 text-d4-dimmed text-xs">{t('mcp.empty')}</div>
      ) : (
        <div className="space-y-2">
          {servers.map((server) => {
            const tools = toolsFor(server.id);
            const isBusy = busyId === server.id;
            return (
              <div key={server.id} className="bg-d4-surface border border-d4-border rounded p-2.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {server.transport === 'http' ? (
                        <Globe className="w-3.5 h-3.5 text-d4-accent shrink-0" />
                      ) : (
                        <Terminal className="w-3.5 h-3.5 text-d4-accent shrink-0" />
                      )}
                      <span className="text-xs text-d4-text truncate">{server.name}</span>
                      <span className="text-[10px] font-mono text-d4-dimmed">
                        {server.transport === 'http' ? server.url : `${server.command} ${(server.args ?? []).join(' ')}`}
                      </span>
                    </div>
                    {server.error && (
                      <div className="flex items-start gap-1 mt-1 text-[10px] text-red-400">
                        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                        <span className="break-all">{server.error}</span>
                      </div>
                    )}
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${statusStyle(server.status)}`}>
                    {t(`mcp.status_${server.status}`, server.status)}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-d4-border/40">
                  <div className="flex items-center gap-1.5 text-[10px] text-d4-dimmed min-w-0">
                    <Server className="w-3 h-3 shrink-0" />
                    {tools.length ? (
                      <span className="truncate">
                        {t('mcp.toolCount', { count: tools.length })}
                        {': '}
                        <span className="font-mono">{tools.slice(0, 4).map((tool) => tool.name).join(', ')}</span>
                        {tools.length > 4 && <span>…</span>}
                      </span>
                    ) : (
                      <span>{t('mcp.noTools')}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {server.status === 'connected' && (
                      <button
                        onClick={() => refreshTools(server)}
                        disabled={isBusy}
                        className="flex items-center gap-1 text-d4-muted hover:text-d4-text disabled:opacity-40"
                      >
                        <RefreshCw className={`w-3 h-3 ${isBusy ? 'animate-spin' : ''}`} />
                        <span>{t('mcp.reloadTools')}</span>
                      </button>
                    )}
                    {server.status === 'connected' ? (
                      <button
                        onClick={() => stop(server)}
                        disabled={isBusy}
                        className="flex items-center gap-1 text-d4-muted hover:text-d4-text disabled:opacity-40"
                      >
                        <Square className="w-3 h-3" />
                        <span>{t('mcp.stop')}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => start(server)}
                        disabled={isBusy}
                        className="flex items-center gap-1 text-d4-accent hover:underline disabled:opacity-40"
                      >
                        {isBusy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                        <span>{t('mcp.start')}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-d4-dimmed leading-relaxed flex items-start gap-1.5">
        <Check className="w-3.5 h-3.5 text-d4-success mt-0.5 shrink-0" />
        <span>{t('mcp.gateNote')}</span>
      </p>
    </div>
  );
};

export default McpTab;
