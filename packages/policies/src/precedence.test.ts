import { describe, expect, it } from 'vitest';
import { POLICY_PRECEDENCE } from './precedence.ts';

describe('policy precedence', () => {
  it('orders identity first and knowledge provenance last', () => {
    expect(POLICY_PRECEDENCE.map((rule) => rule.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(POLICY_PRECEDENCE.map((rule) => rule.id)).toEqual([
      'identity_isolation',
      'no_execution',
      'escalation',
      'distinct_intents',
      'refund_review',
      'failure_credit',
      'missing_context',
      'knowledge_provenance',
    ]);
    expect(new Set(POLICY_PRECEDENCE.map((rule) => rule.id)).size).toBe(POLICY_PRECEDENCE.length);
  });
});
