import React from 'react';
import { Sparkles, FolderOpen, Key, Check, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { useProjectStore } from '../../stores/projectStore';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose, onOpenSettings }) => {
  const { t } = useTranslation();
  const { settings, setLanguage, updateSettings } = useSettingsStore();
  const { setProjectPath } = useProjectStore();

  if (!isOpen || !settings) return null;

  const handleSelectLanguage = (lang: 'th' | 'en') => {
    setLanguage(lang);
  };

  const handleOpenProject = async () => {
    if (!window.electronAPI) return;
    const dir = await window.electronAPI.openProjectDialog();
    if (dir) {
      setProjectPath(dir);
      updateSettings({ firstRunComplete: true });
      onClose();
    }
  };

  const handleFinish = () => {
    updateSettings({ firstRunComplete: true });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center select-none text-xs">
      <div className="w-[520px] bg-d4-panel border border-d4-border rounded-xl shadow-2xl p-6 space-y-6 animate-in zoom-in-95 duration-200">
        {/* Brand header */}
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-teal-500 to-emerald-400 flex items-center justify-center text-black font-extrabold text-xl shadow-lg">
            D4
          </div>
          <h2 className="text-lg font-bold text-d4-text">{t('onboarding.welcome')}</h2>
          <p className="text-xs text-d4-muted">{t('onboarding.subtitle')}</p>
        </div>

        {/* Language Selection Step */}
        <div className="bg-d4-surface border border-d4-border rounded-lg p-4 space-y-3">
          <span className="font-semibold text-d4-text block">{t('onboarding.selectLanguage')}</span>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleSelectLanguage('th')}
              className={`flex items-center justify-between p-3 rounded-md border text-xs font-medium transition-all ${
                settings.language === 'th'
                  ? 'border-d4-accent bg-d4-accent/10 text-d4-accent'
                  : 'border-d4-border bg-d4-panel text-d4-muted hover:border-d4-dimmed'
              }`}
            >
              <span>ภาษาไทย</span>
              {settings.language === 'th' && <Check className="w-4 h-4 text-d4-accent" />}
            </button>

            <button
              onClick={() => handleSelectLanguage('en')}
              className={`flex items-center justify-between p-3 rounded-md border text-xs font-medium transition-all ${
                settings.language === 'en'
                  ? 'border-d4-accent bg-d4-accent/10 text-d4-accent'
                  : 'border-d4-border bg-d4-panel text-d4-muted hover:border-d4-dimmed'
              }`}
            >
              <span>English</span>
              {settings.language === 'en' && <Check className="w-4 h-4 text-d4-accent" />}
            </button>
          </div>
        </div>

        {/* Action buttons */}
        <div className="space-y-2.5">
          <button
            onClick={handleOpenProject}
            className="w-full flex items-center justify-center space-x-2 py-2.5 bg-d4-accent hover:bg-d4-accent-hover text-black font-semibold rounded-md shadow transition-colors text-sm"
          >
            <FolderOpen className="w-4 h-4" />
            <span>{t('onboarding.openProject')}</span>
          </button>

          <button
            onClick={() => {
              onOpenSettings();
              handleFinish();
            }}
            className="w-full flex items-center justify-center space-x-2 py-2 bg-d4-surface hover:bg-d4-subtle text-d4-text border border-d4-border rounded-md transition-colors"
          >
            <Key className="w-4 h-4 text-amber-400" />
            <span>{t('onboarding.setupProvider')}</span>
          </button>
        </div>

        <div className="flex justify-end pt-2 border-t border-d4-border">
          <button
            onClick={handleFinish}
            className="text-d4-dimmed hover:text-d4-text flex items-center space-x-1"
          >
            <span>{t('onboarding.getStarted')}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
