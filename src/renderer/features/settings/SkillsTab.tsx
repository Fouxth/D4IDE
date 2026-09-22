import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Pencil, Plus, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import { SkillItem } from '../../../shared/types';
import { composeSkillFile, skillScopeOf, skillSlug, splitSkillFile, SkillScope } from '../../../shared/skills';
import { useProject } from '../../stores/projectStore';
import { toast } from '../../stores/toastStore';

/**
 * Settings → Skills.
 *
 * The library, not the composer: every skill the app can run, where it comes
 * from, and the form that edits it. Shipped commands are listed too, because they
 * are the ones worth copying — a user skill with the same id replaces a shipped
 * one, which is exactly how a project overrides `/review` with its own rules.
 *
 * The list is grouped by scope rather than sorted by name: "which of these can I
 * delete" is the first question a list of skills raises, and a badge on every row
 * answers it without a filter the user has to find.
 */

/** A blank skill, as the editor starts one. */
const blankSkill = (isGlobal: boolean): SkillItem => ({
  id: '',
  name: '',
  description: '',
  content: '',
  isGlobal
});

/**
 * What "Create skill" fills in.
 *
 * A prompt with no shape is the hardest kind to write, so the template gives the
 * three lines that make a skill work: what it is for, what to do, and what counts
 * as done.
 */
const SKILL_TEMPLATE = {
  description: 'Describe in one line what this skill is for',
  body: [
    'Do the work this skill exists for, in this order:',
    '',
    '1. Read the files in scope before changing anything.',
    '2. Make the smallest change that fully does the job.',
    '3. Prove it with the exact command you ran and its result.',
    '',
    'Say plainly if part of the request cannot be done, and why.'
  ].join('\n')
};

const scopeLabelKey = (scope: SkillScope): string => `skills.scope_${scope}`;

export const SkillsTab: React.FC = () => {
  const { t } = useTranslation();
  const { projectPath } = useProject((s) => ({ projectPath: s.projectPath }));
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [editing, setEditing] = useState<SkillItem | null>(null);
  const [editorBody, setEditorBody] = useState('');
  const [editorScope, setEditorScope] = useState<SkillScope>('project');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    if (!window.electronAPI) return;
    window.electronAPI
      .listSkills(projectPath || undefined)
      .then((list) => setSkills((list ?? []) as SkillItem[]))
      .catch(() => setSkills([]));
  };

  useEffect(() => {
    refresh();
    // The list belongs to the open project: its own skills live in the folder and
    // are gone the moment another folder is opened.
  }, [projectPath]);

  const openEditor = (skill: SkillItem) => {
    const { description, body } = splitSkillFile(skill.content);
    setEditing({ ...skill, description: description || skill.description });
    setEditorBody(body);
    setEditorScope(skillScopeOf(skill));
  };

  const startNew = (withTemplate: boolean) => {
    const draft = blankSkill(editorScope === 'global');
    setEditing({
      ...draft,
      description: withTemplate ? SKILL_TEMPLATE.description : '',
      content: withTemplate ? SKILL_TEMPLATE.body : ''
    });
    setEditorBody(withTemplate ? SKILL_TEMPLATE.body : '');
  };

  const save = async () => {
    if (!editing || !window.electronAPI) return;
    const id = skillSlug(editing.id || editing.description);
    if (!id) {
      toast.error(t('skills.needName'));
      return;
    }
    setBusy(true);
    try {
      const content = composeSkillFile(editing.description, editorBody);
      // A global skill is saved without a project so it lands in the user's own
      // folder; a project skill is written into `.d4ide/skills` of this project.
      const target = editorScope === 'global' ? undefined : projectPath || undefined;
      if (editorScope === 'project' && !projectPath) {
        toast.error(t('skills.needProject'));
        return;
      }
      const result = await window.electronAPI.saveSkill({ ...editing, id, name: id, content }, target);
      if (result?.success) {
        toast.success(t('skills.saved'), result.path);
        setEditing(null);
        refresh();
      } else {
        toast.error(t('skills.saveFailed'), result?.error);
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (skill: SkillItem) => {
    if (!window.electronAPI) return;
    const scope = skillScopeOf(skill);
    const target = scope === 'global' ? undefined : projectPath || undefined;
    await window.electronAPI.deleteSkill(skill.id, target);
    toast.info(t('skills.deleted', { name: skill.name }));
    if (editing?.id === skill.id) setEditing(null);
    refresh();
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills.filter(
      (skill) =>
        !q ||
        skill.id.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q)
    );
  }, [skills, query]);

  return (
    <div className="space-y-5 select-text">
      {/* ------------------------------------------------------ the controls */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => startNew(false)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-d4-accent text-black text-[12px] font-semibold hover:brightness-110 transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          {t('skills.addNew')}
        </button>
        <button
          type="button"
          onClick={() => startNew(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-d4-border text-[12px] text-d4-text hover:border-d4-muted transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5" />
          {t('skills.createSkill')}
        </button>
        <div className="ml-auto flex items-center gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('agent.searchSkills')}
            className="w-44 bg-d4-panel border border-d4-border rounded-md px-2.5 py-1.5 text-[12px] text-d4-text outline-none focus:border-d4-accent"
          />
          <button
            type="button"
            onClick={refresh}
            title={t('skills.refresh')}
            className="d4-icon-button w-7 h-7"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* --------------------------------------------------------- the editor */}
      {editing && (
        <div className="rounded-lg border border-d4-accent/50 bg-d4-accent/[0.06] p-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold text-d4-text">
              {skills.some((skill) => skill.id === editing.id) ? t('skills.editSkill') : t('skills.newSkill')}
            </span>
            <button type="button" onClick={() => setEditing(null)} className="text-d4-dimmed hover:text-d4-text">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="block text-[10px] uppercase tracking-wide text-d4-dimmed font-semibold">
                {t('skills.name')}
              </span>
              <input
                value={editing.id}
                autoFocus
                onChange={(event) => setEditing({ ...editing, id: event.target.value, name: event.target.value })}
                placeholder="review-api"
                className="w-full bg-d4-panel border border-d4-border rounded px-2 py-1.5 text-[12px] font-mono text-d4-text outline-none focus:border-d4-accent"
              />
            </label>

            <label className="space-y-1">
              <span className="block text-[10px] uppercase tracking-wide text-d4-dimmed font-semibold">
                {t('skills.where')}
              </span>
              <div className="flex items-center gap-1">
                {(['project', 'global'] as const).map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    onClick={() => setEditorScope(scope)}
                    disabled={scope === 'project' && !projectPath}
                    className={`flex-1 px-2 py-1.5 rounded-sm text-[11px] border transition-colors disabled:opacity-40 ${
                      editorScope === scope
                        ? 'border-d4-accent bg-d4-accent/15 text-d4-accent'
                        : 'border-d4-border text-d4-dimmed hover:text-d4-text'
                    }`}
                  >
                    {t(scopeLabelKey(scope))}
                  </button>
                ))}
              </div>
            </label>
          </div>

          <label className="block space-y-1">
            <span className="block text-[10px] uppercase tracking-wide text-d4-dimmed font-semibold">
              {t('skills.descriptionLabel')}
            </span>
            <input
              value={editing.description}
              onChange={(event) => setEditing({ ...editing, description: event.target.value })}
              className="w-full bg-d4-panel border border-d4-border rounded px-2 py-1.5 text-[12px] text-d4-text outline-none focus:border-d4-accent"
            />
          </label>

          <label className="block space-y-1">
            <span className="block text-[10px] uppercase tracking-wide text-d4-dimmed font-semibold">
              {t('skills.instruction')}
            </span>
            <textarea
              value={editorBody}
              onChange={(event) => setEditorBody(event.target.value)}
              rows={9}
              spellCheck={false}
              className="w-full bg-d4-panel border border-d4-border rounded p-2.5 text-[11px] font-mono text-d4-text outline-none focus:border-d4-accent resize-y leading-relaxed"
            />
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-d4-accent text-black text-[11px] font-semibold disabled:opacity-40 hover:brightness-110 transition-all"
            >
              <Check className="w-3.5 h-3.5" />
              {t('common.save')}
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="px-3 py-1.5 rounded-md border border-d4-border text-[11px] text-d4-muted hover:text-d4-text transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------- the list */}
      {visible.length === 0 ? (
        <p className="text-[12px] text-d4-dimmed py-6 text-center">{t('skills.empty')}</p>
      ) : (
        <div className="border-t border-d4-border-subtle">
          {visible.map((skill) => {
            const scope = skillScopeOf(skill);
            const canDelete = scope !== 'builtin';
            return (
              <div
                key={`${skill.id}-${skill.isGlobal}`}
                className="group flex items-start gap-3 border-b border-d4-border-subtle py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12px] text-d4-text">{skill.name}</span>
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-[1px] text-[9px] font-semibold ${
                        scope === 'builtin'
                          ? 'bg-d4-surface text-d4-dimmed'
                          : scope === 'global'
                            ? 'bg-d4-accent/15 text-d4-accent'
                            : 'bg-d4-info/15 text-d4-info'
                      }`}
                    >
                      {t(scopeLabelKey(scope))}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-d4-dimmed leading-snug line-clamp-2">
                    {skill.description}
                  </p>
                </div>

                <div className="flex items-center gap-1 shrink-0 pt-0.5">
                  <button
                    type="button"
                    onClick={() => openEditor(skill)}
                    title={t('skills.editSkill')}
                    className="text-d4-dimmed hover:text-d4-text transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => void remove(skill)}
                      title={t('skills.delete')}
                      className="text-d4-dimmed hover:text-d4-error transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-d4-dimmed leading-relaxed">{t('skills.pathHint')}</p>
    </div>
  );
};
