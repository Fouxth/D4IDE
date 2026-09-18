import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Terminal,
  FileCode,
  FileEdit,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
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
  MessageSquareHeart
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../stores/agentStore';
import { useProjectStore } from '../../stores/projectStore';
import { AgentTimelineItem, AgentTodo, PlanScope, SubagentRole } from '../../../shared/types';
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
  const [picked, setPicked] = useState<Exclude<DesignStyle, 'ask'>>('minimal');
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
                    </div>
                    <div className="text-[10px] text-d4-dimmed leading-snug mt-0.5">
                      {profile.summary[language]}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

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
      <pre className="text-[12px] leading-relaxed text-d4-text whitespace-pre-wrap font-sans">{item.content}</pre>

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
  const { timeline, todos, status } = useAgentStore();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [collapsedRuns, setCollapsedRuns] = useState<Record<string, boolean>>({});
  const [follow, setFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const nodes = useMemo(() => buildNodes(timeline), [timeline]);
  const lastRunId = useMemo(() => lastRunIdOf(nodes), [nodes]);
  // Only the newest ask is answerable: earlier cards stay visible as history but
  // must not offer buttons that would answer a question already decided.
  const lastPlanId = useMemo(() => [...timeline].reverse().find((entry) => entry.type === 'plan')?.id, [timeline]);
  const lastDesignId = useMemo(
    () => [...timeline].reverse().find((entry) => entry.type === 'design')?.id,
    [timeline]
  );

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
      const isLast = item.id === lastDesignId;
      return <DesignCard key={item.id} item={item} waiting={isLast && status === 'waiting_approval'} />;
    }

    if (node.kind === 'plan') {
      const isGate = item.details?.kind === 'step_gate';
      const isLast = item.id === lastPlanId;
      if (isGate) {
        return <StepGateCard key={item.id} item={item} waiting={isLast && status === 'paused'} />;
      }
      return <PlanCard key={item.id} item={item} waiting={isLast && status === 'waiting_approval'} />;
    }

    if (node.kind === 'summary') {
      return (
        <div key={item.id} className="rounded-md border border-emerald-500/25 bg-emerald-500/[0.06] p-3">
          <div className="flex items-center gap-2 text-emerald-400 text-[12px] font-semibold mb-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{item.title}</span>
          </div>
          <pre className="text-[12px] leading-relaxed text-d4-muted whitespace-pre-wrap font-sans">{item.content}</pre>
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
    if (item.title === 'User Prompt') {
      return (
        <div key={item.id} id={`turn-${item.id}`} data-turn-id={item.id} className="flex justify-end pt-2">
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-d4-surface border border-d4-border px-3.5 py-2 text-[13px] leading-relaxed text-d4-text whitespace-pre-wrap">
            {item.content}
          </div>
        </div>
      );
    }

    return (
      <div key={item.id} className="text-[13px] leading-relaxed text-d4-text whitespace-pre-wrap">
        {item.content}
      </div>
    );
  };

  const busy = status === 'running' || status === 'planning' || status === 'waiting_approval';

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
      <div className="w-full px-4 py-4 space-y-1.5">
        {todos.length > 0 && (
          <div className="rounded-md border border-d4-border-subtle bg-d4-panel px-3 py-2.5">
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-d4-dimmed mb-1.5">
              <span>{t('agent.todosTitle')}</span>
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
            <div className="flex flex-wrap items-center justify-center gap-2 max-w-xl">
              {(['suggestion1', 'suggestion2', 'suggestion3', 'suggestion4'] as const).map((key) => (
                <button
                  key={key}
                  onClick={() => useAgentStore.getState().setPrompt(t(`agent.${key}`))}
                  className="px-3 py-1.5 rounded-full bg-d4-panel border border-d4-border text-[11px] text-d4-muted hover:text-d4-text hover:border-d4-accent/50 transition-colors"
                >
                  {t(`agent.${key}`)}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-d4-dimmed">{t('agent.emptyHint')}</p>
          </div>
        )}

        {nodes.map(renderNode)}
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
