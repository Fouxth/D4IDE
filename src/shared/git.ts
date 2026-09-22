import { GitStatusSummary } from './types';

/**
 * Whether a git cell belongs on screen at all.
 *
 * Both processes need this answer: the main process fills in `isRepo`/`remote`,
 * the renderer decides what to draw. A folder that is not a repository, or one
 * with nothing to sync with, has no branch worth printing in the status bar —
 * showing nothing and explaining it in the Git panel beats an em dash that is
 * there forever on every non-git folder.
 */
export function shouldShowGit(status: Pick<GitStatusSummary, 'isRepo' | 'remote'> | null | undefined): boolean {
  if (!status) return false;
  if (status.isRepo === false) return false;
  return !!status.remote;
}

/** The user-facing state of the git corner: repo, remote, or neither. */
export type GitPresence = 'ready' | 'no-remote' | 'no-repo';

export function gitPresence(status: GitStatusSummary | null | undefined): GitPresence {
  if (!status || status.isRepo === false) return 'no-repo';
  return status.remote ? 'ready' : 'no-remote';
}
