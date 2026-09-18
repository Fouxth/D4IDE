import { AgentTimelineItem } from '../../../shared/types';

/**
 * How a step is named, in one place.
 *
 * The transcript and the conversation outline both describe steps, and they
 * have to agree — a row that says "Run" in one and "run_tests" in the other is
 * how a UI starts to feel unfinished. Both call these two functions and
 * translate the result.
 */
export function verbKeyFor(name: string): string {
  switch (name) {
    case 'run_terminal':
    case 'run_tests':
    case 'run_build':
    case 'browser_run':
      return 'agent.verb_run';
    case 'read_file':
    case 'list_directory':
    case 'read_image':
      return 'agent.verb_read';
    case 'write_file':
    case 'create_file':
      return 'agent.verb_write';
    case 'edit_file':
    case 'multi_edit':
    case 'delete_file':
      return 'agent.verb_edit';
    case 'search_files':
    case 'grep_search':
    case 'find_references':
      return 'agent.verb_search';
    default:
      return 'agent.verb_tool';
  }
}

/** The one thing worth showing on a single line: the command, path or pattern. */
export function targetFor(item: AgentTimelineItem): string {
  const args = item.toolCall?.args || {};
  const value =
    args.command || args.path || args.filePath || args.file || args.pattern || args.query || args.url || args.name;
  if (typeof value === 'string' && value.trim()) return value.replace(/\s+/g, ' ').trim();
  if (item.toolCall?.name) return item.toolCall.name;
  return item.title;
}
