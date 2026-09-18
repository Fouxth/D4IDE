import { AgentTimelineItem, ChatMessage, SessionTranscript } from '../../../shared/types';

/** Titles used by the timeline for the two conversational sides. */
const USER_TITLE = 'User Prompt';
const ASSISTANT_TITLE = 'D4 Agent';

export const MAX_HISTORY_MESSAGES = 12;
export const MAX_HISTORY_CHARS = 12000;

/**
 * Rebuilds a compact conversation from a stored transcript (spec §45/§84).
 *
 * Resuming a session must mean more than redrawing the old timeline: the model
 * needs to know what it already did, or it will re-explore the same ground and
 * repeat work. Only the conversational spine is replayed — user prompts,
 * assistant replies, completion summaries and failures. Tool calls and their
 * output are deliberately omitted: they are the bulk of a transcript and the
 * files on disk already reflect their effect.
 *
 * Pure and deterministic so it can be unit-tested without a provider.
 */
export function transcriptToConversation(
  transcript: SessionTranscript | null | undefined,
  options: { maxMessages?: number; maxChars?: number } = {}
): ChatMessage[] {
  if (!transcript || !Array.isArray(transcript.timeline)) return [];

  const maxMessages = options.maxMessages ?? MAX_HISTORY_MESSAGES;
  const maxChars = options.maxChars ?? MAX_HISTORY_CHARS;

  const rebuilt: ChatMessage[] = [];
  for (const item of transcript.timeline) {
    const entry = toMessage(item);
    if (entry) rebuilt.push(entry);
  }

  // Keep the newest end of the conversation, oldest first.
  const recent = rebuilt.slice(-maxMessages);

  let total = 0;
  const kept: ChatMessage[] = [];
  for (let index = recent.length - 1; index >= 0; index--) {
    const message = recent[index];
    const size = message.content.length;
    if (kept.length > 0 && total + size > maxChars) break;
    total += size;
    kept.unshift(message);
  }

  return kept;
}

function toMessage(item: AgentTimelineItem): ChatMessage | null {
  if (item.type === 'message') {
    const content = (item.content || '').trim();
    if (!content) return null;
    return {
      id: `hist_${item.id}`,
      role: item.title === USER_TITLE ? 'user' : 'assistant',
      content,
      timestamp: item.timestamp
    };
  }

  if (item.type === 'summary') {
    const content = (item.content || '').trim();
    if (!content) return null;
    return { id: `hist_${item.id}`, role: 'assistant', content, timestamp: item.timestamp };
  }

  if (item.type === 'error') {
    const content = (item.content || '').trim();
    if (!content) return null;
    // Framed as user-side context so it never looks like the model said it.
    return {
      id: `hist_${item.id}`,
      role: 'user',
      content: `[Earlier run failed — ${item.title}]\n${content.slice(0, 800)}`,
      timestamp: item.timestamp
    };
  }

  return null;
}

/** One-line description of a transcript for the recovery banner and logs. */
export function describeTranscript(transcript: SessionTranscript | null | undefined): string {
  if (!transcript) return '';
  const userTurns = transcript.timeline.filter((item) => item.type === 'message' && item.title === USER_TITLE).length;
  const touched = new Set(
    transcript.timeline.filter((item) => item.type === 'tool_call' && item.toolCall).map((item) => item.toolCall!.name)
  );
  return `${transcript.timeline.length} events · ${userTurns} prompt(s) · ${touched.size} distinct tool(s)`;
}
