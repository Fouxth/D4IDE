import React from 'react';
import { FolderOpen, Plus, Search, GitBranch, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../stores/projectStore';
import { useAgentStore } from '../stores/agentStore';

interface LeftNavProps {
  onOpenSettings: () => void;
  onOpenSearch: () => void;
}

export const LeftNav: React.FC<LeftNavProps> = ({ onOpenSettings, onOpenSearch }) => {
  const { t } = useTranslation();
  const { setProjectPath } = useProjectStore();
  const { clearSession } = useAgentStore();

  const handleOpenProject = async () => {
    if (!window.electronAPI) return;
    const dir = await window.electronAPI.openProjectDialog();
    if (dir) {
      setProjectPath(dir);
    }
  };

  return (
    <aside className="w-12 bg-d4-bg border-r border-d4-border flex flex-col items-center justify-between py-3 select-none z-40">
      {/* Top action icons */}
      <div className="flex flex-col items-center space-y-4">
        <button
          onClick={handleOpenProject}
          title={t('nav.projects')}
          className="w-8 h-8 flex items-center justify-center rounded-sm text-d4-muted hover:text-d4-text hover:bg-d4-surface transition-colors"
        >
          <FolderOpen className="w-4 h-4" />
        </button>

        <button
          onClick={clearSession}
          title={t('nav.newSession')}
          className="w-8 h-8 flex items-center justify-center rounded-sm text-d4-muted hover:text-d4-text hover:bg-d4-surface transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>

        <button
          onClick={onOpenSearch}
          title={t('nav.search')}
          className="w-8 h-8 flex items-center justify-center rounded-sm text-d4-muted hover:text-d4-text hover:bg-d4-surface transition-colors"
        >
          <Search className="w-4 h-4" />
        </button>

        <button
          title={t('nav.git')}
          className="w-8 h-8 flex items-center justify-center rounded-sm text-d4-muted hover:text-d4-text hover:bg-d4-surface transition-colors"
        >
          <GitBranch className="w-4 h-4" />
        </button>
      </div>

      {/* Bottom settings icon */}
      <div className="flex flex-col items-center space-y-3">
        <button
          onClick={onOpenSettings}
          title={t('nav.settings')}
          className="w-8 h-8 flex items-center justify-center rounded-sm text-d4-muted hover:text-d4-text hover:bg-d4-surface transition-colors"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
};
