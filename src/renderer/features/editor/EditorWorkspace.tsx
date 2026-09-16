import React, { useEffect } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { X, Save, FileCode } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useChangesStore } from '../../stores/changesStore';

export const EditorWorkspace: React.FC = () => {
  const { openFiles, activeFilePath, activeFileContent, closeFile, setActiveFile, updateActiveContent, saveActiveFile } =
    useProjectStore();
  const { activeDiffFile, setActiveDiff } = useChangesStore();

  // Keyboard shortcut Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveActiveFile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveActiveFile]);

  // Determine file language from extension
  const getLanguage = (filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
        return 'typescript';
      case 'js':
      case 'jsx':
        return 'javascript';
      case 'json':
        return 'json';
      case 'html':
        return 'html';
      case 'css':
        return 'css';
      case 'md':
        return 'markdown';
      case 'py':
        return 'python';
      default:
        return 'plaintext';
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#1e1e1e] overflow-hidden select-none">
      {/* Tab bar */}
      <div className="flex items-center bg-d4-bg border-b border-d4-border overflow-x-auto text-xs">
        {activeDiffFile && (
          <div className="flex items-center space-x-2 px-3 py-1.5 bg-d4-panel border-r border-d4-border text-amber-400 font-medium">
            <span>Diff: {activeDiffFile.relativePath}</span>
            <button
              onClick={() => setActiveDiff(null)}
              className="text-d4-dimmed hover:text-d4-text p-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {openFiles.map((file) => {
          const isActive = activeFilePath === file.path && !activeDiffFile;
          return (
            <div
              key={file.path}
              onClick={() => {
                setActiveDiff(null);
                setActiveFile(file.path);
              }}
              className={`flex items-center space-x-2 px-3 py-1.5 border-r border-d4-border cursor-pointer transition-colors ${
                isActive ? 'bg-d4-surface text-d4-text font-medium border-t-2 border-t-d4-accent' : 'text-d4-muted hover:bg-d4-surface/50'
              }`}
            >
              <FileCode className="w-3.5 h-3.5 text-d4-dimmed" />
              <span className="truncate max-w-[150px]">{file.name}</span>
              {file.isDirty && <span className="w-2 h-2 rounded-full bg-d4-accent" />}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeFile(file.path);
                }}
                className="text-d4-dimmed hover:text-d4-text rounded p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Editor Area */}
      <div className="flex-1 overflow-hidden select-text">
        {activeDiffFile ? (
          <DiffEditor
            height="100%"
            language={getLanguage(activeDiffFile.path)}
            original={activeDiffFile.previousContent || ''}
            modified={activeDiffFile.newContent || ''}
            theme="vs-dark"
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: 'JetBrains Mono, Consolas, monospace'
            }}
          />
        ) : activeFilePath ? (
          <Editor
            height="100%"
            language={getLanguage(activeFilePath)}
            value={activeFileContent}
            onChange={(val) => updateActiveContent(val || '')}
            theme="vs-dark"
            options={{
              minimap: { enabled: true },
              fontSize: 13,
              fontFamily: 'JetBrains Mono, Consolas, monospace',
              tabSize: 2,
              wordWrap: 'on',
              automaticLayout: true
            }}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-d4-dimmed text-xs">
            <FileCode className="w-10 h-10 mb-2 text-d4-border" />
            <p>Select a file from the explorer to view or edit</p>
          </div>
        )}
      </div>
    </div>
  );
};
