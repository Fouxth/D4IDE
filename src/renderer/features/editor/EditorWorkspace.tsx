import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { X, FileCode, RefreshCw, AlertTriangle, Sparkles, Wand2, FlaskConical, MessageSquare, Loader2 } from 'lucide-react';
import { setupLocalMonaco } from '../../lib/monaco-setup';
import { minimapEnabled } from '../../lib/device-profile';
import { useTranslation } from 'react-i18next';
import { useProject } from '../../stores/projectStore';
import { useChangesStore } from '../../stores/changesStore';
import { useAgentStore } from '../../stores/agentStore';
import { useUiStore } from '../../stores/uiStore';
import { toast } from '../../stores/toastStore';

export const EditorWorkspace: React.FC = () => {
  const { t } = useTranslation();
  const {
    openFiles,
    activeFilePath,
    activeFileContent,
    closeFile,
    setActiveFile,
    updateActiveContent,
    saveActiveFile,
    externallyChanged,
    reloadFileFromDisk,
    clearExternalChange
  } = useProject((s) => ({
    openFiles: s.openFiles,
    activeFilePath: s.activeFilePath,
    activeFileContent: s.activeFileContent,
    closeFile: s.closeFile,
    setActiveFile: s.setActiveFile,
    updateActiveContent: s.updateActiveContent,
    saveActiveFile: s.saveActiveFile,
    externallyChanged: s.externallyChanged,
    reloadFileFromDisk: s.reloadFileFromDisk,
    clearExternalChange: s.clearExternalChange
  }));
  const { activeDiffFile, setActiveDiff } = useChangesStore();
  const startAgent = useAgentStore((state) => state.startAgent);
  const setWorkspaceMode = useUiStore((state) => state.setWorkspaceMode);
  const [selection, setSelection] = useState('');
  const editorRef = useRef<any>(null);

  /**
   * Monaco has to be loaded from the app bundle before an editor may mount.
   *
   * It used to be fetched from a CDN by the default loader, which the app's CSP
   * blocks — so every file sat on "Loading…" for ever with no error anywhere. An
   * editor that cannot load now says so, with a retry, instead of pretending to
   * be busy.
   */
  const [editorStatus, setEditorStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [editorError, setEditorError] = useState('');
  const [attempt, setAttempt] = useState(0);

  /**
   * Monaco is only fetched once there is actually something to show.
   *
   * This used to run on mount, so simply *switching to the code view* paid for
   * Monaco — a ~3 MB bundle plus its workers parsed and compiled before the user
   * had opened a single file, and on a low-memory machine that was a visible
   * stall at the exact moment they asked for the editor. With no file selected
   * the panel shows its placeholder, which needs none of it. The editor is still
   * only mounted for an open file or a diff, so this adds no delay to the case
   * that matters: the status effect and the editor's own mount wait on the same
   * shared promise.
   */
  const needsEditor = !!activeFilePath || !!activeDiffFile;

  useEffect(() => {
    if (!needsEditor) return;
    let alive = true;
    setEditorStatus('loading');
    setupLocalMonaco()
      .then(() => {
        if (alive) setEditorStatus('ready');
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setEditorStatus('failed');
        setEditorError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      alive = false;
    };
  }, [attempt, needsEditor]);

  // AI actions on the current selection (spec §4.2). The prompt carries the file,
  // the line range and the selected text, so the agent does not have to guess
  // what "this" means.
  const runInlineAction = useCallback(
    (kind: 'explain' | 'fix' | 'tests' | 'ask') => {
      if (!activeFilePath) return;
      const picked = selection.trim();
      const position = editorRef.current?.getPosition?.();
      const where = `${activeFilePath}${position ? `:${position.lineNumber}` : ''}`;

      const instruction = picked
        ? {
            explain: `Explain this code from ${where}. Focus on what it does, its inputs and outputs, and any non-obvious behaviour:\n\n\`\`\`\n${picked}\n\`\`\``,
            fix: `Find and fix the bug in this code from ${where}. Explain the root cause, then make the smallest correct change:\n\n\`\`\`\n${picked}\n\`\`\``,
            tests: `Write focused tests for this code from ${where}, matching the project's existing test conventions:\n\n\`\`\`\n${picked}\n\`\`\``,
            ask: `Read ${where}. Look at this selection and tell me what I should be careful about:\n\n\`\`\`\n${picked}\n\`\`\``
          }[kind]
        : `Look at ${where} and tell me what I should be careful about before changing it.`;

      // Show the user where the answer will appear.
      setWorkspaceMode('agent');
      void startAgent(instruction);
      toast.info(t('editor.sentToAgent'));
    },
    [activeFilePath, selection, setWorkspaceMode, startAgent, t]
  );

  // Is the file in the editor one that changed on disk behind our back?
  const activeFileChangedExternally = useMemo(() => {
    if (!activeFilePath) return false;
    const name = activeFilePath.split(/[/\\]/).pop() || activeFilePath;
    return externallyChanged.some((p) => p === activeFilePath || p.endsWith(`/${name}`) || p === name);
  }, [activeFilePath, externallyChanged]);

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

      {/* External change banner */}
      {activeFileChangedExternally && activeFilePath && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/30 text-[11px] text-amber-300">
          <span className="flex items-center space-x-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>{t('editor.externalChange')}</span>
          </span>
          <span className="flex items-center space-x-3">
            <button
              onClick={() => reloadFileFromDisk(activeFilePath, { force: true })}
              className="flex items-center space-x-1 text-d4-accent hover:underline"
            >
              <RefreshCw className="w-3 h-3" />
              <span>{t('editor.reload')}</span>
            </button>
            <button onClick={() => clearExternalChange(activeFilePath)} className="text-d4-muted hover:text-d4-text">
              {t('editor.keepCurrent')}
            </button>
          </span>
        </div>
      )}

      {/* Inline AI actions on the selection */}
      {activeFilePath && !activeDiffFile && (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-d4-bg border-b border-d4-border-subtle text-[10px] overflow-x-auto">
          <span className="flex items-center gap-1 text-d4-dimmed shrink-0">
            <Sparkles className="w-3 h-3 text-d4-accent" />
            {selection.trim()
              ? t('editor.selectionChars', { count: selection.trim().length })
              : t('editor.aiActions')}
          </span>
          <span className="flex-1" />
          <button onClick={() => runInlineAction('explain')} className="d4-chip shrink-0">
            <MessageSquare className="w-3 h-3" />
            {t('editor.explain')}
          </button>
          <button onClick={() => runInlineAction('fix')} className="d4-chip shrink-0">
            <Wand2 className="w-3 h-3" />
            {t('editor.fix')}
          </button>
          <button onClick={() => runInlineAction('tests')} className="d4-chip shrink-0">
            <FlaskConical className="w-3 h-3" />
            {t('editor.addTests')}
          </button>
        </div>
      )}

      {/* Editor Area */}
      <div className="flex-1 overflow-hidden select-text">
        {editorStatus === 'failed' ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 px-8 text-center">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
            <p className="text-xs text-d4-text">{t('editor.editorFailed')}</p>
            {editorError && (
              <p className="text-[10px] font-mono text-d4-dimmed max-w-md break-all">{editorError}</p>
            )}
            <button
              onClick={() => setAttempt((value) => value + 1)}
              className="mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-d4-accent text-black text-[11px] font-semibold"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {t('editor.retry')}
            </button>
          </div>
        ) : editorStatus === 'loading' && (activeFilePath || activeDiffFile) ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-d4-dimmed text-xs">
            <Loader2 className="w-5 h-5 animate-spin text-d4-accent" />
            <span>{t('editor.loadingEditor')}</span>
          </div>
        ) : activeDiffFile ? (
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
            loading={<div className="h-full flex items-center justify-center text-xs text-d4-dimmed">{t('editor.loadingEditor')}</div>}
            language={getLanguage(activeFilePath)}
            value={activeFileContent}
            onChange={(val) => updateActiveContent(val || '')}
            onMount={(editor) => {
              editorRef.current = editor;
              editor.onDidChangeCursorSelection(() => {
                const model = editor.getModel();
                const range = editor.getSelection();
                if (!model || !range || range.isEmpty()) {
                  setSelection('');
                  return;
                }
                // Long selections would blow up the prompt; the first 4000
                // characters are enough to reason about and cheap to send.
                //
                // The length is asked for *before* the text: `getValueInRange`
                // builds the whole string, so selecting all of a large file
                // copied megabytes on every cursor move only to throw it away
                // — measured on a 5 MB file, a select-all drag did that
                // hundreds of times.
                if (model.getValueLengthInRange(range) === 0) {
                  setSelection('');
                  return;
                }
                setSelection(model.getValueInRange(range).slice(0, 4000));
              });
            }}
            theme="vs-dark"
            options={{
              // The minimap is a second render of the file, redrawn as you type
              // and scroll; on a small machine that is the most expensive
              // decoration in the editor.
              minimap: { enabled: minimapEnabled() },
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
