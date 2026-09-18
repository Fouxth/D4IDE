import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Loader2, TriangleAlert, XCircle, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../stores/agentStore';
import { targetFor, verbKeyFor } from './step-labels';

/**
 * The conversation outline (spec §6).
 *
 * A long run is hundreds of steps deep, and the transcript is the only place
 * that work is recorded — so the strip beside the chat lists every turn the user
 * started, marks the state each one ended in, and jumps the transcript to it on
 * click. It is deliberately text-only: one line per turn, no previews, no
 * second copy of the timeline.
 */
interface Turn {
  id: string;
  text: string;
  index: number;
  status: 'active' | 'done' | 'failed' | 'cancelled';
  steps: number;
  /** The last tool this turn ran, so the row can say "12 steps · Edit src/app.ts". */
  lastTool: string | null;
  lastArg: string | null;
}

export const ConversationMap: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  const { t } = useTranslation();
  const { timeline, status } = useAgentStore();
  const [spied, setSpied] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const turns = useMemo<Turn[]>(() => {
    const collected: Turn[] = [];
    for (const item of timeline) {
      if (item.title === 'User Prompt' && item.type === 'message') {
        collected.push({
          id: item.id,
          text: (item.content || '').replace(/\s+/g, ' ').trim(),
          index: collected.length + 1,
          status: 'done',
          steps: 0,
          lastTool: null,
          lastArg: null
        });
        continue;
      }
      const current = collected[collected.length - 1];
      if (!current) continue;
      if (item.type === 'tool_call' || item.type === 'tool_result') {
        current.steps += item.type === 'tool_call' ? 1 : 0;
        // The row reads like the transcript row it came from: verb + target.
        if (item.toolCall?.name) {
          current.lastTool = item.toolCall.name;
          current.lastArg = targetFor(item);
        }
        if (item.status === 'failed') current.status = 'failed';
        else if (item.status === 'cancelled') current.status = 'cancelled';
      } else if (item.type === 'error') {
        current.status = 'failed';
      }
    }
    return collected;
  }, [timeline]);

  const isBusy = status === 'running' || status === 'planning' || status === 'waiting_approval';
  const lastTurnId = turns[turns.length - 1]?.id ?? null;
  const highlighted = spied ?? lastTurnId;

  /**
   * Scroll-spy the transcript. Scroll events do not bubble, but they do
   * propagate down in the capture phase — which is how a nested scroll
   * container can be watched from here without a ref to it.
   */
  useEffect(() => {
    const onScroll = () => {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-turn-id]'));
      if (nodes.length === 0) return;
      const top = nodes[0].closest('.d4-transcript')?.getBoundingClientRect().top ?? 0;
      let current = nodes[0];
      for (const node of nodes) {
        if (node.getBoundingClientRect().top - top <= 24) current = node;
      }
      setSpied(current.dataset.turnId ?? null);
    };
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, [timeline.length]);

  const jump = (id: string) => {
    setSpied(id);
    document.getElementById(`turn-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const dot = (turn: Turn) => {
    if (turn.id === lastTurnId && isBusy) {
      return <Loader2 className="w-3 h-3 shrink-0 mt-0.5 text-d4-accent animate-spin" />;
    }
    if (turn.status === 'failed') return <XCircle className="w-3 h-3 shrink-0 mt-0.5 text-d4-error" />;
    if (turn.status === 'cancelled') return <TriangleAlert className="w-3 h-3 shrink-0 mt-0.5 text-d4-warning" />;
    return <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5 text-d4-dimmed" />;
  };

  return (
    <aside className="w-[212px] shrink-0 bg-d4-bg border-l border-d4-border-subtle flex flex-col select-none">
      <div className="h-8 shrink-0 flex items-center justify-between px-3 text-[10px] font-semibold uppercase tracking-wider text-d4-dimmed">
        <span>{t('outline.title')}</span>
        {onClose && (
          <button onClick={onClose} title={t('outline.hide')} className="text-d4-dimmed hover:text-d4-text">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-2 space-y-px">
        {turns.length === 0 ? (
          <p className="px-2 py-3 text-[11px] leading-relaxed text-d4-dimmed">{t('outline.empty')}</p>
        ) : (
          turns.map((turn) => {
            const isActive = highlighted === turn.id;
            return (
              <button
                key={turn.id}
                onClick={() => jump(turn.id)}
                className={`w-full text-left flex items-start gap-1.5 px-1.5 py-1.5 rounded-sm transition-colors ${
                  isActive ? 'bg-d4-surface' : 'hover:bg-d4-panel'
                }`}
              >
                {dot(turn)}
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-[11px] leading-snug line-clamp-2 ${
                      isActive ? 'text-d4-text' : 'text-d4-dimmed'
                    }`}
                  >
                    {turn.text || t('outline.untitled')}
                  </span>
                  {turn.steps > 0 && (
                    <span className="mt-0.5 block text-[10px] font-mono text-d4-dimmed/80 truncate">
                      {t('outline.steps', { count: turn.steps })}
                      {turn.lastTool ? ` · ${t(verbKeyFor(turn.lastTool))} ${turn.lastArg ?? ''}` : ''}
                    </span>
                  )}
                </span>
              </button>
            );
          })
        )}

        {isBusy && turns.length > 0 && (
          <div className="flex items-center gap-1.5 px-1.5 py-1.5 text-[10px] text-d4-accent">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>{t(`agent.status_${status}`, { defaultValue: status })}</span>
          </div>
        )}
      </div>
    </aside>
  );
};
