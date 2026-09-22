import { describe, it, expect, vi, afterEach } from 'vitest';
import { ToolRegistry } from '../src/main/ai/tools/tool-registry';
import { terminalService } from '../src/main/terminal/terminal-service';
import { previewRegistry } from '../src/main/preview/preview-registry';

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

  it('offers the whole browser tool set once the plan is approved', () => {
    const names = registry.getToolDefinitions('build').map((t) => t.name);

    for (const tool of ['browser_navigate', 'browser_inspect', 'browser_screenshot', 'browser_console']) {
      expect(names).toContain(tool);
    }
  });

  it('withholds the page-mutating browser tools while planning', () => {
    const names = registry.getToolDefinitions('plan').map((t) => t.name);

    // Reading a rendered page is inspection; driving its forms is not.
    expect(names).toContain('browser_navigate');
    expect(names).toContain('browser_console');
    expect(names).not.toContain('browser_click');
    expect(names).not.toContain('browser_fill');
  });

  it('exposes delegation to subagents with the roles it accepts', () => {
    const tool = registry.getToolDefinitions('build').find((t) => t.name === 'spawn_subagent');

    expect(tool).toBeDefined();
    expect(tool!.parameters.required).toEqual(['role', 'task']);
    expect(tool!.parameters.properties.role.enum).toEqual([
      'explore',
      'review',
      'test',
      'debug',
      'frontend',
      'database'
    ]);
    expect(tool!.description).toMatch(/cannot delegate further/i);
  });

  it('keeps delegation available while planning, for the read-only roles', () => {
    const names = registry.getToolDefinitions('plan').map((t) => t.name);
    expect(names).toContain('spawn_subagent');
  });

  /**
   * A dev server cannot be run the ordinary way: one-shot execution waits for
   * the process to close, a server never closes on its own, so the call used to
   * hang until the timeout and the server was killed with it — the preview had
   * nothing to show, ever. These pin the background path.
   */
  describe('long-running commands', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      for (const server of previewRegistry.list()) previewRegistry.forget(server.url);
    });

    it('starts a dev server in a terminal that keeps running', async () => {
      const startServer = vi.spyOn(terminalService, 'startServer').mockReturnValue({ id: 'server_1', pid: 4242 });
      const runOnce = vi.spyOn(terminalService, 'runCommandOnce');

      const result = await registry.execute(
        { id: 't1', name: 'run_terminal', args: { command: 'npm run dev', background: true } },
        'F:/project'
      );

      expect(result.success).toBe(true);
      expect(startServer).toHaveBeenCalledWith('npm run dev', 'F:/project');
      // The whole point: it must not wait for the server to exit.
      expect(runOnce).not.toHaveBeenCalled();
      expect((result.output as { terminalId: string }).terminalId).toBe('server_1');
    });

    it('registers a port the caller named, so the preview can open while it boots', async () => {
      vi.spyOn(terminalService, 'startServer').mockReturnValue({ id: 'server_2', pid: 1 });

      await registry.execute(
        { id: 't2', name: 'run_terminal', args: { command: 'npm run dev', background: true, port: 4321 } },
        'F:/project'
      );

      expect(previewRegistry.urls()).toContain('http://localhost:4321');
    });

    it('still waits for an ordinary command to finish', async () => {
      const runOnce = vi
        .spyOn(terminalService, 'runCommandOnce')
        .mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 });
      const startServer = vi.spyOn(terminalService, 'startServer');

      await registry.execute({ id: 't3', name: 'run_terminal', args: { command: 'npm test' } }, 'F:/project');

      expect(runOnce).toHaveBeenCalledWith('npm test', 'F:/project');
      expect(startServer).not.toHaveBeenCalled();
    });

    /**
     * The agent is not asked which port its server should use.
     *
     * A model asked to start a project's dev server picks a number from the same
     * shortlist every time — 3000, 5173 — which is how two projects end up on one
     * port. The app decides instead, from the project's own range.
     */
    it('gives a dev server a port from this project\u2019s own range', async () => {
      const startServer = vi
        .spyOn(terminalService, 'startServer')
        .mockReturnValue({ id: 'server_3', pid: 7 });

      const result = await registry.execute(
        { id: 't4', name: 'run_terminal', args: { command: 'next dev', background: true } },
        'F:/project'
      );

      const port = (result.output as { port?: number }).port;
      expect(port).toBeGreaterThanOrEqual(1000);
      expect(port).toBeLessThan(3000);
      // The port has to reach the process that listens on it, as well as the
      // panel that will look at it.
      expect(startServer.mock.calls[0][0]).toContain(`-p ${port}`);
      expect(startServer.mock.calls[0][3]).toEqual({ PORT: String(port) });
      expect(previewRegistry.urls('F:/project')).toContain(`http://localhost:${port}`);
    });

    it('leaves a background command that does not listen alone', async () => {
      const startServer = vi
        .spyOn(terminalService, 'startServer')
        .mockReturnValue({ id: 'server_4', pid: 8 });

      const result = await registry.execute(
        { id: 't5', name: 'run_terminal', args: { command: 'tsc --watch', background: true } },
        'F:/project'
      );

      expect(startServer.mock.calls[0][0]).toBe('tsc --watch');
      expect(startServer.mock.calls[0][3]).toBeUndefined();
      expect((result.output as { port?: number }).port).toBeUndefined();
    });
  });
});
