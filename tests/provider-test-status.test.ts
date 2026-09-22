import { describe, expect, it } from 'vitest';
import { classifyHttpError } from '../src/main/ai/providers/provider-interface';

/**
 * The Test button's contract is that the stored status equals the verdict the
 * user just saw. These pin the classifications that contract depends on — the
 * ones whose mislabelling made a working provider wear a red dot, or a broken
 * one claim to be fine.
 */
describe('classifyHttpError — the verdicts the status is derived from', () => {
  it('calls a plain 401 what it is: the key is wrong', () => {
    expect(classifyHttpError(401, '{"error":{"message":"invalid api key"}}')).toBe('invalid_key');
  });

  it('calls a 403 about the plan what it is: this model is not in the subscription', () => {
    // Subscription gateways answer a model outside the plan with 403 and a
    // message naming entitlement, not authentication. Labelling it invalid_key
    // sent users re-typing a working key while real chats kept succeeding.
    const bodies = [
      '{"error":{"message":"model glm-5.7-flash is not included in your plan"}}',
      '{"error":{"message":"Your subscription does not cover this model"}}',
      '{"error":{"message":"you need to upgrade to access this model"}}',
      '{"error":{"message":"permission denied for this model"}}'
    ];
    for (const body of bodies) {
      expect(classifyHttpError(403, body)).toBe('model_not_found');
    }
  });

  it('still treats a 403 without plan language as a key problem', () => {
    expect(classifyHttpError(403, '{"error":{"message":"forbidden"}}')).toBe('invalid_key');
  });

  it('reads the plan wording regardless of case', () => {
    expect(classifyHttpError(403, '{"error":{"message":"NOT INCLUDED in your PLAN"}}')).toBe('model_not_found');
  });

  it('keeps the other verdicts unchanged', () => {
    expect(classifyHttpError(429, '')).toBe('rate_limit');
    expect(classifyHttpError(503, '')).toBe('unavailable');
    expect(classifyHttpError(404, 'model not found')).toBe('model_not_found');
    expect(classifyHttpError(400, 'context length exceeded')).toBe('context_exceeded');
  });
});
