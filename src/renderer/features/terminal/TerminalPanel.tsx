import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Square, Terminal as TermIcon, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useProject } from '../../stores/projectStore';
import { terminalBus } from '../../lib/terminal-bus';
import { scrollbackFor } from '../../lib/device-profile';

interface TerminalTab {
  id: string;
  label: string;
  shell?: string;
}

let tabCounter = 0;
const createTab = (shell?: string, label = 'powershell'): TerminalTab => ({
  id: `term_${Date.now().toString(36)}_${++tabCounter}`,
  label,
  shell
});

/**
 * `bottom` is the dock under the editor; `fill` lets the same terminal live in
 * the side panel, where it has to stretch instead of claiming a fixed height.
 */
export const TerminalPanel: React.FC<{ onClose?: () => void; variant?: 'bottom' | 'fill' }> = ({
  onClose,
  variant = 'bottom'
}) => {
  const { t } = useTranslation();
  const { projectPath } = useProject((s) => ({ projectPath: s.projectPath }));
  const [tabs, setTabs] = useState<TerminalTab[]>(() => [createTab()]);
  const [activeId, setActiveId] = useState<string>(() => tabs[0].id);

  const hosts = useRef<Map<string, HTMLDivElement>>(new Map());
  const instances = useRef<Map<string, { term: XTerm; fit: FitAddon; cleanup: () => void }>>(new Map());

  const setHost = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) hosts.current.set(id, element);
    else hosts.current.delete(id);
  }, []);

  // Create an xterm instance for every tab that has a host but no terminal yet.
  useEffect(() => {
    if (!window.electronAPI) return;

    for (const tab of tabs) {
      if (instances.current.has(tab.id)) continue;
      const host = hosts.current.get(tab.id);
      if (!host) continue;

      const term = new XTerm({
        theme: {
          background: '#000000',
          foreground: '#F4F4F5',
          cursor: '#14B8A6',
          selectionBackground: 'rgba(20, 184, 166, 0.3)'
        },
        fontFamily: 'JetBrains Mono, Consolas, monospace',
        fontSize: 12,
        lineHeight: 1.2,
        cursorBlink: true,
        // History is the biggest per-terminal allocation in the renderer, and a
        // low-memory machine wants less of it, not a slower app.
        scrollback: scrollbackFor()
      });

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      try {
        fit.fit();
      } catch {
        // The panel may still be collapsed on first paint.
      }

      window.electronAPI.terminalCreate(tab.id, projectPath || '.', tab.shell);

      const onData = term.onData((data) => window.electronAPI.terminalWrite(tab.id, data));
      const onResize = term.onResize(({ cols, rows }) => window.electronAPI.terminalResize(tab.id, cols, rows));
      // One shared IPC subscription for every tab, and main is told this
      // terminal is on screen so it can skip the ones that are not.
      const unsubscribe = terminalBus.attach(tab.id, (data) => term.write(data));

      instances.current.set(tab.id, {
        term,
        fit,
        cleanup: () => {
          unsubscribe();
          onData.dispose();
          onResize.dispose();
          term.dispose();
        }
      });
    }
  }, [tabs, projectPath]);

  // Fit the active terminal whenever the layout or the active tab changes.
  useEffect(() => {
    const entry = instances.current.get(activeId);
    if (!entry) return;
    const timer = setTimeout(() => {
      try {
        entry.fit.fit();
        window.electronAPI?.terminalResize(activeId, entry.term.cols, entry.term.rows);
        entry.term.focus();
      } catch {
        // Ignore transient layout races while switching tabs.
      }
    }, 30);
    return () => clearTimeout(timer);
  }, [activeId, projectPath]);

  useEffect(() => {
    const onResize = () => {
      const entry = instances.current.get(activeId);
      try {
        entry?.fit.fit();
      } catch {
        // Ignore.
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [activeId]);

  useEffect(() => {
    const map = instances.current;
    return () => {
      for (const [, entry] of map) entry.cleanup();
      map.clear();
    };
  }, []);

  const addTab = () => {
    const next = createTab();
    setTabs((prev) => [...prev, next]);
    setActiveId(next.id);
  };

  const closeTab = (id: string) => {
    window.electronAPI?.terminalKill(id);
    instances.current.get(id)?.cleanup();
    instances.current.delete(id);
    hosts.current.delete(id);

    setTabs((prev) => {
      const remaining = prev.filter((tab) => tab.id !== id);
      if (remaining.length === 0) {
        const fresh = createTab();
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) setActiveId(remaining[remaining.length - 1].id);
      return remaining;
    });
  };

  return (
    <div
      className={`bg-d4-bg flex flex-col select-none ${
        variant === 'fill' ? 'flex-1 min-h-0' : 'h-56 border-t border-d4-border-subtle'
      }`}
    >
      <div className="flex items-center justify-between px-2 py-1 bg-d4-panel border-b border-d4-border-subtle text-xs">
        <div className="flex items-center space-x-1 overflow-x-auto">
          <TermIcon className="w-3.5 h-3.5 text-d4-accent mr-1 shrink-0" />
          {tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => setActiveId(tab.id)}
              className={`flex items-center space-x-1.5 px-2 py-0.5 rounded-sm cursor-pointer font-mono text-[11px] shrink-0 ${
                tab.id === activeId ? 'bg-d4-surface text-d4-text border border-d4-border' : 'text-d4-muted hover:text-d4-text'
              }`}
            >
              <span>{tab.label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="text-d4-dimmed hover:text-d4-text"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button onClick={addTab} className="p-1 text-d4-dimmed hover:text-d4-text shrink-0" title={t('terminal.newTab')}>
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => {
              // The shell may already be gone (a crashed or exited command leaves the
              // tab open), so the buffer says what happened either way and the tab's
              // own ✕ removes it.
              window.electronAPI?.terminalKill(activeId);
              const entry = instances.current.get(activeId);
              if (!entry) return;
              entry.term.writeln(`\r\n[${t('terminal.stopped')}]\r\n`);
              entry.fit.fit();
            }}
            title={t('terminal.stop')}
            className="p-1 hover:bg-d4-surface text-d4-dimmed hover:text-d4-error rounded transition-colors"
          >
            <Square className="w-3 h-3 fill-current" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              title={t('common.close')}
              className="p-1 hover:bg-d4-surface text-d4-dimmed hover:text-d4-text rounded transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            ref={(element) => setHost(tab.id, element)}
            className={`absolute inset-0 p-2 ${tab.id === activeId ? 'block' : 'hidden'}`}
          />
        ))}
      </div>
    </div>
  );
};
