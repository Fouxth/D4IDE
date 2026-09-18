import { describe, expect, it } from 'vitest';
import { SUBAGENTS, buildSubagentSystemPrompt, getSubagent, subagentRoleNames } from '../src/main/ai/agent/subagents';
import { READ_ONLY_SUBAGENT_ROLES, permissionEngine } from '../src/main/security/permission-engine';
import { ToolCall } from '../src/shared/types';

/**
 * Subagents are a security boundary as much as a feature: a read-only role is
 * promised that it cannot edit the project, and the permission engine decides
 * whether delegating to a role needs the user's confirmation. Those two facts
 * live in different files, so they are pinned together here.
 */
const expectedRoles = ['explore', 'review', 'test', 'debug', 'frontend', 'database'];

describe('subagent catalogue', () => {
  it('offers exactly the roles the spec lists, once each', () => {
    expect(subagentRoleNames()).toEqual(expectedRoles);
    expect(new Set(subagentRoleNames()).size).toBe(SUBAGENTS.length);
  });

  it('gives every role a label, a summary, a prompt and a step budget', () => {
    for (const definition of SUBAGENTS) {
      expect(definition.label.length).toBeGreaterThan(0);
      expect(definition.summary.length).toBeGreaterThan(20);
      expect(definition.systemPrompt.length).toBeGreaterThan(80);
      expect(definition.maxSteps).toBeGreaterThanOrEqual(2);
    }
  });

  it('promises read-only roles that they cannot write, and says so in the prompt', () => {
    for (const definition of SUBAGENTS) {
      if (definition.writeCapable) continue;
      expect(definition.systemPrompt).toMatch(/read-only/i);
      expect(definition.systemPrompt).toMatch(/never modify/i);
    }
  });

  it('keeps the enforceable role list in step with the prompts', () => {
    const actuallyReadOnly = SUBAGENTS.filter((d) => !d.writeCapable).map((d) => d.role).sort();
    const enforced = [...READ_ONLY_SUBAGENT_ROLES].sort();

    // If these drift, a "read-only" agent would be handed a write-capable role.
    expect(enforced).toEqual(actuallyReadOnly);
  });

  it('resolves a role by name and rejects anything unknown', () => {
    expect(getSubagent('debug')?.writeCapable).toBe(false);
    expect(getSubagent('frontend')?.writeCapable).toBe(true);
    expect(getSubagent('nope')).toBeUndefined();
  });
});

describe('subagent permissions', () => {
  const delegate = (role: string): ToolCall => ({ id: 'tc1', name: 'spawn_subagent', args: { role, task: 'do it' } });

  it('auto-runs a read-only delegation in every mode', () => {
    for (const role of ['explore', 'review', 'test', 'debug']) {
      for (const mode of ['safe', 'ask', 'full'] as const) {
        const decision = permissionEngine.check(mode, delegate(role));
        expect(decision.allowed, `${role} in ${mode}`).toBe(true);
        expect(decision.requiresApproval, `${role} in ${mode}`).toBe(false);
      }
    }
  });

  it('asks before handing work to a role that can modify the project', () => {
    for (const role of ['frontend', 'database']) {
      expect(permissionEngine.check('safe', delegate(role)).requiresApproval).toBe(true);
      expect(permissionEngine.check('ask', delegate(role)).requiresApproval).toBe(true);
      // Full Access automates it, but the decision is still explicit.
      expect(permissionEngine.check('full', delegate(role)).requiresApproval).toBe(false);
    }
  });

  it('refuses a delegation with no role at all', () => {
    const decision = permissionEngine.check('full', delegate(''));
    expect(decision.allowed).toBe(false);
  });
});

describe('subagent system prompt', () => {
  it('carries the project, the parent task and the requested language', () => {
    const prompt = buildSubagentSystemPrompt(getSubagent('review')!, {
      projectPath: 'C:/work/app',
      language: 'th',
      parentTask: 'Fix the login flow'
    });

    expect(prompt).toContain('C:/work/app');
    expect(prompt).toContain('Fix the login flow');
    expect(prompt).toContain('Thai');
    expect(prompt).toContain('read-only');
  });

  it('still builds when there is no parent task recorded', () => {
    const prompt = buildSubagentSystemPrompt(getSubagent('explore')!, {
      projectPath: '/tmp/p',
      language: 'en',
      parentTask: ''
    });

    expect(prompt).toContain('no parent task recorded');
    expect(prompt).toContain('English');
  });
});
