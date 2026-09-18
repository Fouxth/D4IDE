import React, { useState } from 'react';
import { FolderOpen, FolderGit2, X, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../stores/agentStore';
import { useProject } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { toast } from '../../stores/toastStore';
import { useEscapeToClose } from '../../lib/use-escape';

/**
 * "Where should I work?" — asked in the app, never by the operating system.
 *
 * The agent edits real files, so a prompt cannot run until a folder is open. The
 * answer used to be `window.alert()`, which was the worst of both worlds: a
 * native modal dialog over a frameless window (the one dialog that can make the
 * whole app look frozen) followed by a run that never happened. Here the message
 * the user already typed is held in the store, the folder is chosen from a
 * recent-workspace list or the OS picker, and the prompt goes out immediately
 * afterwards — so pressing Enter always has a visible, useful result.
 *
 * Cancelling is not a dead end either: the draft stays in the composer and a
 * toast says so.
 */
export const ProjectPickerDialog: React.FC = () => {
  const { t } = useTranslation();
  const { pendingSend, clearPendingSend, resumePendingSend } = useAgentStore();
  const { setProjectPath } = useProject((s) => ({ setProjectPath: s.setProjectPath }));
  const { settings, loadSettings } = useSettingsStore();
  const [busyPath, setBusyPath] = useState<string | null>(null);

  const isOpen = !!pendingSend;
  useEscapeToClose(isOpen, () => {
    clearPendingSend();
    toast.info(t('project.kept'));
  });

  if (!pendingSend) return null;

  const recents = settings?.recentProjects ?? [];

  /** Opens a folder, then releases the prompt that was waiting for one. */
  const openPath = async (dir: string) => {
    if (!window.electronAPI) return;
    setBusyPath(dir);
    const opened = await window.electronAPI.openProjectPath(dir).catch(() => false);
    setBusyPath(null);

    if (!opened) {
      toast.error(t('project.missing'), dir);
      return;
    }

    setProjectPath(dir);
    // The recents list on disk has just changed; refresh it for the next time.
    void loadSettings();
    void resumePendingSend();
  };

  const browse = async () => {
    if (!window.electronAPI) return;
    const dir = await window.electronAPI.openProjectDialog();
    if (dir) await openPath(dir);
  };

  const cancel = () => {
    clearPendingSend();
    toast.info(t('project.kept'));
  };

  const folderName = (dir: string) => dir.split(/[/\\]/).filter(Boolean).pop() || dir;

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center select-none text-xs">
      <div className="w-[520px] bg-d4-panel border border-d4-border rounded-lg shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-d4-border">
          <FolderGit2 className="w-4 h-4 text-d4-accent" />
          <span className="font-semibold text-d4-text text-sm">{t('project.title')}</span>
          <button
            onClick={cancel}
            title={t('project.cancel')}
            className="ml-auto d4-icon-button w-6 h-6"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-d4-muted leading-relaxed">{t('project.body')}</p>

          {pendingSend.text.trim() && (
            <div className="bg-d4-bg border border-d4-border-subtle rounded p-2.5 text-[11px] text-d4-dimmed italic max-h-20 overflow-y-auto">
              {pendingSend.text}
            </div>
          )}

          {recents.length > 0 && (
            <div className="space-y-1">
              <span className="d4-label">{t('project.recent')}</span>
              {recents.slice(0, 5).map((dir) => (
                <button
                  key={dir}
                  onClick={() => void openPath(dir)}
                  disabled={!!busyPath}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md border border-d4-border-subtle bg-d4-surface hover:border-d4-muted transition-colors text-left disabled:opacity-60"
                >
                  {busyPath === dir ? (
                    <Loader2 className="w-3.5 h-3.5 text-d4-accent animate-spin shrink-0" />
                  ) : (
                    <FolderGit2 className="w-3.5 h-3.5 text-d4-dimmed shrink-0" />
                  )}
                  <span className="flex-1 min-w-0">
                    <span className="block text-d4-text truncate">{folderName(dir)}</span>
                    <span className="block text-[10px] text-d4-dimmed font-mono truncate">{dir}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => void browse()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-d4-accent hover:bg-d4-accent-hover text-black font-semibold rounded-sm transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>{t('project.browse')}</span>
            </button>
            <button
              onClick={cancel}
              className="ml-auto px-3 py-1.5 bg-d4-surface hover:bg-d4-subtle border border-d4-border text-d4-muted hover:text-d4-text rounded-sm transition-colors"
            >
              {t('project.cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
