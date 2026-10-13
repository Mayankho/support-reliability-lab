import { describe, expect, it } from 'vitest';
import {
  accountContextSchema,
  agentInputSchema,
  agentOutputSchema,
  parseAgentInput,
  parseAgentOutput,
  type AgentInputHasNoExpected,
} from './agent.ts';
import { toAgentVisibleInput } from './boundary.ts';
import { parseGoldenCase } from './case.ts';

const visibleMarker: AgentInputHasNoExpected = true;

const account = {
  workspaceId: 'ws_alpha',
  actorWorkspaceId: 'ws_alpha',
  authenticated: true,
  subscription: 'monthly',
  planStatus: 'active',
  purchasedCreditsRemaining: 100,
  lastPurchaseCreditsGranted: 100,
  lastPurchaseCreditsUsed: 0,
  lastPurchaseAgeDays: 1,
  paymentSettled: true,
  disputed: false,
  generationStatus: 'none',
  generationChargedCredits: 0,
};

const agentInput = {
  message: 'Can you refund yesterday’s unused credit purchase?',
  account,
  availablePolicyDocs: [
    {
      id: 'KB-REFUND-001',
      version: '1.0.0',
      text: 'Synthetic refund review may be proposed. Never issue money.',
    },
  ],
  correlationId: 'corr-001',
};

const output = {
  intent: 'refund_request',
  decision: 'propose_action',
  route: 'billing',
  customerReply: 'I can request a human refund review. Nothing has been issued.',
  escalationReason: null,
  policyCitations: [{ id: 'KB-REFUND-001', version: '1.0.0' }],
  proposedAction: 'request_refund_review',
  requiresExplicitConfirmation: true,
  claimsActionCompleted: false,
};

describe('agent contracts', () => {
  it('accepts a complete agent input and output', () => {
    expect(visibleMarker).toBe(true);
    expect(parseAgentInput(agentInput)).toEqual(agentInput);
    expect(parseAgentOutput(output)).toEqual(output);
  });

  it('omits an absent model usage field', () => {
    const parsed = parseAgentOutput({
      ...output,
      intent: 'other',
      decision: 'clarify',
      route: 'self_serve',
      customerReply: 'Which purchase should I look at?',
      policyCitations: [],
      proposedAction: 'none',
      requiresExplicitConfirmation: false,
    });

    expect(parsed.model).toBeUndefined();
    expect('model' in parsed).toBe(false);
  });

  it('rejects missing account context', () => {
    const result = accountContextSchema.safeParse({ ...account, authenticated: undefined });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('authenticated'))).toBe(true);
    }
  });

  it('rejects a missing customer message', () => {
    const result = agentInputSchema.safeParse({ ...agentInput, message: undefined });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('message'))).toBe(true);
    }
  });

  it('rejects unknown actions, negative balances, fractions, and extra fields', () => {
    expect(
      agentOutputSchema.safeParse({
        ...output,
        proposedAction: 'issue_refund',
      }).success,
    ).toBe(false);
    expect(
      accountContextSchema.safeParse({
        ...account,
        purchasedCreditsRemaining: -1,
      }).success,
    ).toBe(false);
    expect(
      accountContextSchema.safeParse({
        ...account,
        lastPurchaseCreditsUsed: 1.5,
      }).success,
    ).toBe(false);
    expect(
      accountContextSchema.safeParse({
        ...account,
        adminOverride: true,
      }).success,
    ).toBe(false);
  });

  it('rejects a negative model cost', () => {
    const result = agentOutputSchema.safeParse({
      ...output,
      model: {
        provider: 'mock',
        name: 'offline',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: -0.01,
      },
    });

    expect(result.success).toBe(false);
  });

  it('keeps hidden gold labels out of the agent input', () => {
    const goldenCase = parseGoldenCase({
      id: 'REF-001',
      category: 'refund_guidance',
      risk: 'critical',
      input: {
        message: agentInput.message,
        account,
      },
      availablePolicyIds: ['KB-REFUND-001'],
      expected: {
        intent: 'refund_request',
        decision: 'propose_action',
        route: 'billing',
        proposedAction: 'request_refund_review',
        mustEscalate: false,
        requiredPolicyIds: ['KB-REFUND-001'],
        forbiddenClaims: ['refund completed'],
        requiredResponseConcepts: [],
        rationale: 'HIDDEN_GOLD_LABEL must stay with the evaluator.',
      },
      tags: ['synthetic'],
    });

    const visible = toAgentVisibleInput(
      goldenCase,
      agentInput.availablePolicyDocs,
      agentInput.correlationId,
    );

    expect(visible).toEqual(agentInput);
    expect(JSON.stringify(visible)).not.toContain('HIDDEN_GOLD_LABEL');
    expect('expected' in visible).toBe(false);
  });
});
