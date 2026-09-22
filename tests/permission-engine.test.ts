import { describe, it, expect } from 'vitest';
import { PermissionEngine } from '../src/main/security/permission-engine';

describe('PermissionEngine', () => {
  const engine = new PermissionEngine();

  it('detects dangerous shell commands', () => {
    expect(engine.isDangerousCommand('rm -rf /')).toBe(true);
    expect(engine.isDangerousCommand('del /s /q C:\\Windows')).toBe(true);
    expect(engine.isDangerousCommand('format d:')).toBe(true);
    expect(engine.isDangerousCommand('git reset --hard')).toBe(true);
    expect(engine.isDangerousCommand('git push origin main --force')).toBe(true);
    expect(engine.isDangerousCommand('npm run build')).toBe(false);
    expect(engine.isDangerousCommand('git status')).toBe(false);
  });

  it('blocks dangerous commands regardless of mode', () => {
    const check = engine.check('full', {
      id: '1',
      name: 'run_terminal',
      args: { command: 'rm -rf /' }
    });
    expect(check.allowed).toBe(false);
    expect(check.requiresApproval).toBe(true);
  });

  it('allows read-only tools automatically in safe mode', () => {
    const check = engine.check('safe', {
      id: '2',
      name: 'read_file',
      args: { path: 'src/main.ts' }
    });
    expect(check.allowed).toBe(true);
    expect(check.requiresApproval).toBe(false);
  });

  it('requires approval for write tools in safe mode', () => {
    const check = engine.check('safe', {
      id: '3',
      name: 'write_file',
      args: { path: 'src/main.ts', content: 'test' }
    });
    expect(check.allowed).toBe(true);
    expect(check.requiresApproval).toBe(true);
  });
});

/**
 * The laws the user asked for, checked against the same entry point the runtime
 * uses: every provider, every mode.
 */
describe('standing laws', () => {
  const engine = new PermissionEngine();
  const project = process.platform === 'win32' ? 'F:\\HuayD' : '/work/HuayD';
  const outside = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/etc';
  const context = { projectPath: project, language: 'th' as const };

  it('stays inside the project in every mode, Full Access included', () => {
    for (const mode of ['safe', 'ask', 'full'] as const) {
      const check = engine.check(
        mode,
        { id: '1', name: 'write_file', args: { path: `${outside}/hosts`, content: 'x' } },
        {},
        context
      );
      expect(check.allowed, mode).toBe(false);
      expect(check.reason).toContain('โปรเจกต์');
    }
  });

  it('stays inside the project from the terminal too, but not for reads', () => {
    const write = engine.check(
      'full',
      { id: '2', name: 'run_terminal', args: { command: `echo hacked > ${outside}/hosts` } },
      {},
      context
    );
    expect(write.allowed).toBe(false);

    const read = engine.check(
      'full',
      { id: '3', name: 'run_terminal', args: { command: `type ${outside}/drivers/etc/hosts` } },
      {},
      context
    );
    expect(read.allowed).toBe(true);
  });

  it('refuses to delete the project when nobody asked for it', () => {
    for (const command of ['rm -rf .', 'rm -rf *', 'git clean -xfd']) {
      const check = engine.check('full', { id: '4', name: 'run_terminal', args: { command } }, {}, context);
      expect(check.allowed, command).toBe(false);
      expect(check.requiresApproval).toBe(true);
    }

    const root = engine.check(
      'full',
      { id: '5', name: 'delete_file', args: { path: project } },
      {},
      context
    );
    expect(root.allowed).toBe(false);
  });

  it('asks once when the user did ask for the project to be removed', () => {
    const asked = { ...context, explicitDestructiveRequest: true };
    const safe = engine.check('safe', { id: '6', name: 'run_terminal', args: { command: 'rm -rf .' } }, {}, asked);
    expect(safe.allowed).toBe(true);
    expect(safe.requiresApproval).toBe(true);

    // Full Access means the questions are already answered, and the request is
    // the user's own — the one combination the law allows.
    const full = engine.check('full', { id: '7', name: 'run_terminal', args: { command: 'rm -rf .' } }, {}, asked);
    expect(full.allowed).toBe(true);
    expect(full.requiresApproval).toBe(false);
  });

  it('still refuses a drive root even when destruction was requested', () => {
    if (process.platform !== 'win32') return;
    const asked = { ...context, explicitDestructiveRequest: true };
    // `rm -rf C:\` is caught by the system guardrail before the law is consulted.
    const drive = engine.check('full', { id: '8', name: 'run_terminal', args: { command: 'rm -rf C:\\' } }, {}, asked);
    expect(drive.allowed).toBe(false);
  });

  it('confirms a recursive delete inside the project instead of doing it silently', () => {
    const check = engine.check(
      'safe',
      { id: '9', name: 'run_terminal', args: { command: 'rm -rf node_modules' } },
      {},
      context
    );
    expect(check.allowed).toBe(true);
    expect(check.requiresApproval).toBe(true);
  });

  it('asks before a single file delete as well', () => {
    const check = engine.check(
      'ask',
      { id: '10', name: 'delete_file', args: { path: 'src/old.ts' } },
      {},
      context
    );
    expect(check.allowed).toBe(true);
    expect(check.requiresApproval).toBe(true);
  });
});

/**
 * Laws the user switched off.
 *
 * The toggles exist because a few layouts genuinely need them (a monorepo whose
 * sibling folders belong to the same project, a scaffold that starts empty), and
 * a setting that looks switched off while the engine still refuses the call is
 * worse than no setting at all. Each law is checked in both directions.
 */
describe('standing laws the user switched off', () => {
  const engine = new PermissionEngine();
  const project = process.platform === 'win32' ? 'F:\\D4IDE' : '/project';
  const outside = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/etc';
  const context = { projectPath: project, language: 'en' as const };

  it('lets a file tool leave the project when stay-in-project is off', () => {
    const off = { ...context, disabledLaws: ['stay-in-project'] };
    const write = engine.check(
      'safe',
      { id: 'a1', name: 'write_file', args: { path: `${outside}/hosts`, content: 'x' } },
      {},
      off
    );
    // Still a write, so it is confirmed — but it is no longer refused.
    expect(write.allowed).toBe(true);
    expect(write.requiresApproval).toBe(true);

    const terminal = engine.check(
      'full',
      { id: 'a2', name: 'run_terminal', args: { command: `echo x > ${outside}/hosts` } },
      {},
      off
    );
    expect(terminal.allowed).toBe(true);
  });

  it('keeps refusing outside writes when only another law is off', () => {
    const off = { ...context, disabledLaws: ['no-loops'] };
    const write = engine.check(
      'full',
      { id: 'b1', name: 'write_file', args: { path: `${outside}/hosts`, content: 'x' } },
      {},
      off
    );
    expect(write.allowed).toBe(false);
  });

  it('stops refusing the project deletion when that law is off, but keeps the system guardrails', () => {
    const off = { ...context, disabledLaws: ['never-delete-the-project'] };
    const root = engine.check('safe', { id: 'c1', name: 'run_terminal', args: { command: 'rm -rf .' } }, {}, off);
    expect(root.allowed).toBe(true);

    // `rm -rf C:\` is the machine's own safety, not the project law.
    if (process.platform === 'win32') {
      const drive = engine.check('full', { id: 'c2', name: 'run_terminal', args: { command: 'rm -rf C:\\' } }, {}, off);
      expect(drive.allowed).toBe(false);
    }
  });

  it('stops demanding a delete confirmation when that law is off', () => {
    const on = engine.check('full', { id: 'd0', name: 'delete_file', args: { path: 'src/old.ts' } }, {}, context);
    expect(on.requiresApproval).toBe(true);

    const off = { ...context, disabledLaws: ['confirm-recursive-delete'] };
    const single = engine.check('full', { id: 'd2', name: 'delete_file', args: { path: 'src/old.ts' } }, {}, off);
    expect(single.requiresApproval).toBe(false);
  });

  it('leaves the permission mode and its own caution alone', () => {
    // Safe mode asks about anything it cannot prove is read-only, and that is the
    // mode talking, not the law — a switched-off law must not turn Safe mode into
    // Full Access.
    const off = { ...context, disabledLaws: ['confirm-recursive-delete'] };
    const recursive = engine.check(
      'safe',
      { id: 'd1', name: 'run_terminal', args: { command: 'rm -rf node_modules' } },
      {},
      off
    );
    expect(recursive.allowed).toBe(true);
    expect(recursive.requiresApproval).toBe(true);
  });

  it('never disables a guardrail that is not a switchable law', () => {
    // The hard system block is not in `STANDING_LAWS` and no toggle reaches it.
    const everything = { ...context, disabledLaws: ['stay-in-project', 'never-delete-the-project', 'confirm-recursive-delete', 'no-loops'] };
    const check = engine.check('full', { id: 'e1', name: 'run_terminal', args: { command: 'rm -rf /' } }, {}, everything);
    expect(check.allowed).toBe(false);
  });
});
