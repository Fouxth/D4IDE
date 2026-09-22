import React from 'react';
import { FolderOpen, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * The screen a signed-in user sees before anything is open.
 *
 * It replaces the whole workspace rather than sitting inside it. With no folder
 * there is no file tree, no tab strip, no session and no changes — a window laid
 * out around those empties reads as a broken app, and a first-time user cannot
 * tell the difference between "nothing here yet" and "something failed". One
 * sentence and one button is the honest version, and the only thing that can be
 * done from an empty workspace is exactly that button.
 */
export const ProjectEmptyState: React.FC<{ onOpen: () => void; busy?: boolean }> = ({ onOpen, busy }) => {
  const { t } = useTranslation();

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 bg-d4-bg p-8 text-center">
      <div className="w-12 h-12 rounded-xl border border-d4-border bg-d4-panel flex items-center justify-center text-d4-accent">
        <FolderOpen className="w-6 h-6" />
      </div>

      <div className="space-y-1.5">
        <h2 className="text-base font-semibold text-d4-text">{t('project.start.title')}</h2>
        <p className="text-xs text-d4-muted max-w-[340px] leading-relaxed">{t('project.start.body')}</p>
      </div>

      <button
        onClick={onOpen}
        disabled={busy}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-d4-accent text-black text-xs font-semibold hover:opacity-90 transition disabled:opacity-40"
      >
        <Plus className="w-4 h-4" />
        {t('project.start.open')}
      </button>
    </div>
  );
};
