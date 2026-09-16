import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../src/main/ai/tools/tool-registry';

describe('ToolRegistry', () => {
  const registry = new ToolRegistry();

  it('filters out destructive write tools in plan mode', () => {
    const planTools = registry.getToolDefinitions('plan');
    const planToolNames = planTools.map((t) => t.name);

    expect(planToolNames).toContain('read_file');
    expect(planToolNames).toContain('search_files');
    expect(planToolNames).toContain('list_directory');
    expect(planToolNames).not.toContain('write_file');
    expect(planToolNames).not.toContain('edit_file');
    expect(planToolNames).not.toContain('create_file');
    expect(planToolNames).not.toContain('delete_file');
  });

  it('includes all tools in build mode', () => {
    const buildTools = registry.getToolDefinitions('build');
    const buildToolNames = buildTools.map((t) => t.name);

    expect(buildToolNames).toContain('read_file');
    expect(buildToolNames).toContain('write_file');
    expect(buildToolNames).toContain('edit_file');
    expect(buildToolNames).toContain('run_terminal');
  });
});
