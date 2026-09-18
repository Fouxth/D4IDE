import React, { useState } from 'react';
import { Folder, FolderOpen, File, ChevronRight, ChevronDown, RefreshCw, PanelLeftClose } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useProject } from '../../stores/projectStore';
import { FileNode } from '../../../shared/types';

interface FileTreeItemProps {
  node: FileNode;
  depth: number;
}

const FileTreeItem: React.FC<FileTreeItemProps> = ({ node, depth }) => {
  const [isOpen, setIsOpen] = useState(depth === 0);
  const { openFile, activeFilePath } = useProject((s) => ({
    openFile: s.openFile,
    activeFilePath: s.activeFilePath
  }));

  const isSelected = activeFilePath === node.path;

  const handleClick = () => {
    if (node.isDirectory) {
      setIsOpen(!isOpen);
    } else {
      openFile(node.path);
    }
  };

  return (
    <div>
      <div
        onClick={handleClick}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className={`flex items-center space-x-1.5 py-1 pr-2 cursor-pointer text-xs rounded transition-colors ${
          isSelected ? 'bg-d4-accent/20 text-d4-accent font-medium' : 'text-d4-muted hover:text-d4-text hover:bg-d4-surface'
        }`}
      >
        {node.isDirectory ? (
          <>
            {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-d4-dimmed" /> : <ChevronRight className="w-3.5 h-3.5 text-d4-dimmed" />}
            {isOpen ? <FolderOpen className="w-4 h-4 text-teal-400/80" /> : <Folder className="w-4 h-4 text-teal-400/80" />}
          </>
        ) : (
          <>
            <span className="w-3.5" />
            <File className="w-3.5 h-3.5 text-d4-dimmed" />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </div>

      {node.isDirectory && isOpen && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeItem key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

interface FileExplorerProps {
  /** Width comes from the shell so the drag handle next to it can resize it (§60). */
  width?: number;
  onClose?: () => void;
}

export const FileExplorer: React.FC<FileExplorerProps> = ({ width = 240, onClose }) => {
  const { fileTree, loadProjectTree, projectPath } = useProject((s) => ({
    fileTree: s.fileTree,
    loadProjectTree: s.loadProjectTree,
    projectPath: s.projectPath
  }));
  const { t } = useTranslation();

  return (
    <div
      style={{ width }}
      className="shrink-0 bg-d4-panel border-r border-d4-border flex flex-col h-full select-none text-xs"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-d4-border bg-d4-bg/40">
        <span className="text-[11px] font-semibold uppercase text-d4-dimmed tracking-wider">
          {t('explorer.title')}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={loadProjectTree}
            className="p-1 text-d4-dimmed hover:text-d4-text rounded transition-colors"
            title={t('explorer.refresh')}
            aria-label={t('explorer.refresh')}
          >
            <RefreshCw className="w-3 h-3" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 text-d4-dimmed hover:text-d4-text rounded transition-colors"
              title={t('panel.hide')}
              aria-label={t('panel.hide')}
            >
              <PanelLeftClose className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {fileTree ? (
          <FileTreeItem node={fileTree} depth={0} />
        ) : (
          <div className="p-4 text-center text-d4-dimmed text-xs">
            {projectPath ? t('explorer.loading') : t('explorer.noFolder')}
          </div>
        )}
      </div>
    </div>
  );
};
