import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Terminal,
  FileCode,
  FileEdit,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Play,
  RotateCcw,
  Check,
  AlertCircle,
  Users,
  Loader2,
  Search as SearchIcon,
  Wrench,
  ArrowDown,
  Palette,
  MessageSquareHeart,
  HelpCircle,
  Send,
  ArrowRight,
  X
} from 'lucide-react';
import { FileChange } from '../../../shared/types';
import { commandChipFor } from '../../../shared/builtin-commands';
import { Markdown } from '../../components/Markdown';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../stores/agentStore';
import { useProjectStore } from '../../stores/projectStore';
import { useFollowUpStore } from '../../stores/followupStore';
import { FollowUpSuggestion } from '../../../shared/followup-suggestions';
import { ProjectSuggestion } from '../../../shared/project-suggestions';
import {
  AgentQuestion,
  AgentTimelineItem,
  AgentTodo,
  PlanScope,
  QuestionAnswer,
  SubagentRole
} from '../../../shared/types';
import { answeredCount } from '../../../shared/questions';
import { DESIGN_PROFILES, DesignProfile, DesignStyle } from '../../../shared/design-profiles';
import { targetFor, verbKeyFor } from './step-labels';
import { buildNodes, defaultRunOpen, lastRunIdOf, Node, StepRow } from './step-groups';
import { formatElapsed } from '../../lib/elapsed';

/**
 * The "Responding 0:24" pill (Freebuff-style): ticks every second while a run
 * is in flight and disappears the moment the run settles.
 */
const RespondingPill: React.FC = () => {
  const { t } = useTranslation();
  const status = useAgentStore((st) => st.status);
  const runStartedAt = useAgentStore((st) => st.runStartedAt);
  const [now, setNow] = useState(Date.now());

  const live = status === 'running' || status === 'planning';
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live]);

  if (!live || !runStartedAt) return null;
  return (
    <span
      data-testid="responding-pill"
      className="absolute bottom-3 right-4 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-d4-panel border border-d4-border-subtle text-[10px] text-d4-muted shadow-sm"
    >
      <Loader2 className="w-3 h-3 text-d4-accent animate-spin" />
      <span>{t('agent.responding')}</span>
      <span className="font-mono text-d4-text">{formatElapsed(now - runStartedAt)}</span>
    </span>
  );
};

/** The quiet feedback line under the transcript, like Freebuff's. */
const FeedbackLink: React.FC = () => {
  const { t } = useTranslation();
  return (
    <button
      onClick={() => void window.electronAPI?.openExternal('https://github.com/d4ide/d4ide/issues')}
      className="flex items-center gap-1 px-1.5 py-1 text-[10px] text-d4-dimmed hover:text-d4-muted transition-colors"
    >
      <MessageSquareHeart className="w-3 h-3" />
      <span>{t('agent.giveFeedback')}</span>
    </button>
  );
};

/** Colour per subagent role, so delegated work is recognisable at a glance. */
const ROLE_ACCENTS: Record<SubagentRole, string> = {
  explore: 'text-sky-400 border-sky-500/40 bg-sky-500/10',
  review: 'text-violet-400 border-violet-500/40 bg-violet-500/10',
  test: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
  debug: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
  frontend: 'text-pink-400 border-pink-500/40 bg-pink-500/10',
  database: 'text-cyan-400 border-cyan-500/40 bg-cyan-500/10'
};

const RoleTag: React.FC<{ role: SubagentRole }> = ({ role }) => {
  const { t } = useTranslation();
  return (
    <span
      className={`px-1.5 py-0.5 rounded-sm border text-[9px] font-semibold uppercase tracking-wide ${
        ROLE_ACCENTS[role] ?? 'text-d4-muted border-d4-border bg-d4-subtle/40'
      }`}
    >
      {t(`agent.role_${role}`)}
    </span>
  );
};

/** Screenshots are stored as paths; the main process hands back the pixels. */
const thumbnailCache = new Map<string, string | null>();

const ScreenshotThumb: React.FC<{ relativePath: string }> = ({ relativePath }) => {
  const projectPath = useProjectStore((state) => state.projectPath);
  const [src, setSrc] = useState<string | null>(() => thumbnailCache.get(relativePath) ?? null);

  useEffect(() => {
    if (thumbnailCache.has(relativePath)) {
      setSrc(thumbnailCache.get(relativePath) ?? null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const data =
        projectPath && window.electronAPI
          ? await window.electronAPI.readImageDataUrl(projectPath, relativePath).catch(() => null)
          : null;
      thumbnailCache.set(relativePath, data ?? null);
      if (!cancelled) setSrc(data ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [relativePath, projectPath]);

  if (!src) return <div className="px-2 py-1 text-[11px] font-mono text-d4-dimmed">{relativePath}</div>;
  return (
    <div className="px-2 py-2 bg-d4-bg/60 border-t border-d4-border-subtle">
      <img src={src} alt={relativePath} className="max-h-72 rounded border border-d4-border" />
      <div className="mt-1 text-[10px] font-mono text-d4-dimmed">{relativePath}</div>
    </div>
  );
};

/**
 * Conversation starters for the empty transcript — the project's own "you were
 * here" rather than the same four buttons every project ever showed.
 *
 * Main process reads what is real (uncommitted work, TODO/FIXME markers in the
 * code, recently touched files) and ships finished chips. A click puts the
 * prompt in the composer, so nothing starts unreviewed; the list is fetched per
 * project and re-fetched when the project changes, because the chips are about
 * *that* folder.
 */
const ProjectStarterChips: React.FC = () => {
  const projectPath = useProjectStore((state) => state.projectPath);
  const [suggestions, setSuggestions] = useState<ProjectSuggestion[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!projectPath || !window.electronAPI?.getProjectSuggestions) {
      setSuggestions([]);
      return;
    }
    void window.electronAPI
      .getProjectSuggestions(projectPath)
      .then((list) => {
        if (!cancelled) setSuggestions(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  if (suggestions.length === 0) return null;

  const apply = (suggestion: ProjectSuggestion) => {
    useAgentStore.getState().setPrompt(suggestion.prompt);
  };

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 max-w-xl">
      {suggestions.map((suggestion) => (
        <button
          key={suggestion.id}
          onClick={() => apply(suggestion)}
          title={suggestion.prompt}
          className="px-3 py-1.5 rounded-full bg-d4-panel border border-d4-border text-[11px] text-d4-muted hover:text-d4-text hover:border-d4-accent/50 transition-colors"
        >
          {suggestion.label}
        </button>
      ))}
    </div>
  );
};

/**
 * The next-move chips under a finished run — Freebuff-style suggested prompts.
 *
 * Main process builds them from what the run actually did (files it changed,
 * builds it failed, todos it left open), so a chip is a grounded next step
 * rather than a canned button. A click puts the prompt in the composer — the
 * user still presses Enter, so nothing starts unreviewed. The offer clears
 * itself the moment a new run starts or the conversation empties: chips that
 * describe a finished run are lies while one is in flight.
 */
const FollowUpChips: React.FC = () => {
  const { t } = useTranslation();
  const status = useAgentStore((st) => st.status);
  const timelineLength = useAgentStore((st) => st.timeline.length);
  const suggestions = useFollowUpStore((st) => st.suggestions);
  const dismissed = useFollowUpStore((st) => st.dismissed);

  const busy = status === 'running' || status === 'planning' || status === 'waiting_approval';
  useEffect(() => {
    if (busy || timelineLength === 0) useFollowUpStore.getState().clear();
  }, [busy, timelineLength]);

  if (busy || dismissed || suggestions.length === 0) return null;

  const apply = (suggestion: FollowUpSuggestion) => {
    useAgentStore.getState().setPrompt(suggestion.prompt);
    // Used is gone: a chip that survives its own click reads as "it did nothing".
    useFollowUpStore.getState().clear();
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1 pb-2">
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-d4-dimmed shrink-0">
        <Sparkles className="w-3 h-3 text-d4-accent" />
        {t('agent.suggestedTitle')}
      </span>
      {suggestions.map((suggestion) => (
        <button
          key={suggestion.id}
          onClick={() => apply(suggestion)}
          title={suggestion.prompt}
          className="group flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-d4-panel border border-d4-border text-[11px] text-d4-muted hover:text-d4-text hover:border-d4-accent/50 transition-colors"
        >
          <span>{suggestion.label}</span>
          <X
            className="w-3 h-3 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
            onClick={(event) => {
              // The X is a dismiss, not an apply.
              event.stopPropagation();
              useFollowUpStore.getState().dismiss();
            }}
          />
        </button>
      ))}
    </div>
  );
};

/**
 * What the agent is doing right now, one line per step.
 *
 * The transcript is a *log*, not a chat log with cards in it: a run of steps is
 * grouped under a collapsible header, every step is a single row (verb + target
 * + outcome), and the full command, arguments and output only appear when a row
 * is opened. That keeps a 200-step task scannable (spec §15).
 */

const StepVerbIcon: React.FC<{ name: string }> = ({ name }) => {
  if (name.startsWith('run_') || name === 'browser_run') return <Terminal className="w-3 h-3" />;
  if (name.startsWith('read_') || name === 'list_directory') return <FileCode className="w-3 h-3" />;
  if (name.startsWith('write_') || name === 'create_file') return <FileEdit className="w-3 h-3" />;
  if (name.includes('search') || name.includes('grep')) return <SearchIcon className="w-3 h-3" />;
  return <Wrench className="w-3 h-3" />;
};

/**
 * One profile, shown as the thing itself rather than described.
 *
 * Swatches, a real radius, a real shadow and the actual type at the actual
 * sizes: a colour list in text says nothing about whether the page will look
 * like a bank or a toy, and this choice is the one the whole project inherits.
 */
const StylePreview: React.FC<{ profile: DesignProfile; language: 'th' | 'en' }> = ({ profile, language }) => (
  <div
    className="rounded-lg p-3 space-y-2 h-[104px] flex flex-col justify-between"
    style={{ background: profile.colors.bg, border: `1px solid ${profile.colors.border}` }}
  >
    <div className="flex items-center gap-1.5">
      <span className="w-3 h-3 rounded-full" style={{ background: profile.colors.accent }} />
      <span
        className="w-3 h-3 rounded-full"
        style={{ background: profile.colors['accent-2'] ?? profile.colors['accent-soft'] }}
      />
      <span className="w-3 h-3 rounded-full" style={{ background: profile.colors.text }} />
      <span className="w-3 h-3 rounded-full" style={{ background: profile.colors.surface }} />
    </div>
    <div className="space-y-1.5">
      <div
        style={{ background: profile.colors.text, width: '72%', borderRadius: profile.radius.full }}
        className="h-1.5 opacity-80"
      />
      <div
        style={{ background: profile.colors.muted, width: '100%', borderRadius: profile.radius.full }}
        className="h-1.5 opacity-40"
      />
    </div>
    <div className="flex items-end justify-between">
      <span
        className="px-2 py-1 text-[11px] font-semibold"
        style={{
          background: profile.colors.accent,
          color: '#fff',
          borderRadius: profile.radius.md,
          boxShadow: profile.shadow.md
        }}
      >
        {language === 'th' ? 'ปุ่ม' : 'Button'}
      </span>
      <span
        className="text-[10px] font-medium truncate max-w-[52%]"
        style={{ color: profile.colors.muted }}
        title={`${profile.fonts.latin} + ${profile.fonts.thai}`}
      >
        {profile.fonts.thai}
      </span>
    </div>
  </div>
);

/**
 * The style chooser.
 *
 * "Make it beautiful" is not a specification the user should have to type into
 * every prompt, and it is not one the agent should invent either — plain green
 * buttons on white cards are what guessing looks like. So the first UI task in a
 * project with no style recorded raises this card instead: the profiles as
 * previews, one click, remembered for the project afterwards.
 */
const DesignCard: React.FC<{ item: AgentTimelineItem; waiting: boolean }> = ({ item, waiting }) => {
  const { t } = useTranslation();
  const chooseDesignStyle = useAgentStore((state) => state.chooseDesignStyle);
  const language = (item.details?.language === 'th' ? 'th' : 'en') as 'th' | 'en';
  // The AI's lean arrives with the card: pre-select it so accepting is one
  // click, and badge it so the user can see whose choice is lit up.
  const recommended = item.details?.recommended as Exclude<DesignStyle, 'ask'> | undefined;
  const reason = (item.details?.reason as string | undefined) || '';
  const [picked, setPicked] = useState<Exclude<DesignStyle, 'ask'>>(
    recommended && DESIGN_PROFILES[recommended] ? recommended : 'minimal'
  );
  const profiles = Object.values(DESIGN_PROFILES);
  const selected = DESIGN_PROFILES[picked as Exclude<DesignStyle, 'ask'>] ?? profiles[0];

  return (
    <div className="rounded-lg border border-d4-accent/40 bg-d4-accent/[0.06] p-3.5 space-y-3">
      <div className="flex items-center gap-2 text-d4-accent text-[12px] font-semibold">
        <Palette className="w-3.5 h-3.5" />
        <span>{item.title}</span>
      </div>
      {item.content && <p className="text-[11px] text-d4-muted leading-relaxed">{item.content}</p>}

      {waiting && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {profiles.map((profile) => {
              const active = picked === profile.id;
              return (
                <button
                  key={profile.id}
                  onClick={() => setPicked(profile.id)}
                  className={`text-left rounded-lg p-1.5 transition-all border ${
                    active
                      ? 'border-d4-accent ring-1 ring-d4-accent/50'
                      : 'border-d4-border hover:border-d4-dimmed'
                  }`}
                >
                  <StylePreview profile={profile} language={language} />
                  <div className="px-1 pt-2 pb-0.5">
                    <div className="text-[11px] font-semibold text-d4-text flex items-center gap-1.5">
                      {active && <Check className="w-3 h-3 text-d4-accent" />}
                      {profile.label[language]}
                      {recommended === profile.id && (
                        <span className="ml-auto shrink-0 rounded-full bg-d4-accent/15 text-d4-accent text-[9px] font-semibold px-1.5 py-[1px]">
                          {t('agent.aiRecommended')}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-d4-dimmed leading-snug mt-0.5">
                      {profile.summary[language]}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {reason && (
            <p className="text-[10px] text-d4-muted leading-snug border-l-2 border-d4-accent/40 pl-2">{reason}</p>
          )}

          <button
            onClick={() => void chooseDesignStyle(picked)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-d4-accent text-black text-[11px] font-semibold hover:brightness-110 transition-all"
          >
            <Check className="w-3.5 h-3.5" />
            {t('agent.useStyle', { style: selected.label[language] })}
          </button>
        </>
      )}

      {!waiting && (
        <div className="text-[10px] text-d4-dimmed">{t('agent.styleChosen')}</div>
      )}
    </div>
  );
};

/**
 * The question card.
 *
 * The agent stops here and waits, so this is the one card the user must be able
 * to answer without reading instructions. Questions arrive **one at a time**:
 * a stack of four question blocks with four sets of options is a form nobody
 * reads to the end, and the answers to later questions often depend on the one
 * before. So the card walks them: pick, next, pick, next, and only on the last
 * one does a single button send everything.
 *
 * After sending, the card keeps only the answers — what the model was told, in
 * the user's own words, so reopening the session shows what was decided rather
 * than the questions all over again.
 */
const QuestionCard: React.FC<{ item: AgentTimelineItem; waiting: boolean }> = ({ item, waiting }) => {
  const { t } = useTranslation();
  const answerQuestions = useAgentStore((state) => state.answerQuestions);
  const language = (item.details?.language === 'th' ? 'th' : 'en') as 'th' | 'en';
  const questions = (item.details?.questions || []) as AgentQuestion[];
  /** The answer as sent, or as replayed from the transcript on reopen. */
  const answered = (item.details?.answer || null) as QuestionAnswer | null;

  const [picks, setPicks] = useState<Record<number, string[]>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  /** Which question is on screen; the card shows one at a time. */
  const [step, setStep] = useState(0);
  /** Set the moment this window sends an answer, so the card settles at once. */
  const [result, setResult] = useState<QuestionAnswer | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const answeredNow = questions.map((_, index) => ({
    selected: picks[index] || [],
    note: (notes[index] || '').trim()
  }));
  const isAnswered = (index: number) =>
    !!answeredNow[index] && (answeredNow[index].selected.length > 0 || !!answeredNow[index].note);
  const answeredCount = questions.filter((_, index) => isAnswered(index)).length;
  const ready = questions.length > 0 && questions.every((_, index) => isAnswered(index));
  const current = questions[Math.min(step, Math.max(0, questions.length - 1))];
  const currentIndex = Math.min(step, Math.max(0, questions.length - 1));
  const isLast = currentIndex >= questions.length - 1;

  const toggle = (index: number, label: string, multiSelect: boolean) => {
    setPicks((prev) => {
      const current = prev[index] || [];
      if (multiSelect) {
        return { ...prev, [index]: current.includes(label) ? current.filter((v) => v !== label) : [...current, label] };
      }
      return { ...prev, [index]: [label] };
    });
  };

  /**
   * Moving on.
   *
   * "Next" only needs this question answered — a later answer can still change
   * an earlier pick, so the user is never trapped in a question they answered
   * to fix an earlier one. The send button, at the end, needs all of them.
   */
  const goNext = () => {
    if (!isAnswered(currentIndex)) return;
    if (isLast) void submit();
    else setStep(currentIndex + 1);
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    const answer: QuestionAnswer = {
      answers: questions.map((question, index) => ({
        question: question.question,
        selected: answeredNow[index].selected,
        ...(answeredNow[index].note ? { note: answeredNow[index].note } : {})
      }))
    };
    setResult(answer);
    await answerQuestions(answer);
    setSubmitting(false);
  };

  const skip = async () => {
    if (submitting) return;
    setSubmitting(true);
    const answer: QuestionAnswer = { answers: [], skipped: true };
    setResult(answer);
    await answerQuestions(answer);
    setSubmitting(false);
  };

  // The answer this window sent, or the one replayed from the transcript.
  const shown = result ?? answered;
  const settled = !!shown;

  return (
    <div className="rounded-lg border border-violet-400/35 bg-violet-400/[0.06] p-3.5 space-y-3">
      {/*
       * "<app> has 4 questions", then which one is on screen and the two arrows
       * that move between them. The count belongs in the title because the first
       * thing anyone wants to know about a set of questions is how many there
       * are — the dots it replaced answered that only after being counted.
       */}
      <div className="flex items-center gap-2 text-violet-300 text-[12px] font-semibold">
        <HelpCircle className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">
          {t('agent.questionsTitle', { app: t('app.name'), count: questions.length })}
        </span>
        {!settled && questions.length > 1 && (
          <div className="ml-auto shrink-0 flex items-center gap-1 text-[10px] font-normal text-d4-muted">
            <button
              type="button"
              onClick={() => setStep(Math.max(0, currentIndex - 1))}
              disabled={currentIndex === 0}
              title={t('agent.questionBack')}
              className="d4-icon-button w-5 h-5 disabled:opacity-30"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span>{t('agent.questionStep', { current: currentIndex + 1, total: questions.length })}</span>
            <button
              type="button"
              onClick={() => setStep(Math.min(questions.length - 1, currentIndex + 1))}
              disabled={currentIndex >= questions.length - 1}
              title={t('agent.questionNext')}
              className="d4-icon-button w-5 h-5 disabled:opacity-30"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
      {item.content && <p className="text-[11px] text-d4-muted leading-relaxed">{item.content}</p>}

      {/* -------------------------------------------------- the answers, once sent */}
      {settled && (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-violet-300/80 font-semibold">
            {t('agent.questionSummary')}
          </div>
          {shown?.skipped || (shown?.answers?.length ?? 0) === 0 ? (
            <p className="text-[11px] text-d4-muted leading-relaxed">{t('agent.questionSkipped')}</p>
          ) : (
            <div className="space-y-1">
              {(shown?.answers ?? []).map((entry, index) => {
                const picked = entry.selected.length > 0 ? entry.selected.join(', ') : '';
                return (
                  <div
                    key={`${item.id}_a${index}`}
                    className="rounded-md border border-d4-border-subtle bg-d4-panel/70 px-2.5 py-1.5"
                  >
                    <div className="text-[10px] text-d4-dimmed leading-snug">{entry.question}</div>
                    <div className="text-[11px] text-d4-text font-medium leading-snug">
                      {picked || t('agent.questionNoAnswer')}
                    </div>
                    {entry.note && (
                      <div className="text-[10px] text-d4-muted leading-snug mt-0.5">
                        {t('agent.questionYourNote')}: {entry.note}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="text-[10px] text-d4-dimmed">{t('agent.questionAnswered')}</div>
        </div>
      )}

      {/* ------------------------------------------- one question at a time */}
      {!settled && current && (
        <div className="space-y-2.5">
          {/* How far along the set is, so "how much more of this is there" is
              visible before the first click. */}
          {questions.length > 1 && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                {questions.map((_, index) => (
                  <button
                    key={`${item.id}_dot${index}`}
                    onClick={() => setStep(index)}
                    title={t('agent.questionStep', { current: index + 1, total: questions.length })}
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${
                      index === currentIndex
                        ? 'bg-violet-300'
                        : isAnswered(index)
                          ? 'bg-violet-400/60'
                          : 'bg-d4-border'
                    }`}
                  />
                ))}
              </div>
              <span className="text-[10px] text-d4-dimmed">
                {t('agent.questionProgress', { done: answeredCount, total: questions.length })}
              </span>
            </div>
          )}

          <div className="rounded-md border border-d4-border-subtle bg-d4-panel/70 p-2.5 space-y-2">
            <div className="flex items-start gap-2">
              <span className="shrink-0 mt-[1px] w-4 h-4 rounded-full bg-violet-400/20 text-violet-200 text-[10px] font-semibold flex items-center justify-center">
                {currentIndex + 1}
              </span>
              <div className="min-w-0">
                {current.header && (
                  <div className="text-[10px] uppercase tracking-wide text-violet-300/80 font-semibold">
                    {current.header}
                  </div>
                )}
                <div className="text-[12px] text-d4-text leading-snug">{current.question}</div>
                {current.options.length > 0 && (
                  <div className="text-[10px] text-d4-dimmed mt-0.5">
                    {current.multiSelect ? t('agent.questionPickMany') : t('agent.questionPickOne')}
                  </div>
                )}
              </div>
            </div>

            {current.options.length > 0 && (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {current.options.map((option) => {
                  const active = (picks[currentIndex] || []).includes(option.label);
                  return (
                    <button
                      key={option.label}
                      onClick={() => toggle(currentIndex, option.label, !!current.multiSelect)}
                      className={`text-left px-2.5 py-1.5 rounded border transition-colors ${
                        active
                          ? 'border-d4-accent bg-d4-accent/10 text-d4-text'
                          : 'border-d4-border text-d4-muted hover:border-d4-dimmed'
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                        {active && <Check className="w-3 h-3 text-d4-accent shrink-0" />}
                        <span>{option.label}</span>
                        {option.recommended && (
                          <span className="ml-auto shrink-0 rounded-full bg-d4-accent/15 text-d4-accent text-[9px] font-semibold px-1.5 py-[1px]">
                            {t('agent.aiRecommended')}
                          </span>
                        )}
                      </span>
                      {option.description && (
                        <span className="block text-[10px] text-d4-dimmed leading-snug mt-0.5">
                          {option.description}
                        </span>
                      )}
                      {option.recommended && option.reason && (
                        <span className="block text-[10px] text-d4-accent/80 leading-snug mt-0.5 border-l-2 border-d4-accent/40 pl-1.5">
                          {option.reason}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* The AI's overall lean, shown while the card is answerable —
                after the answer is sent the summary already tells the story. */}
            {waiting && current.aiSuggestion && (
              <p className="text-[10px] text-d4-muted leading-snug border-l-2 border-d4-accent/40 pl-2">
                {current.aiSuggestion}
              </p>
            )}

            {current.options.length === 0 && (
              <div className="text-[10px] text-d4-dimmed">{t('agent.questionFreeText')}</div>
            )}

            <input
              value={notes[currentIndex] || ''}
              onChange={(event) => setNotes((prev) => ({ ...prev, [currentIndex]: event.target.value }))}
              onKeyDown={(event) => {
                // Enter moves on, exactly like the button — the card is answered
                // from the keyboard when the options are not the answer.
                if (event.key === 'Enter') {
                  event.preventDefault();
                  goNext();
                }
              }}
              placeholder={t('agent.questionNotePlaceholder')}
              className="w-full bg-d4-bg border border-d4-border rounded px-2 py-1.5 text-[11px] text-d4-text focus:outline-none focus:border-d4-accent"
            />
          </div>

          {waiting ? (
            <div className="flex flex-wrap items-center gap-2">
              {currentIndex > 0 && (
                <button
                  onClick={() => setStep(currentIndex - 1)}
                  disabled={submitting}
                  className="px-3 py-2 rounded-md border border-d4-border text-d4-muted text-[11px] hover:text-d4-text transition-colors disabled:opacity-40"
                >
                  {t('agent.questionBack')}
                </button>
              )}
              <button
                onClick={goNext}
                disabled={!isAnswered(currentIndex) || submitting || (isLast && !ready)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-md text-[11px] font-semibold transition-all disabled:opacity-40 ${
                  isLast
                    ? 'bg-d4-accent text-black hover:brightness-110 disabled:hover:brightness-100'
                    : 'border border-d4-accent/50 text-d4-accent hover:bg-d4-accent/10'
                }`}
              >
                {isLast ? <Send className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
                <span>{isLast ? t('agent.questionSubmit') : t('agent.questionNext')}</span>
              </button>
              <button
                onClick={() => void skip()}
                disabled={submitting}
                className="px-3 py-2 rounded-md text-d4-dimmed text-[11px] hover:text-d4-text transition-colors disabled:opacity-40"
              >
                {t('agent.questionSkip')}
              </button>
              {!isAnswered(currentIndex) && (
                <span className="text-[10px] text-d4-dimmed">{t('agent.questionNeedAll')}</span>
              )}
            </div>
          ) : (
            <div className="text-[10px] text-d4-dimmed">{t('agent.questionClosed')}</div>
          )}
        </div>
      )}

      {!settled && !current && (
        <div className="text-[10px] text-d4-dimmed">{t('agent.questionClosed')}</div>
      )}
    </div>
  );
};

/**
 * The plan card.
 *
 * Approving a plan is not a single yes: the user chooses how far the agent may
 * run before it stops and asks again (spec §35). The choice is on the card
 * itself, next to the plan it applies to, so "approve" never has to be guessed
 * at — full run, step by step, or first step only. Sending the plan back with a
 * note is a third answer, so the run does not have to be cancelled to be
 * changed.
 */
const PlanCard: React.FC<{ item: AgentTimelineItem; waiting: boolean }> = ({ item, waiting }) => {
  const { t } = useTranslation();
  const approvePlan = useAgentStore((state) => state.approvePlan);
  const revisePlan = useAgentStore((state) => state.revisePlan);
  const rejectPlan = useAgentStore((state) => state.rejectPlan);
  const [scope, setScope] = useState<PlanScope>('full');
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState('');

  const options: { id: PlanScope; hint: string }[] = [
    { id: 'full', hint: t('agent.scopeFullHint') },
    { id: 'step', hint: t('agent.scopeStepHint') },
    { id: 'first', hint: t('agent.scopeFirstHint') }
  ];

  return (
    <div key={item.id} className="rounded-md border border-amber-500/30 bg-amber-500/[0.07] p-3 space-y-2">
      <div className="flex items-center gap-2 text-amber-400 text-[12px] font-semibold">
        <Sparkles className="w-3.5 h-3.5" />
        <span>{item.title}</span>
      </div>
      <div className="text-[12px] leading-relaxed text-d4-text">
        <Markdown text={item.content || ''} />
      </div>

      {waiting && (
        <div className="space-y-2 pt-1">
          <div className="text-[10px] uppercase font-semibold tracking-wide text-amber-400/80">
            {t('agent.scopeTitle')}
          </div>

          {!revising && (
            <div className="grid gap-1.5">
              {options.map((option) => (
                <button
                  key={option.id}
                  onClick={() => setScope(option.id)}
                  className={`text-left px-2.5 py-1.5 rounded border transition-colors ${
                    scope === option.id
                      ? 'border-d4-accent bg-d4-accent/10 text-d4-text'
                      : 'border-d4-border text-d4-muted hover:border-d4-dimmed'
                  }`}
                >
                  <span className="text-[11px] font-semibold">{t(`agent.scope_${option.id}`)}</span>
                  <span className="block text-[10px] text-d4-dimmed">{option.hint}</span>
                </button>
              ))}
            </div>
          )}

          {revising && (
            <textarea
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              rows={3}
              autoFocus
              placeholder={t('agent.revisePlaceholder')}
              className="w-full bg-d4-bg border border-d4-border rounded px-2.5 py-2 text-[11px] text-d4-text resize-none focus:outline-none focus:border-d4-accent"
            />
          )}

          <div className="flex flex-wrap items-center gap-2">
            {revising ? (
              <>
                <button
                  onClick={() => {
                    void revisePlan(feedback.trim());
                    setRevising(false);
                    setFeedback('');
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-d4-accent text-black text-[11px] font-semibold hover:brightness-110 transition-all"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{t('agent.reviseSend')}</span>
                </button>
                <button
                  onClick={() => setRevising(false)}
                  className="px-3 py-1.5 rounded-md border border-d4-border text-[11px] text-d4-muted hover:text-d4-text"
                >
                  {t('agent.scopeTitleCancel')}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => void approvePlan(scope)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-d4-success text-black text-[11px] font-semibold hover:brightness-110 transition-all"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{t(`agent.scopeApprove_${scope}`)}</span>
                </button>
                <button
                  onClick={() => setRevising(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-d4-border text-d4-muted text-[11px] hover:text-d4-text transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{t('agent.revisePlan')}</span>
                </button>
                <button
                  onClick={() => void rejectPlan()}
                  className="px-3 py-1.5 rounded-md bg-d4-error/15 text-d4-error border border-d4-error/30 text-[11px] hover:bg-d4-error/25 transition-colors"
                >
                  {t('agent.cancelPlan')}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * The gate between build steps when the plan was approved step-by-step. Three
 * answers, deliberately: one more step, the rest of the plan, or stop where it
 * is — "stop" is offered here so the user never has to cancel a run to end it.
 */
const StepGateCard: React.FC<{ item: AgentTimelineItem; waiting: boolean }> = ({ item, waiting }) => {
  const { t } = useTranslation();
  const planStepDecision = useAgentStore((state) => state.planStepDecision);

  return (
    <div key={item.id} className="rounded-md border border-sky-500/30 bg-sky-500/[0.07] p-3 space-y-2">
      <div className="flex items-center gap-2 text-sky-300 text-[12px] font-semibold">
        <Clock className="w-3.5 h-3.5" />
        <span>{item.title}</span>
      </div>
      {item.content && <div className="text-[11px] text-d4-muted leading-relaxed">{item.content}</div>}

      {waiting && (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <button
            onClick={() => void planStepDecision('continue')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-d4-success text-black text-[11px] font-semibold hover:brightness-110 transition-all"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{t('agent.stepNext')}</span>
          </button>
          <button
            onClick={() => void planStepDecision('runAll')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-d4-border text-d4-muted text-[11px] hover:text-d4-text transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{t('agent.stepRunAll')}</span>
          </button>
          <button
            onClick={() => void planStepDecision('stop')}
            className="px-3 py-1.5 rounded-md bg-d4-error/15 text-d4-error border border-d4-error/30 text-[11px] hover:bg-d4-error/25 transition-colors"
          >
            {t('agent.stepStop')}
          </button>
        </div>
      )}
    </div>
  );
};

export const AgentTimeline: React.FC = () => {
  const { t } = useTranslation();
  const { timeline, todos, status, mission } = useAgentStore();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [collapsedRuns, setCollapsedRuns] = useState<Record<string, boolean>>({});
  const [follow, setFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const nodes = useMemo(() => buildNodes(timeline), [timeline]);
  const lastRunId = useMemo(() => lastRunIdOf(nodes), [nodes]);
  // Only the newest ask is answerable: earlier cards stay visible as history but
  // must not offer buttons that would answer a question already decided. One id
  // covers every kind of ask, because a question asked after a plan is the only
  // thing the run is waiting on — the plan behind it is no longer live.
  const lastAskId = useMemo(() => {
    for (let i = timeline.length - 1; i >= 0; i--) {
      const type = timeline[i].type;
      if (type === 'plan' || type === 'design' || type === 'question') return timeline[i].id;
    }
    return null;
  }, [timeline]);

  // Follow the work while it happens; stop the moment the reader scrolls up.
  useEffect(() => {
    if (follow) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [timeline.length, follow]);

  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const runIsOpen = (node: Extract<Node, { kind: 'run' }>) => {
    const explicit = collapsedRuns[node.id];
    if (explicit !== undefined) return !explicit;
    return defaultRunOpen(node, lastRunId);
  };

  const details = (row: StepRow) => {
    const call = row.item.toolCall;
    const output = row.result?.content ?? row.item.content;
    return (
      <div className="mx-1.5 mb-1 rounded-sm border border-d4-border-subtle bg-d4-panel overflow-hidden">
        {call?.args && (
          <pre className="px-2.5 py-2 text-[11px] font-mono text-d4-muted whitespace-pre-wrap break-all border-b border-d4-border-subtle">
            {JSON.stringify(call.args, null, 2)}
          </pre>
        )}
        {output && (
          <pre className="px-2.5 py-2 text-[11px] font-mono text-d4-dimmed whitespace-pre-wrap break-all max-h-72 overflow-y-auto">
            {output}
          </pre>
        )}
        {row.result?.imagePath && <ScreenshotThumb relativePath={row.result.imagePath} />}
      </div>
    );
  };

  const stepRow = (row: StepRow) => {
    const item = row.item;

    // A reasoning item is a step too — one line, expandable.
    if (item.type === 'thinking') {
      const isOpen = !!expanded[item.id];
      return (
        <div key={item.id}>
          <button
            onClick={() => toggle(item.id)}
            className="group w-full flex items-center gap-2 px-1.5 py-[3px] rounded-sm text-left hover:bg-d4-panel transition-colors"
          >
            <span className="shrink-0 w-[54px] text-[11px] text-d4-muted">
              {item.status === 'running' ? t('agent.verb_thinking') : t('agent.verb_thought')}
            </span>
            <span className="flex-1 min-w-0 truncate text-[11px] italic text-d4-dimmed">
              {item.content || item.title}
            </span>
            <ChevronRight
              className={`w-3 h-3 shrink-0 text-d4-dimmed transition-transform ${isOpen ? 'rotate-90' : ''} opacity-0 group-hover:opacity-70`}
            />
          </button>
          {isOpen && (
            <div className="mx-1.5 mb-1 px-2.5 py-2 rounded-sm border border-d4-border-subtle bg-d4-panel text-[11px] italic text-d4-muted whitespace-pre-wrap">
              {item.content || item.title}
            </div>
          )}
        </div>
      );
    }

    const name = item.toolCall?.name || item.title;
    const isOpen = !!expanded[item.id];
    const running = item.status === 'running' && !row.result;
    const failed = row.result ? row.result.status === 'failed' : item.status === 'failed';

    return (
      <div key={item.id}>
        <button
          onClick={() => toggle(item.id)}
          className="group w-full flex items-center gap-2 px-1.5 py-[3px] rounded-sm text-left hover:bg-d4-panel transition-colors"
        >
          <span className="shrink-0 flex items-center gap-1.5 w-[54px] text-[11px] text-d4-muted">
            <StepVerbIcon name={name} />
            <span>{t(verbKeyFor(name))}</span>
          </span>
          <span className="flex-1 min-w-0 truncate font-mono text-[11px] text-d4-dimmed">{targetFor(item)}</span>
          {item.agent && <RoleTag role={item.agent} />}
          <span className="shrink-0 flex items-center gap-1 text-[10px]">
            {running ? (
              <Loader2 className="w-3 h-3 text-d4-accent animate-spin" />
            ) : failed ? (
              <>
                <XCircle className="w-3 h-3 text-d4-error" />
                <span className="text-d4-error">{t('agent.failed')}</span>
              </>
            ) : (
              <>
                <Check className="w-3 h-3 text-d4-dimmed" />
                <span className="text-d4-dimmed">{t('agent.success')}</span>
              </>
            )}
          </span>
          <ChevronRight
            className={`w-3 h-3 shrink-0 text-d4-dimmed transition-transform ${isOpen ? 'rotate-90' : ''} opacity-0 group-hover:opacity-70`}
          />
        </button>
        {isOpen && details(row)}
      </div>
    );
  };

  const renderNode = (node: Node) => {
    if (node.kind === 'run') {
      const open = runIsOpen(node);
      const failed = node.rows.some((row) => (row.result ?? row.item).status === 'failed');
      return (
        <div key={node.id} className="space-y-px">
          <button
            onClick={() => setCollapsedRuns((prev) => ({ ...prev, [node.id]: open }))}
            className="flex items-center gap-1.5 px-1.5 py-[3px] rounded-sm text-[11px] text-d4-dimmed hover:text-d4-text hover:bg-d4-panel transition-colors"
          >
            {node.running ? (
              <Play className="w-3 h-3 text-d4-accent" />
            ) : failed ? (
              <XCircle className="w-3 h-3 text-d4-error" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            <span>{t('agent.runLabel')}</span>
            <span className="font-mono opacity-70">
              · {t('agent.runSteps', { count: node.rows.length })}
            </span>
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
          {open && <div className="space-y-px">{node.rows.map(stepRow)}</div>}
        </div>
      );
    }

    const item = node.item;

    if (node.kind === 'design') {
      return (
        <DesignCard key={item.id} item={item} waiting={item.id === lastAskId && status === 'waiting_approval'} />
      );
    }

    if (node.kind === 'question') {
      return (
        <QuestionCard key={item.id} item={item} waiting={item.id === lastAskId && status === 'waiting_approval'} />
      );
    }

    if (node.kind === 'plan') {
      const isGate = item.details?.kind === 'step_gate';
      if (isGate) {
        return (
          <StepGateCard key={item.id} item={item} waiting={item.id === lastAskId && status === 'paused'} />
        );
      }
      return (
        <PlanCard key={item.id} item={item} waiting={item.id === lastAskId && status === 'waiting_approval'} />
      );
    }

    if (node.kind === 'summary') {
      // The end-of-run file card renders like a changes panel: one row per
      // file, the change marker dimmed, additions green, deletions red. The
      // rows come through as data (details.files), not text to re-parse.
      if (item.id.startsWith('files_changed_')) {
        const files = (item.details?.files || []) as Array<{
          path: string;
          type: FileChange['type'];
          additions: number;
          deletions: number;
        }>;
        return (
          <div key={item.id} className="rounded-md border border-d4-border-subtle bg-d4-panel/60 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-d4-border-subtle text-[12px] font-semibold text-d4-text">
              <FileCode className="w-3.5 h-3.5 text-d4-accent" />
              <span>{item.title}</span>
            </div>
            <div className="px-3 py-2 space-y-0.5">
              {files.map((file) => (
                <div key={`${item.id}_${file.path}`} className="flex items-center gap-2 text-[11px] leading-snug">
                  <span className="w-3 shrink-0 text-d4-dimmed" title={file.type}>
                    {file.type === 'created' ? 'A' : file.type === 'deleted' ? 'D' : 'M'}
                  </span>
                  <span className="flex-1 min-w-0 truncate font-mono text-d4-muted">{file.path}</span>
                  {file.additions > 0 && <span className="shrink-0 text-emerald-400">+{file.additions}</span>}
                  {file.deletions > 0 && <span className="shrink-0 text-red-400">−{file.deletions}</span>}
                </div>
              ))}
            </div>
          </div>
        );
      }
      return (
        <div key={item.id} className="rounded-md border border-emerald-500/25 bg-emerald-500/[0.06] p-3">
          <div className="flex items-center gap-2 text-emerald-400 text-[12px] font-semibold mb-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{item.title}</span>
          </div>
          <div className="text-[12px] leading-relaxed text-d4-muted">
            <Markdown text={item.content || ''} />
          </div>
        </div>
      );
    }

    if (node.kind === 'error') {
      return (
        <div key={item.id} className="rounded-md border border-red-500/25 bg-red-500/[0.06] p-3 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-red-400">{item.title}</div>
            <div className="mt-1 text-[11px] text-d4-muted whitespace-pre-wrap">{item.content}</div>
          </div>
        </div>
      );
    }

    if (node.kind === 'subagent') {
      const role = (item.agent || 'explore') as SubagentRole;
      const running = item.status === 'running';
      const open = expanded[item.id] ?? running;
      return (
        <div key={item.id} className="rounded-md border border-d4-border-subtle bg-d4-panel overflow-hidden">
          <button
            onClick={() => toggle(item.id)}
            className="w-full flex items-center justify-between gap-2 px-2.5 py-2 hover:bg-d4-surface/40 transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Users className="w-3.5 h-3.5 text-d4-accent shrink-0" />
              <RoleTag role={role} />
              <span className="truncate text-[12px] text-d4-text">
                {running ? t('agent.subagentRunning') : t('agent.subagentDone')}
              </span>
              {running && <span className="text-[10px] text-d4-accent animate-pulse">{t('agent.running')}</span>}
            </div>
            {open ? <ChevronDown className="w-3.5 h-3.5 text-d4-dimmed" /> : <ChevronRight className="w-3.5 h-3.5 text-d4-dimmed" />}
          </button>
          {open && (
            <div className="border-t border-d4-border-subtle px-2.5 py-2 space-y-2">
              <div className="text-[11px] text-d4-muted whitespace-pre-wrap">{item.content}</div>
              {!running && item.details?.report && (
                <div className="text-[11px] text-d4-text whitespace-pre-wrap leading-relaxed border-t border-d4-border-subtle pt-2">
                  {item.details.report}
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    // Message: the user gets a bubble on the right, the agent answers in prose.
    // A turn that started from a /command shows the small bold chip, matching
    // the composer — the command's boilerplate is not re-printed as the user's
    // words.
    if (item.title === 'User Prompt') {
      const content = item.content || '';
      const chip = commandChipFor(content);
      return (
        <div key={item.id} id={`turn-${item.id}`} data-turn-id={item.id} className="flex flex-col items-end gap-1 pt-2">
          {chip && (
            <span className="inline-flex items-center rounded border border-d4-accent/50 bg-d4-accent/10 px-1.5 py-[1px] text-[10px] font-bold text-d4-accent">
              /{chip.id}
            </span>
          )}
          <div className="d4-user-bubble max-w-[85%] rounded-2xl rounded-br-md bg-d4-bubble border border-d4-border px-3.5 py-2 text-[13px] leading-relaxed text-d4-bubble-text">
            {/* A command chip carries boilerplate, not prose — keep it verbatim. */}
            {chip ? (
              <span className="whitespace-pre-wrap">{chip.detail || item.content}</span>
            ) : (
              <Markdown text={content} />
            )}
          </div>
        </div>
      );
    }

    return (
      <div key={item.id} className="text-[13px] leading-relaxed text-d4-text">
        <Markdown text={item.content || ''} />
      </div>
    );
  };

  const busy = status === 'running' || status === 'planning' || status === 'waiting_approval';
  /*
   * The goal card is about a mission, so it appears when there is one. A session
   * with no goal shows nothing while it sits idle — a permanent "0 / 4" panel on
   * every new conversation was furniture, not information. While a run is in
   * flight the card stays: progress is what the user is waiting on.
   */
  const showGoalCard = todos.length > 0 && (!!mission?.objective || busy);

  return (
    <div
      ref={scrollRef}
      onScroll={() => {
        const el = scrollRef.current;
        if (!el) return;
        setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
      }}
      className="d4-transcript flex-1 overflow-y-auto font-sans select-text relative"
    >
      {/*
       * The transcript is a centred column, not a full-width wall: at 1400px a
       * line of prose stretched across the window is unreadable, and every
       * message in this app is read. The reference client reads the same way —
       * one column in the middle, the panels on either side of it.
       */}
      <div className="mx-auto w-full max-w-[760px] px-5 py-5 space-y-1.5">
        {showGoalCard && (
          <div className="rounded-md border border-d4-border-subtle bg-d4-panel px-3 py-2.5">
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-d4-dimmed mb-1.5">
              <span>{mission?.objective ? t('agent.goalTitle') : t('agent.todosTitle')}</span>
              <span className="font-mono text-d4-accent">
                {todos.filter((todo) => todo.status === 'completed').length} / {todos.length}
              </span>
            </div>
            <div className="space-y-1">
              {todos.map((todo: AgentTodo) => (
                <div key={todo.id} className="flex items-center gap-2 text-[12px]">
                  {todo.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-d4-success shrink-0" />}
                  {todo.status === 'in_progress' && <Clock className="w-3.5 h-3.5 text-d4-accent shrink-0" />}
                  {todo.status === 'pending' && <div className="w-3.5 h-3.5 rounded-full border border-d4-dimmed shrink-0" />}
                  {todo.status === 'failed' && <XCircle className="w-3.5 h-3.5 text-d4-error shrink-0" />}
                  <span className={todo.status === 'completed' ? 'line-through text-d4-dimmed' : 'text-d4-text'}>
                    {todo.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {timeline.length === 0 && (
          <div className="min-h-[58vh] flex flex-col items-center justify-center text-center gap-4 py-10">
            <div className="w-12 h-12 rounded-lg bg-d4-accent flex items-center justify-center text-black font-bold text-base">
              D4
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold text-d4-text">{t('agent.emptyTitle')}</h2>
              <p className="max-w-md text-[12px] leading-relaxed text-d4-dimmed">{t('agent.emptyBody')}</p>
            </div>
            <ProjectStarterChips />
            <p className="text-[10px] text-d4-dimmed">{t('agent.emptyHint')}</p>
          </div>
        )}

        {nodes.map(renderNode)}
        {timeline.length > 0 && <FollowUpChips />}
        {timeline.length > 0 && <FeedbackLink />}
        <div ref={bottomRef} className="h-1" />
      </div>
      <RespondingPill />

      {!follow && timeline.length > 0 && (
        <button
          onClick={() => {
            setFollow(true);
            bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
          }}
          className="sticky bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-d4-panel border border-d4-border text-[11px] text-d4-muted hover:text-d4-text shadow-lg transition-colors"
        >
          <ArrowDown className="w-3 h-3" />
          <span>{busy ? t('agent.followLive') : t('agent.jumpToEnd')}</span>
        </button>
      )}
    </div>
  );
};
