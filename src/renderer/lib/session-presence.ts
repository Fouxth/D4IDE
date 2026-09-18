import { AgentStatus } from '../../shared/types';

/**
 * What a session tab should show about the conversation it points at.
 *
 * Only the live session's state is known to the renderer (the agent store
 * tracks the conversation on screen), so the tab strip shows a presence dot
 * for that one tab and none for the others — never a stale guess.
 */
export type TabPresence = 'working' | 'waiting' | 'failed' | 'done';

export const presenceFor = (status: AgentStatus): TabPresence | null => {
  if (status === 'running' || status === 'planning') return 'working';
  if (status === 'waiting_approval' || status === 'paused') return 'waiting';
  if (status === 'failed') return 'failed';
  if (status === 'completed') return 'done';
  return null;
};

/** The dot's colour classes, kept next to the mapping so tabs stay consistent. */
export const presenceDotClass: Record<TabPresence, string> = {
  working: 'bg-d4-accent animate-pulse',
  waiting: 'bg-amber-400',
  failed: 'bg-d4-error',
  done: 'bg-d4-success'
};
