import { describe, expect, it } from 'vitest';
import { parsePorcelain } from '../src/main/git/git-service';
import { gitPresence, shouldShowGit } from '../src/shared/git';

describe('parsePorcelain', () => {
  it('splits staged, unstaged and untracked by column', () => {
    const result = parsePorcelain(['M  src/a.ts', ' M src/b.ts', 'MM src/c.ts', '?? notes.md'].join('\n'));
    expect(result.staged).toEqual(['src/a.ts', 'src/c.ts']);
    expect(result.unstaged).toEqual(['src/b.ts', 'src/c.ts']);
    expect(result.untracked).toEqual(['notes.md']);
  });

  it('ignores blank lines and keeps paths that contain spaces', () => {
    const result = parsePorcelain('\n?? my notes/todo list.md\n\n');
    expect(result.untracked).toEqual(['my notes/todo list.md']);
    expect(result.staged).toEqual([]);
  });

  it('answers empty for a clean tree', () => {
    expect(parsePorcelain('')).toEqual({ staged: [], unstaged: [], untracked: [] });
  });
});

describe('shouldShowGit', () => {
  it('hides git when the folder is not a repository', () => {
    expect(shouldShowGit({ isRepo: false, remote: null })).toBe(false);
    expect(shouldShowGit({ isRepo: false, remote: 'https://example.com/x.git' })).toBe(false);
  });

  it('hides git when there is no remote to sync with', () => {
    expect(shouldShowGit({ isRepo: true, remote: null })).toBe(false);
    expect(shouldShowGit({ isRepo: true, remote: '' })).toBe(false);
  });

  it('shows git only for a repository that has a remote', () => {
    expect(shouldShowGit({ isRepo: true, remote: 'https://github.com/o/r.git' })).toBe(true);
  });

  it('shows nothing at all when there is no status', () => {
    expect(shouldShowGit(null)).toBe(false);
    expect(shouldShowGit(undefined)).toBe(false);
  });
});

describe('gitPresence', () => {
  it('names the three states the Git panel has to explain', () => {
    expect(gitPresence({ isRepo: false, remote: null })).toBe('no-repo');
    expect(gitPresence({ isRepo: true, remote: null })).toBe('no-remote');
    expect(gitPresence({ isRepo: true, remote: 'git@github.com:o/r.git' })).toBe('ready');
    expect(gitPresence(null)).toBe('no-repo');
  });
});
