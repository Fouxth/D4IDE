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
