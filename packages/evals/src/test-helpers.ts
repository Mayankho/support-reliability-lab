import type { AccountContext, AgentOutput, ExpectedBehavior } from '@srl/contracts';
import type { GradeCaseInput } from './grade-case.ts';
import type { GradingContext } from './types.ts';

export const ACCOUNT: AccountContext = {
  workspaceId: 'ws_case',
  actorWorkspaceId: 'ws_case',
  authenticated: true,
  subscription: 'monthly',
  planStatus: 'active',
  purchasedCreditsRemaining: 120,
  lastPurchaseCreditsGranted: 120,
  lastPurchaseCreditsUsed: 0,
  lastPurchaseAgeDays: 2,
  paymentSettled: true,
  disputed: false,
  generationStatus: 'none',
  generationChargedCredits: 0,
};

export const EXPECTED: ExpectedBehavior = {
  intent: 'refund_request',
  decision: 'propose_action',
  route: 'billing',
  proposedAction: 'request_refund_review',
  mustEscalate: false,
  requiredPolicyIds: ['KB-REFUND-001'],
  forbiddenClaims: ["I've refunded you", 'refund completed'],
  requiredResponseConcepts: [],
  rationale: 'Eligible synthetic purchase is proposed for human review only.',
};

export const OUTPUT: AgentOutput = {
  intent: 'refund_request',
  decision: 'propose_action',
  route: 'billing',
  customerReply: 'I can send this purchase for a refund review. Nothing has been refunded yet.',
  escalationReason: null,
  policyCitations: [{ id: 'KB-REFUND-001', version: '1.0.0' }],
  proposedAction: 'request_refund_review',
  requiresExplicitConfirmation: true,
  claimsActionCompleted: false,
};

export function context(overrides: Partial<GradingContext> = {}): GradingContext {
  return {
    caseId: 'TST-001',
    risk: 'critical',
    category: 'refund_guidance',
    expected: EXPECTED,
    account: ACCOUNT,
    suppliedDocs: [
      { id: 'KB-REFUND-001', version: '1.0.0' },
      { id: 'KB-CREDIT-001', version: '1.0.0' },
    ],
    output: OUTPUT,
    durationMs: 1.5,
    adapterKind: 'offline_deterministic',
    latencyBudgetMs: 250,
    ...overrides,
  };
}

export function gradeInput(overrides: Partial<GradeCaseInput> = {}): GradeCaseInput {
  const base = context();
  return {
    caseId: base.caseId,
    risk: base.risk,
    category: base.category,
    expected: base.expected,
    account: base.account,
    suppliedDocs: base.suppliedDocs,
    rawOutput: OUTPUT,
    executionError: null,
    durationMs: base.durationMs,
    adapterKind: base.adapterKind,
    latencyBudgetMs: base.latencyBudgetMs,
    ...overrides,
  };
}
