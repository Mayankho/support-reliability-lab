import { describe, expect, it } from 'vitest';
import { goldenCaseSchema } from './case.ts';

const account = {
  workspaceId: 'ws_alpha',
  actorWorkspaceId: 'ws_alpha',
  authenticated: true,
  subscription: 'annual',
  planStatus: 'active',
  purchasedCreditsRemaining: 0,
  lastPurchaseCreditsGranted: 0,
  lastPurchaseCreditsUsed: 0,
  lastPurchaseAgeDays: null,
  paymentSettled: null,
  disputed: false,
  generationStatus: 'completed',
  generationChargedCredits: 5,
};

const validCase = {
  id: 'GEN-001',
  category: 'generation_credits',
  risk: 'high',
  input: {
    message: 'The finished video is not what I wanted.',
    account,
  },
  availablePolicyIds: ['KB-GEN-001'],
  expected: {
    intent: 'generation_failure',
    decision: 'decline',
    route: 'technical',
    proposedAction: 'none',
    mustEscalate: false,
    requiredPolicyIds: ['KB-GEN-001'],
    forbiddenClaims: [],
    requiredResponseConcepts: ['completed'],
    rationale: 'A completed generation is not automatically a restoration.',
  },
  tags: ['synthetic'],
};

describe('golden case contract', () => {
  it('accepts a complete golden case', () => {
    expect(goldenCaseSchema.parse(validCase)).toEqual(validCase);
  });

  it('rejects a rationale that is too short to record the labeling decision', () => {
    const result = goldenCaseSchema.safeParse({
      ...validCase,
      expected: {
        ...validCase.expected,
        rationale: 'too short',
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('rationale'))).toBe(true);
    }
  });

  it('rejects a duplicate available policy id', () => {
    const result = goldenCaseSchema.safeParse({
      ...validCase,
      availablePolicyIds: ['KB-GEN-001', 'KB-GEN-001'],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('availablePolicyIds'))).toBe(
        true,
      );
    }
  });
});
