import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, FileText, Palette, Save, Sparkles } from 'lucide-react';
import { useProject } from '../../stores/projectStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { toast } from '../../stores/toastStore';
import { DESIGN_PROFILES, DESIGN_STYLE_IDS, DesignStyle } from '../../../shared/design-profiles';

/** The shape `.d4ide/design.json` is stored in. */
interface ProjectDesignLike {
  style: DesignStyle;
  notes: string;
  chosenAt: number | null;
}

/**
 * What this project is, and how its screens should look.
 *
 * Two things that used to be invisible and rebuilt from scratch every session:
 * nothing told the agent what the product was, and nothing told it what "looks
 * good" meant for this project. Both live in `.d4ide/` inside the project, so
 * they travel with it — and this tab is where the user can see and correct them
 * without opening a file by hand.
 */
export const ProjectTab: React.FC = () => {
  const { t, i18n } = useTranslation();
  const language: 'th' | 'en' = i18n.language === 'en' ? 'en' : 'th';
  const { projectPath } = useProject((s) => ({ projectPath: s.projectPath }));
  const { settings, updateSettings } = useSettingsStore();

  const [memory, setMemory] = useState('');
  const [memorySaved, setMemorySaved] = useState('');
  const [memoryExists, setMemoryExists] = useState(false);
  const [design, setDesign] = useState<ProjectDesignLike>({ style: 'ask', notes: '', chosenAt: null });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!window.electronAPI || !projectPath) return;
    void window.electronAPI
      .getProjectMemory(projectPath)
      .then((stored: { content: string; exists: boolean } | null) => {
        setMemory(stored?.content || '');
        setMemorySaved(stored?.content || '');
        setMemoryExists(!!stored?.exists);
      })
      .catch(() => undefined);
    void window.electronAPI
      .getProjectDesign(projectPath)
      .then((stored: ProjectDesignLike | null) => setDesign(stored || { style: 'ask', notes: '', chosenAt: null }))
      .catch(() => undefined);
  }, [projectPath]);

  const saveMemory = async () => {
    if (!window.electronAPI || !projectPath) return;
    setBusy(true);
    try {
      const saved = await window.electronAPI.saveProjectMemory(projectPath, memory);
      setMemorySaved(saved?.content || memory);
      setMemoryExists(true);
      toast.success(t('project.memorySaved'));
    } finally {
      setBusy(false);
    }
  };

  const chooseStyle = async (style: DesignStyle) => {
    const next = { ...design, style };
    setDesign(next);
    if (!window.electronAPI || !projectPath) return;
    const saved = await window.electronAPI.saveProjectDesign(projectPath, { style, notes: next.notes });
    if (saved) setDesign(saved as ProjectDesignLike);
    toast.success(t('project.styleSaved', { style: labelFor(style) }));
  };

  const saveNotes = async () => {
    if (!window.electronAPI || !projectPath) return;
    const saved = await window.electronAPI.saveProjectDesign(projectPath, { notes: design.notes });
    if (saved) setDesign(saved as ProjectDesignLike);
    toast.success(t('project.notesSaved'));
  };

  const labelFor = (style: DesignStyle): string =>
    style === 'ask'
      ? t('project.styleAsk')
      : DESIGN_PROFILES[style as Exclude<DesignStyle, 'ask'>].label[language];

  if (!projectPath) {
    return (
      <div className="p-4">
        <p className="text-xs text-d4-muted">{t('project.noProject')}</p>
      </div>
    );
  }

  const dirty = memory !== memorySaved;

  return (
    <div className="p-4 space-y-6 overflow-y-auto h-full">
      {/* ------------------------------------------------------- screen style */}
      <section className="space-y-3">
        <div className="flex items-start gap-2">
          <Palette className="w-4 h-4 text-d4-accent mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-d4-text">{t('project.styleTitle')}</h3>
            <p className="text-[11px] text-d4-dimmed mt-0.5">{t('project.styleHint')}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {DESIGN_STYLE_IDS.map((style) => {
            const active = design.style === style;
            const profile = style === 'ask' ? null : DESIGN_PROFILES[style];
            return (
              <button
                key={style}
                onClick={() => void chooseStyle(style)}
                className={`text-start p-3 rounded-md border transition ${
                  active
                    ? 'border-d4-accent bg-d4-accent/10'
                    : 'border-d4-border bg-d4-surface hover:border-d4-dimmed'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-d4-text">{labelFor(style)}</span>
                  {active && <Check className="w-3.5 h-3.5 text-d4-accent" />}
                </div>
                <p className="text-[11px] text-d4-muted mt-1 leading-relaxed">
                  {profile ? profile.summary[language] : t('project.styleAskHint')}
                </p>
                {profile && (
                  <div className="flex items-center gap-1 mt-2">
                    {Object.values(profile.colors)
                      .slice(0, 5)
                      .map((color) => (
                        <span
                          key={color}
                          className="w-3 h-3 rounded-full border border-black/20"
                          style={{ background: color }}
                        />
                      ))}
                    <span className="text-[10px] text-d4-dimmed ms-1">
                      {profile.fonts.latin} · {profile.fonts.thai}
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] text-d4-muted">{t('project.styleNotes')}</label>
          <textarea
            value={design.notes}
            onChange={(e) => setDesign({ ...design, notes: e.target.value })}
            onBlur={() => void saveNotes()}
            rows={2}
            placeholder={t('project.styleNotesPlaceholder')}
            className="w-full bg-d4-surface border border-d4-border rounded-md p-2 text-xs text-d4-text outline-none focus:border-d4-accent resize-y"
          />
        </div>

        <label className="flex items-center gap-2 text-[11px] text-d4-muted">
          <input
            type="checkbox"
            checked={settings?.askDesignBeforeUiWork !== false}
            onChange={(e) => updateSettings({ askDesignBeforeUiWork: e.target.checked })}
            className="accent-d4-accent"
          />
          {t('project.askBeforeUi')}
        </label>

        <div className="text-[11px] text-d4-dimmed">
          {t('project.defaultStyle')}{' '}
          <select
            value={settings?.designStyle || 'minimal'}
            onChange={(e) => updateSettings({ designStyle: e.target.value as DesignStyle })}
            className="bg-d4-surface border border-d4-border rounded px-1.5 py-0.5 text-[11px] text-d4-text outline-none"
          >
            {DESIGN_STYLE_IDS.filter((id) => id !== 'ask').map((id) => (
              <option key={id} value={id}>
                {DESIGN_PROFILES[id].label[language]}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* ------------------------------------------------------ project memory */}
      <section className="space-y-3">
        <div className="flex items-start gap-2">
          <FileText className="w-4 h-4 text-d4-accent mt-0.5" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-d4-text">{t('project.memoryTitle')}</h3>
            <p className="text-[11px] text-d4-dimmed mt-0.5">
              {t('project.memoryHint', { file: '.d4ide/project.md' })}
            </p>
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-d4-muted">
            <input
              type="checkbox"
              checked={settings?.projectMemoryEnabled !== false}
              onChange={(e) => updateSettings({ projectMemoryEnabled: e.target.checked })}
              className="accent-d4-accent"
            />
            {t('project.memoryEnabled')}
          </label>
        </div>

        <textarea
          value={memory}
          onChange={(e) => setMemory(e.target.value)}
          rows={12}
          spellCheck={false}
          className="w-full bg-d4-surface border border-d4-border rounded-md p-3 text-[11px] font-mono text-d4-text outline-none focus:border-d4-accent resize-y leading-relaxed"
        />

        <div className="flex items-center gap-2">
          <button
            onClick={() => void saveMemory()}
            disabled={!dirty || busy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-d4-accent text-black font-semibold rounded-sm disabled:opacity-40"
          >
            <Save className="w-3.5 h-3.5" />
            {t('common.save')}
          </button>
          <button
            onClick={() => void saveMemory()}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-d4-border text-d4-text rounded-sm hover:border-d4-accent"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {t('project.memoryWrite')}
          </button>
          <span className="text-[11px] text-d4-dimmed">
            {memoryExists ? t('project.memoryOnDisk', { count: memory.length }) : t('project.memoryNotYet')}
          </span>
          {dirty && <span className="text-[11px] text-amber-400">{t('project.unsaved')}</span>}
        </div>

        <p className="text-[11px] text-d4-dimmed leading-relaxed">{t('project.memoryUpkeep')}</p>
      </section>
    </div>
  );
};
