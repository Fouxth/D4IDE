import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { ProviderHub } from '../features/providers/ProviderHub';

/**
 * Managing provider keys, reachable from where the keys are needed.
 *
 * This used to be a tab inside Settings, which meant the one screen a user needs
 * while choosing a model lived three clicks away in a place about preferences.
 * The model picker now opens this instead, and Settings is back to being about
 * settings. `initialView` is what makes the difference between "connect a
 * provider" (the preset list, straight away) and "manage my keys" (the list).
 */
export const ProviderDialog: React.FC<{
  onClose: () => void;
  initialView?: 'list' | 'add';
}> = ({ onClose, initialView = 'list' }) => {
  const { t } = useTranslation();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label={t('settings.providers')}
      className="fixed inset-0 z-[65] flex items-center justify-center bg-black/60 p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-[900px] max-w-full max-h-full flex flex-col bg-d4-panel border border-d4-border rounded-lg shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-d4-border shrink-0">
          {/* The panel below states the title itself; repeating it here would
              put the same words twice in one dialog. */}
          <p className="text-[11px] text-d4-dimmed">{t('providers.dialogHint')}</p>
          <button
            type="button"
            onClick={onClose}
            title={t('common.close')}
            aria-label={t('common.close')}
            className="p-1 rounded-sm text-d4-dimmed hover:text-d4-text"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          <ProviderHub initialAddOpen={initialView === 'add'} />
        </div>
      </div>
    </div>
  );
};
