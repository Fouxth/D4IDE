import path from 'path';

/**
 * Checkpoint restore policy (spec §12/§13).
 *
 * A checkpoint stores *absolute* paths captured while some project was open, but
 * restore runs later against whatever project is open now. Writing a stored path
 * blindly therefore means an old checkpoint can silently rewrite files in an
 * unrelated folder — or anywhere on disk if the checkpoint file was tampered
 * with. Restore is filtered through this policy first, so the decision is made
 * once, in one place, and can be tested without touching the disk.
 */

export interface CheckpointFileSnapshot {
  path: string;
  content: string;
}

export type RestoreRefusalReason = 'not-a-file-path' | 'outside-project' | 'duplicate' | 'missing-content';

export interface CheckpointRestorePlan {
  /** Snapshots safe to write, de-duplicated, with resolved absolute paths. */
  writable: CheckpointFileSnapshot[];
  refused: { path: string; reason: RestoreRefusalReason }[];
}

/** True when `candidate` is a file strictly inside `projectPath`. */
export function isInsideProject(projectPath: string, candidate: string): boolean {
  if (!projectPath || !candidate) return false;
  const root = path.resolve(projectPath);
  const target = path.resolve(candidate);
  const relative = path.relative(root, target);
  // '' means the project root itself (a directory, never a file snapshot).
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function planCheckpointRestore(
  files: CheckpointFileSnapshot[] | undefined,
  projectPath: string
): CheckpointRestorePlan {
  const writable: CheckpointFileSnapshot[] = [];
  const refused: { path: string; reason: RestoreRefusalReason }[] = [];
  const seen = new Set<string>();

  for (const file of files ?? []) {
    const raw = typeof file?.path === 'string' ? file.path : '';
    if (!raw.trim() || !path.isAbsolute(raw)) {
      refused.push({ path: raw, reason: 'not-a-file-path' });
      continue;
    }
    if (!isInsideProject(projectPath, raw)) {
      refused.push({ path: raw, reason: 'outside-project' });
      continue;
    }
    if (typeof file.content !== 'string') {
      // Writing a placeholder here would blank a real file, so skip it instead.
      refused.push({ path: raw, reason: 'missing-content' });
      continue;
    }

    const resolved = path.resolve(raw);
    if (seen.has(resolved)) {
      refused.push({ path: raw, reason: 'duplicate' });
      continue;
    }
    seen.add(resolved);
    writable.push({ path: resolved, content: file.content });
  }

  return { writable, refused };
}

/** Human-readable explanation for a fully refused restore. */
export function describeRefusals(refused: { reason: RestoreRefusalReason }[]): string {
  const outside = refused.filter((r) => r.reason === 'outside-project').length;
  if (outside && outside === refused.length) {
    return 'This checkpoint belongs to a different project — open that folder and restore it there.';
  }
  return 'No snapshot in this checkpoint could be restored safely.';
}
