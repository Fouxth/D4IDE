import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  describeRefusals,
  isInsideProject,
  planCheckpointRestore
} from '../src/main/checkpoints/checkpoint-policy';

/**
 * Checkpoint restore is the one operation that writes files the user never
 * picked, using paths recorded in an earlier session. These tests pin the
 * boundary: inside the open project only (spec §12/§13, §90 checkpoint restore).
 */
const PROJECT = path.resolve('C:/work/app');

const snapshot = (filePath: string, content = 'x') => ({ path: filePath, content });

describe('isInsideProject', () => {
  it('accepts files below the project root', () => {
    expect(isInsideProject(PROJECT, path.join(PROJECT, 'src/index.ts'))).toBe(true);
    expect(isInsideProject(PROJECT, path.join(PROJECT, 'deep/nested/file.txt'))).toBe(true);
  });

  it('rejects anything outside, including sibling folders and escapes', () => {
    expect(isInsideProject(PROJECT, path.resolve('C:/work/other/index.ts'))).toBe(false);
    expect(isInsideProject(PROJECT, path.join(PROJECT, '..', 'secrets.env'))).toBe(false);
    expect(isInsideProject(PROJECT, path.resolve('C:/Windows/System32/drivers/hosts'))).toBe(false);
    expect(isInsideProject(PROJECT, PROJECT)).toBe(false); // the root itself is not a file
  });

  it('treats a prefix that only looks like the project as outside', () => {
    // "C:/work/app-other" starts with "C:/work/app" as a string but is a different folder.
    expect(isInsideProject(PROJECT, path.resolve('C:/work/app-other/file.ts'))).toBe(false);
  });

  it('refuses everything when no project is open', () => {
    expect(isInsideProject('', path.join(PROJECT, 'index.ts'))).toBe(false);
  });
});

describe('planCheckpointRestore', () => {
  it('plans writes for snapshots inside the open project', () => {
    const plan = planCheckpointRestore(
      [snapshot(path.join(PROJECT, 'src/a.ts'), 'a'), snapshot(path.join(PROJECT, 'src/b.ts'), 'b')],
      PROJECT
    );

    expect(plan.refused).toEqual([]);
    expect(plan.writable.map((f) => f.content)).toEqual(['a', 'b']);
    expect(plan.writable[0].path).toBe(path.resolve(PROJECT, 'src/a.ts'));
  });

  it('refuses a snapshot from another project instead of writing outside', () => {
    const foreign = path.resolve('C:/work/other-project/src/a.ts');
    const plan = planCheckpointRestore([snapshot(foreign), snapshot(path.join(PROJECT, 'ok.ts'))], PROJECT);

    expect(plan.writable.map((f) => f.path)).toEqual([path.resolve(PROJECT, 'ok.ts')]);
    expect(plan.refused).toEqual([{ path: foreign, reason: 'outside-project' }]);
  });

  it('refuses every snapshot when nothing is open', () => {
    const plan = planCheckpointRestore([snapshot(path.join(PROJECT, 'a.ts'))], '');

    expect(plan.writable).toEqual([]);
    expect(plan.refused[0].reason).toBe('outside-project');
    expect(describeRefusals(plan.refused)).toContain('different project');
  });

  it('refuses relative, empty and non-file paths', () => {
    const plan = planCheckpointRestore(
      [snapshot('src/relative.ts'), snapshot(''), { path: undefined as unknown as string, content: 'x' }],
      PROJECT
    );

    expect(plan.writable).toEqual([]);
    expect(plan.refused.map((r) => r.reason)).toEqual(['not-a-file-path', 'not-a-file-path', 'not-a-file-path']);
  });

  it('refuses a snapshot without content rather than blanking the file', () => {
    const target = path.join(PROJECT, 'src/a.ts');
    const plan = planCheckpointRestore([{ path: target, content: undefined as unknown as string }], PROJECT);

    expect(plan.writable).toEqual([]);
    expect(plan.refused).toEqual([{ path: target, reason: 'missing-content' }]);
  });

  it('writes each file once even if the checkpoint repeats it', () => {
    const target = path.join(PROJECT, 'src/a.ts');
    const plan = planCheckpointRestore([snapshot(target, 'first'), snapshot(target, 'second')], PROJECT);

    expect(plan.writable).toHaveLength(1);
    expect(plan.writable[0].content).toBe('first');
    expect(plan.refused).toEqual([{ path: target, reason: 'duplicate' }]);
  });

  it('handles a checkpoint with no snapshots at all', () => {
    expect(planCheckpointRestore(undefined, PROJECT)).toEqual({ writable: [], refused: [] });
    expect(planCheckpointRestore([], PROJECT)).toEqual({ writable: [], refused: [] });
  });

  it('keeps a useful refusal message when only some files were skipped', () => {
    const plan = planCheckpointRestore(
      [snapshot(path.resolve('C:/elsewhere/a.ts'), 'a')],
      PROJECT
    );
    expect(describeRefusals(plan.refused)).toBe('This checkpoint belongs to a different project — open that folder and restore it there.');
  });
});
