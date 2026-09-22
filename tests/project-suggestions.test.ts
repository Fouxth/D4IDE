import { describe, expect, it } from 'vitest';
import { buildProjectSuggestions, ProjectSuggestionInput } from '../src/shared/project-suggestions';
import { extractTodoMarkers } from '../src/main/project/project-context';

/**
 * The empty transcript's chips are the app's first impression of a project, so
 * they must come from that project: uncommitted work first, then the code's own
 * TODO/FIXME markers, then recently touched files, and only when the folder is
 * genuinely quiet the structure/propose fallbacks.
 */

const base: ProjectSuggestionInput = {
  language: 'th',
  isRepo: true,
  workingTree: { staged: [], unstaged: [], untracked: [] },
  recentFiles: [],
  todoMarkers: []
};

describe('buildProjectSuggestions', () => {
  it('leads with the uncommitted work a dirty tree is asking about', () => {
    const result = buildProjectSuggestions({
      ...base,
      workingTree: { staged: [], unstaged: ['src/auth.ts', 'src/api.ts'], untracked: [] }
    });
    expect(result[0].id).toBe('review-changes');
    expect(result[0].label).toContain('2');
    expect(result.map((s) => s.id)).toContain('commit-changes');
  });

  it('names the first changed file inside the prompt so the agent starts somewhere', () => {
    const result = buildProjectSuggestions({
      ...base,
      workingTree: { staged: ['src/a.ts'], unstaged: [], untracked: [] }
    });
    expect(result[0].prompt).toContain('src/a.ts');
  });

  it('asks about untracked files when the tracked tree is clean', () => {
    const result = buildProjectSuggestions({
      ...base,
      workingTree: { staged: [], unstaged: [], untracked: ['notes.txt', 'tmp.log'] }
    });
    expect(result[0].id).toBe('untracked');
    expect(result[0].label).toContain('2');
  });

  it('surfaces the TODO markers the code carries, first one named', () => {
    const result = buildProjectSuggestions({
      ...base,
      todoMarkers: ['src/auth.ts:42', 'src/api.ts:7']
    });
    const todos = result.find((s) => s.id === 'todos')!;
    expect(todos.label).toContain('2');
    expect(todos.prompt).toContain('src/auth.ts:42');
  });

  it('offers to review the most recently modified file when git is clean', () => {
    const result = buildProjectSuggestions({ ...base, recentFiles: ['src/recent.ts'] });
    const recent = result.find((s) => s.id === 'recent-file')!;
    expect(recent.prompt).toContain('src/recent.ts');
    expect(result.map((s) => s.id)).not.toContain('review-changes');
  });

  it('falls back to structure and proposals on a quiet, clean repository', () => {
    const result = buildProjectSuggestions(base);
    expect(result.map((s) => s.id)).toEqual(expect.arrayContaining(['structure', 'propose']));
    expect(result.map((s) => s.id)).not.toContain('start-repo');
  });

  it('suggests setting up git only for a folder that has no repository', () => {
    const result = buildProjectSuggestions({ ...base, isRepo: false });
    expect(result.map((s) => s.id)).toContain('start-repo');
  });

  it('does not suggest setting up git for a dirty non-repo folder (nothing to commit yet)', () => {
    // A folder without git has no working tree to report, so this is the
    // shape a non-repo actually arrives in.
    const result = buildProjectSuggestions({ ...base, isRepo: false, recentFiles: ['src/x.ts'] });
    expect(result.map((s) => s.id)).not.toContain('start-repo');
    expect(result.map((s) => s.id)).toContain('recent-file');
  });

  it('caps at four chips', () => {
    const result = buildProjectSuggestions({
      ...base,
      workingTree: { staged: [], unstaged: ['src/a.ts'], untracked: [] },
      todoMarkers: ['src/b.ts:1']
    });
    expect(result.length).toBeLessThanOrEqual(4);
  });

  it('writes English labels when the app language is English', () => {
    const result = buildProjectSuggestions({
      ...base,
      language: 'en',
      workingTree: { staged: [], unstaged: ['src/a.ts'], untracked: [] }
    });
    expect(result[0].label).toContain('uncommitted');
  });
});

describe('extractTodoMarkers', () => {
  it('finds markers with their line numbers', () => {
    const content = ['const a = 1;', '// TODO: handle empty input', 'const b = 2;', '// FIXME: race here'].join('\n');
    expect(extractTodoMarkers(content, 'src/x.ts')).toEqual(['src/x.ts:2', 'src/x.ts:4']);
  });

  it('matches whole words only, so "todoList" is not a marker', () => {
    const content = 'const todoList = [];\n// todo later';
    expect(extractTodoMarkers(content, 'src/x.ts')).toEqual(['src/x.ts:2']);
  });

  it('stops at the cap so a marker-riddled file cannot flood the list', () => {
    const content = Array.from({ length: 40 }, (_, i) => `// TODO ${i}`).join('\n');
    expect(extractTodoMarkers(content, 'src/x.ts').length).toBeLessThanOrEqual(12);
  });

  it('returns nothing for clean code', () => {
    expect(extractTodoMarkers('const clean = true;\nexport { clean };', 'src/x.ts')).toEqual([]);
  });
});
