import React from 'react';
import { Minus, Square, X, Folder, Bot, Code2 } from 'lucide-react';
import { useProjectStore } from '../stores/projectStore';
import { useTranslation } from 'react-i18next';
import { WorkspaceMode } from '../../shared/types';

interface TitleBarProps {
  workspaceMode: WorkspaceMode;
  onToggleMode: (mode: WorkspaceMode) => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({ workspaceMode, onToggleMode }) => {
  const { projectPath } = useProjectStore();
  const { t } = useTranslation();

  const handleMinimize = () => window.electronAPI?.minimize();
  const handleMaximize = () => window.electronAPI?.maximize();
  const handleClose = () => window.electronAPI?.close();

  const projectName = projectPath ? projectPath.split(/[/\\]/).pop() : null;

  return (
    <header className="h-10 bg-d4-bg border-b border-d4-border flex items-center justify-between px-3 select-none z-50 text-xs text-d4-muted" style={{ WebkitAppRegion: 'drag' } as any}>
      {/* Left: Brand & Mode Toggle */}
      <div className="flex items-center space-x-3" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <div className="flex items-center space-x-2">
          <div className="w-5 h-5 rounded bg-gradient-to-tr from-teal-500 to-emerald-400 flex items-center justify-center text-[10px] font-bold text-black shadow-sm">
            D4
          </div>
          <span className="font-semibold text-d4-text tracking-wide">D4IDE</span>
        </div>

        {/* Mode switcher: Agent vs Code */}
        <div className="flex items-center bg-d4-panel border border-d4-border rounded-sm p-0.5 text-[11px]">
          <button
            onClick={() => onToggleMode('agent')}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-sm transition-all ${
              workspaceMode === 'agent'
                ? 'bg-d4-accent/20 text-d4-accent font-medium'
                : 'text-d4-muted hover:text-d4-text'
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            <span>{t('nav.agentView')}</span>
          </button>
          <button
            onClick={() => onToggleMode('code')}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-sm transition-all ${
              workspaceMode === 'code'
                ? 'bg-d4-accent/20 text-d4-accent font-medium'
                : 'text-d4-muted hover:text-d4-text'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>{t('nav.codeView')}</span>
          </button>
        </div>
      </div>

      {/* Center: Current Project */}
      <div className="flex items-center space-x-2 text-d4-dimmed text-[11px] truncate max-w-md">
        <Folder className="w-3.5 h-3.5 text-d4-muted" />
        <span className="text-d4-muted font-medium">{projectName || 'No Project Opened'}</span>
        {projectPath && <span className="opacity-40">({projectPath})</span>}
      </div>

      {/* Right: Window Controls */}
      <div className="flex items-center space-x-1" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <button
          onClick={handleMinimize}
          className="w-7 h-7 flex items-center justify-center hover:bg-d4-panel text-d4-muted hover:text-d4-text rounded transition-colors"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleMaximize}
          className="w-7 h-7 flex items-center justify-center hover:bg-d4-panel text-d4-muted hover:text-d4-text rounded transition-colors"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={handleClose}
          className="w-7 h-7 flex items-center justify-center hover:bg-red-500/80 text-d4-muted hover:text-white rounded transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
