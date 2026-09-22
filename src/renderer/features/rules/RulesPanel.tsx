import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ExternalLink, Lock, LockOpen, Pencil, Plus, Save, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { STANDING_LAWS, RuleLanguage } from '../../../shared/rules';
import { useSettingsStore } from '../../stores/settingsStore';
import { toast } from '../../stores/toastStore';

/**
 * The rules the user can see and add to.
 *
 * Two halves, and the difference between them is the whole point:
 *
 *   · The laws at the top are the ones the *engine* enforces. They carry a lock
 *     because they hold whatever the model believes — a tool call that breaks
 *     one is refused before it runs, even in Full Access.
 *   · The lines below are the user's own rules, kept in two plain markdown files
 *     (`<dataDir>/rules.md` for every project, `<project>/.d4ide/rules.md` for
 *     one) and put into the system prompt of every model.
 *
 * The card and the panel read and write the same two files, so a rule added from
 * the card is in the panel and in the prompt — there is no second copy to drift.
 */
interface RulesSnapshot {
  global: string;
  project: string;
  globalPath: string;
  projectFile: string;
}

const EMPTY: RulesSnapshot = { global: '', project: '', globalPath: '', projectFile: '' };

function useRules(projectPath: string | null) {
  const [rules, setRules] = useState<RulesSnapshot>(EMPTY);

  const refresh = useCallback(() => {
    const api = window.electronAPI;
    if (!api?.getRules) return;
    void api
      .getRules(projectPath || undefined)
      .then(setRules)
      .catch(() => setRules(EMPTY));
  }, [projectPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = useCallback(
    async (scope: 'global' | 'project', content: string) => {
      const api = window.electronAPI;
      if (!api?.saveRules) return false;
      const result = await api.saveRules(scope, content, projectPath || undefined);
      if (result?.success) {
        refresh();
        return true;
      }
      return false;
    },
    [projectPath, refresh]
  );

  return { rules, refresh, save };
}

/** Splits a rules file into the lines a person would call rules. */
function ruleLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^#{1,6}\s/.test(line) && !line.startsWith('<!--'))
    .map((line) => line.replace(/^([-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
}

const lawList = (language: RuleLanguage) =>
  STANDING_LAWS.map((law) => ({ id: law.id, enforced: law.enforced, text: language === 'th' ? law.th : law.en }));

/**
 * Which standing laws the engine is enforcing right now.
 *
 * The switch is a settings write, not local state: the same value is what the
 * permission engine reads on the next tool call and what the prompt block is
 * built from, so a law can never look off in the card while still refusing tool
 * calls underneath.
 */
function useDisabledLaws() {
  const disabled = useSettingsStore((state) => state.settings?.disabledLaws);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const list = Array.isArray(disabled) ? disabled : [];

  const toggle = (id: string) => {
    const next = list.includes(id) ? list.filter((value) => value !== id) : [...list, id];
    void updateSettings({ disabledLaws: next });
  };

  return { disabled: list, toggle };
}

/** The little on/off switch that arms or disarms one law. */
const LawSwitch: React.FC<{ on: boolean; onClick: () => void; label: string }> = ({ on, onClick, label }) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-pressed={on}
    className={`relative shrink-0 w-8 h-4 rounded-full transition-colors ${on ? 'bg-d4-accent' : 'bg-d4-subtle'}`}
  >
    <span
      className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${on ? 'left-4' : 'left-0.5'}`}
    />
  </button>
);

interface RulesCardProps {
  projectPath: string | null;
  /** Opens the full editor tab, for a rule that needs more than one line. */
  onOpenRules: () => void;
}

/**
 * The compact card that sits with the other cards: what is in force, what the
 * user has added, and one line to add another.
 */
export const RulesCard: React.FC<RulesCardProps> = ({ projectPath, onOpenRules }) => {
  const { t, i18n } = useTranslation();
  const language: RuleLanguage = i18n.language === 'en' ? 'en' : 'th';
  const { rules, save } = useRules(projectPath);
  const { disabled, toggle } = useDisabledLaws();
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState('');

  const laws = lawList(language).filter((law) => law.enforced);
  const mine = [...ruleLines(rules.project), ...ruleLines(rules.global)];

  const addRule = async () => {
    const line = draft.trim();
    if (!line) return;
    setDraft('');
    // A rule added with a project open applies to that project; with no project
    // open it still has a home — the user's own file — instead of a disabled box.
    const scope: 'global' | 'project' = projectPath ? 'project' : 'global';
    const existing = scope === 'project' ? rules.project : rules.global;
    const body = `${existing.trimEnd()}\n- ${line}\n`.replace(/^\n/, '');
    const ok = await save(scope, body);
    if (ok) toast.success(t('rules.saved'));
    else toast.error(t('rules.saveFailed'));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <button onClick={() => setOpen((value) => !value)} className="flex items-center gap-1 d4-label hover:text-d4-muted">
          <ShieldCheck className="w-3 h-3" />
          <span>{t('rules.title')}</span>
          <ChevronDown className={`w-3 h-3 transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
        <div className="flex items-center gap-1.5">
          <button
            onClick={async () => {
              const result = await window.electronAPI?.revealRules?.(projectPath ? 'project' : 'global', projectPath || undefined);
              if (!result?.success) toast.error(t('rules.revealFailed'));
            }}
            title={t('rules.reveal')}
            className="text-d4-dimmed hover:text-d4-text"
          >
            <ExternalLink className="w-3 h-3" />
          </button>
          <button onClick={onOpenRules} title={t('rules.edit')} className="text-d4-dimmed hover:text-d4-text">
            <Pencil className="w-3 h-3" />
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-2">
          <div className="space-y-1.5">
            {laws.map((law) => {
              const on = !disabled.includes(law.id);
              return (
                <div key={law.id} className="flex items-start gap-1.5 text-[11px] leading-relaxed">
                  {on ? (
                    <Lock className="w-3 h-3 mt-0.5 shrink-0 text-d4-accent" />
                  ) : (
                    <LockOpen className="w-3 h-3 mt-0.5 shrink-0 text-d4-dimmed" />
                  )}
                  <span className={`flex-1 min-w-0 ${on ? 'text-d4-muted' : 'text-d4-dimmed line-through'}`}>
                    <span className={on ? 'text-d4-text' : 'text-d4-dimmed'}>{law.text.title}</span>
                    <span className="text-d4-dimmed"> — {law.text.body}</span>
                  </span>
                  <LawSwitch
                    on={on}
                    onClick={() => toggle(law.id)}
                    label={on ? t('rules.turnOff') : t('rules.turnOn')}
                  />
                </div>
              );
            })}
          </div>
          {disabled.length > 0 && (
            <p className="text-[10px] text-d4-warning leading-relaxed pl-4">{t('rules.disabledNote')}</p>
          )}

          {mine.length > 0 && (
            <div className="pt-1 border-t border-d4-border-subtle space-y-1">
              <span className="d4-label">{t('rules.yours')}</span>
              {mine.slice(0, 6).map((line, index) => (
                <p key={`${index}-${line}`} className="text-[11px] text-d4-muted leading-relaxed truncate" title={line}>
                  • {line}
                </p>
              ))}
              {mine.length > 6 && <p className="text-[10px] text-d4-dimmed">+{mine.length - 6}</p>}
            </div>
          )}

          <div className="flex items-center gap-1">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void addRule();
              }}
              placeholder={projectPath ? t('rules.addPlaceholderProject') : t('rules.addPlaceholderGlobal')}
              className="flex-1 min-w-0 bg-d4-surface border border-d4-border rounded px-2 py-1 text-[11px] text-d4-text placeholder:text-d4-dimmed outline-none focus:border-d4-accent"
            />
            <button
              onClick={() => void addRule()}
              disabled={!draft.trim()}
              title={t('rules.add')}
              className="p-1 rounded text-d4-dimmed hover:text-d4-text disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[10px] text-d4-dimmed leading-relaxed">{t('rules.hint')}</p>
        </div>
      )}
    </div>
  );
};

/** The full editor: the laws as read-only reference, the two files as text. */
export const RulesPanel: React.FC<{ projectPath: string | null }> = ({ projectPath }) => {
  const { t, i18n } = useTranslation();
  const language: RuleLanguage = i18n.language === 'en' ? 'en' : 'th';
  const { rules, save } = useRules(projectPath);
  const { disabled, toggle } = useDisabledLaws();
  const [projectDraft, setProjectDraft] = useState('');
  const [globalDraft, setGlobalDraft] = useState('');

  useEffect(() => {
    setProjectDraft(rules.project);
    setGlobalDraft(rules.global);
  }, [rules.project, rules.global]);

  const saveScope = async (scope: 'global' | 'project') => {
    const ok = await save(scope, scope === 'project' ? projectDraft : globalDraft);
    if (ok) toast.success(t('rules.saved'));
    else toast.error(t('rules.saveFailed'));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-d4-dimmed text-[11px] uppercase font-semibold">
        <ShieldCheck className="w-3 h-3" />
        <span>{t('rules.lawsTitle')}</span>
      </div>

      <div className="space-y-2">
        {lawList(language).map((law) => {
          const on = !law.enforced || !disabled.includes(law.id);
          return (
            <div
              key={law.id}
              className={`bg-d4-surface border rounded p-2 space-y-0.5 ${on ? 'border-d4-border' : 'border-d4-warning/40'}`}
            >
              <div className="flex items-center gap-1.5">
                {law.enforced ? (
                  on ? (
                    <Lock className="w-3 h-3 text-d4-accent shrink-0" />
                  ) : (
                    <LockOpen className="w-3 h-3 text-d4-warning shrink-0" />
                  )
                ) : (
                  <span className="w-3 h-3 shrink-0" />
                )}
                <span className="text-[11px] text-d4-text font-medium flex-1 min-w-0">{law.text.title}</span>
                {law.enforced &&
                  (on ? (
                    <span className="text-[9px] px-1 rounded bg-d4-accent/15 text-d4-accent">{t('rules.enforced')}</span>
                  ) : (
                    <span className="text-[9px] px-1 rounded bg-d4-warning/15 text-d4-warning">
                      {t('rules.notEnforced')}
                    </span>
                  ))}
                {law.enforced && (
                  <LawSwitch on={on} onClick={() => toggle(law.id)} label={on ? t('rules.turnOff') : t('rules.turnOn')} />
                )}
              </div>
              <p className="text-[11px] text-d4-dimmed leading-relaxed pl-[18px]">{law.text.body}</p>
            </div>
          );
        })}
      </div>

      {disabled.length > 0 && (
        <div className="rounded border border-d4-warning/40 bg-d4-warning/10 p-2 space-y-1.5">
          <p className="text-[10px] text-d4-warning leading-relaxed">{t('rules.disabledNote')}</p>
          <button
            onClick={() => void useSettingsStore.getState().updateSettings({ disabledLaws: [] })}
            className="text-[10px] text-d4-accent hover:underline"
          >
            {t('rules.enableAll')}
          </button>
        </div>
      )}

      <div className="pt-1 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="d4-label">{t('rules.projectFile')}</span>
          <button
            onClick={() => void saveScope('project')}
            disabled={!projectPath}
            className="flex items-center gap-1 text-[10px] text-d4-accent hover:underline disabled:opacity-40"
          >
            <Save className="w-3 h-3" />
            {t('common.save')}
          </button>
        </div>
        <textarea
          value={projectDraft}
          onChange={(event) => setProjectDraft(event.target.value)}
          rows={5}
          disabled={!projectPath}
          placeholder={t('rules.projectPlaceholder')}
          className="w-full bg-d4-panel border border-d4-border rounded px-2 py-1.5 text-[11px] text-d4-text outline-none font-mono resize-y disabled:opacity-50"
        />
        {rules.projectFile && <p className="text-[10px] text-d4-dimmed font-mono break-all">{rules.projectFile}</p>}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="d4-label">{t('rules.globalFile')}</span>
          <button
            onClick={() => void saveScope('global')}
            className="flex items-center gap-1 text-[10px] text-d4-accent hover:underline"
          >
            <Save className="w-3 h-3" />
            {t('common.save')}
          </button>
        </div>
        <textarea
          value={globalDraft}
          onChange={(event) => setGlobalDraft(event.target.value)}
          rows={5}
          placeholder={t('rules.globalPlaceholder')}
          className="w-full bg-d4-panel border border-d4-border rounded px-2 py-1.5 text-[11px] text-d4-text outline-none font-mono resize-y"
        />
        {rules.globalPath && <p className="text-[10px] text-d4-dimmed font-mono break-all">{rules.globalPath}</p>}
      </div>

      <p className="text-[10px] text-d4-dimmed leading-relaxed">{t('rules.hintLong')}</p>
    </div>
  );
};
