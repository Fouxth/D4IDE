import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Square, Terminal as TermIcon, Plus, X } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';

export const TerminalPanel: React.FC = () => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<XTerm | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const { projectPath } = useProjectStore();

  const terminalId = 'default_term';

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      theme: {
        background: '#0B0D11',
        foreground: '#F1F5F9',
        cursor: '#14B8A6',
        selectionBackground: 'rgba(20, 184, 166, 0.3)'
      },
      fontFamily: 'JetBrains Mono, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(terminalRef.current);
    fit.fit();

    xtermInstance.current = term;
    fitAddon.current = fit;

    const cwd = projectPath || process.cwd();
    if (window.electronAPI) {
      window.electronAPI.terminalCreate(terminalId, cwd);

      // Handle user keystrokes
      term.onData((data) => {
        window.electronAPI.terminalWrite(terminalId, data);
      });

      // Handle terminal output from backend
      const unsubscribe = window.electronAPI.onTerminalData((payload) => {
        if (payload.id === terminalId) {
          term.write(payload.data);
        }
      });

      const handleResize = () => fit.fit();
      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
        unsubscribe();
        term.dispose();
      };
    }
  }, [projectPath]);

  const handleKill = () => {
    if (window.electronAPI) {
      window.electronAPI.terminalKill(terminalId);
      xtermInstance.current?.writeln('\r\n[Terminal stopped]\r\n');
    }
  };

  return (
    <div className="h-56 bg-d4-bg border-t border-d4-border flex flex-col select-none">
      {/* Terminal header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-d4-panel border-b border-d4-border text-xs">
        <div className="flex items-center space-x-2">
          <TermIcon className="w-3.5 h-3.5 text-d4-accent" />
          <span className="font-semibold text-d4-text font-mono text-[11px]">Terminal (PowerShell)</span>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleKill}
            title="Stop Process"
            className="p-1 hover:bg-d4-surface text-d4-dimmed hover:text-red-400 rounded transition-colors"
          >
            <Square className="w-3 h-3 fill-current" />
          </button>
        </div>
      </div>

      {/* XTerm mount */}
      <div ref={terminalRef} className="flex-1 p-2 overflow-hidden" />
    </div>
  );
};
