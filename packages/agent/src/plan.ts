import type { AgentInput, Decision, Intent, ProposedAction, Route } from '@srl/contracts';
import { extractSignals, type PolicyTopic, type Signals } from './signals.ts';

/**
 * Every outcome the agent can reach. The decision is fixed per reason, so a reply can never pair
 * a "propose" explanation with an "escalate" decision.
 */
export const REASONS = {
  workspace_mismatch: 'decline',
  unverified_bypass_attempt: 'decline',
  identity_unverified: 'escalate',
  ownership_or_disclosure_request: 'decline',
  account_compromise: 'escalate',
  account_deletion: 'escalate',
  identity_provider_unavailable: 'escalate',
  access_recovery: 'escalate',
  instruction_override_attempt: 'escalate',
  payment_disputed: 'escalate',
  service_unavailable: 'escalate',
  distinct_requests: 'clarify',
  refund_vs_restoration: 'clarify',
  billing_context_unclear: 'clarify',
  transaction_unidentified: 'clarify',
  status_unknown: 'clarify',
  policy_conflict: 'escalate',
  policy_stale: 'escalate',
  policy_missing: 'escalate',
  purchase_date_unknown: 'clarify',
  payment_unsettled: 'escalate',
  purchase_outside_window: 'escalate',
  purchase_partly_used: 'escalate',
  refund_review_eligible: 'propose_action',
  proration_review: 'escalate',
  cancellation_state_unconfirmed: 'escalate',
  plan_state_inconsistent: 'escalate',
  cancel_at_renewal: 'propose_action',
  ledger_mismatch: 'escalate',
  prolonged_processing: 'escalate',
  still_processing: 'answer',
  restoration_review_eligible: 'propose_action',
  no_credits_charged: 'answer',
  completed_not_failure: 'answer',
  restoration_context_missing: 'clarify',
  policy_answer: 'answer',
  unclear_request: 'clarify',
} as const satisfies Record<string, Decision>;

export type ReasonCode = keyof typeof REASONS;

export interface Plan {
  intent: Intent;
  reason: ReasonCode;
  decision: Decision;
  route: Route;
  proposedAction: ProposedAction;
  policyTopic: PolicyTopic | null;
}

/** Fictional 14-day window from KB-REFUND-001, inclusive. */
export const REFUND_REVIEW_WINDOW_DAYS = 14;

const TOPIC_DOC: Readonly<Record<PolicyTopic, string>> = {
  provenance: 'KB-KNOW-001',
  security: 'KB-SEC-001',
  cancellation: 'KB-CANCEL-001',
  credit: 'KB-CREDIT-001',
  generation: 'KB-GEN-001',
  refund: 'KB-REFUND-001',
  proration: 'KB-PRORATE-001',
  technical: 'KB-TECH-001',
};

export function topicDocId(intent: Intent, topic: PolicyTopic | null): string | null {
  switch (intent) {
    case 'refund_request':
      return 'KB-REFUND-001';
    case 'subscription_cancel':
      return 'KB-CANCEL-001';
    case 'proration_question':
      return 'KB-PRORATE-001';
    case 'credit_restoration':
    case 'generation_failure':
      return 'KB-GEN-001';
    case 'technical_support':
      return 'KB-TECH-001';
    case 'account_access':
      return 'KB-SEC-001';
    case 'policy_question':
      return topic === null ? null : TOPIC_DOC[topic];
    case 'other':
      return null;
    default:
      return assertNever(intent);
  }
}

export function classifyIntent(signals: Signals, input: AgentInput): Intent {
  const s = signals;
  const accountTopic =
    s.deletion ||
    s.ownershipChange ||
    s.compromise ||
    s.crossTenantRequest ||
    s.othersDataRequest ||
    ((s.disclosureRequest ||
      s.accessRecovery ||
      s.verificationBypass ||
      (s.accountObject && s.outage)) &&
      !s.refundRequested &&
      !s.cancel);

  if (s.policyQuestion) return 'policy_question';
  if (accountTopic) return 'account_access';
  if (s.proration) return 'proration_question';
  if (s.cancel || s.planStatusQuestion) return 'subscription_cancel';

  const generationContext = s.generation || input.account.generationStatus !== 'none';
  if (generationContext) {
    if (s.refundRequested && s.cashRefund && !s.refundOfCredits) return 'refund_request';
    if (s.restorationRequested || s.refundOfCredits) return 'credit_restoration';
    if (s.ledgerMismatch) return 'generation_failure';
    if (input.account.generationStatus === 'failed' && s.deductionReported)
      return 'credit_restoration';
    if (s.outage && !s.failureQuestion) return 'technical_support';
    return 'generation_failure';
  }
  if (s.restorationRequested) return 'credit_restoration';
  if (s.refundRequested || s.dispute) return 'refund_request';
  if (s.outage || s.statusUnknown) return 'technical_support';
  return 'other';
}

function routeFor(intent: Intent, signals: Signals): Route {
  switch (intent) {
    case 'refund_request':
    case 'subscription_cancel':
    case 'proration_question':
      return 'billing';
    case 'credit_restoration':
    case 'generation_failure':
      return signals.ledgerMismatch ? 'billing' : 'technical';
    case 'account_access':
      return 'account_security';
    case 'technical_support':
      if (signals.billingObject) return 'billing';
      if (signals.accountObject) return 'account_security';
      return 'technical';
    case 'policy_question':
      switch (signals.policyTopic) {
        case 'security':
          return 'account_security';
        case 'generation':
        case 'technical':
          return 'technical';
        case 'refund':
        case 'proration':
        case 'cancellation':
        case 'credit':
        case 'provenance':
        case null:
          return 'billing';
        default:
          return assertNever(signals.policyTopic);
      }
    case 'other':
      return 'self_serve';
    default:
      return assertNever(intent);
  }
}

const PROPOSALS: Partial<Record<ReasonCode, ProposedAction>> = {
  refund_review_eligible: 'request_refund_review',
  restoration_review_eligible: 'restore_generation_credits_review',
  cancel_at_renewal: 'cancel_at_renewal',
};

function decideReason(intent: Intent, s: Signals, input: AgentInput): ReasonCode {
  const { account, availablePolicyDocs } = input;

  // 1. Identity and isolation outrank everything the message says.
  if (account.actorWorkspaceId !== account.workspaceId) return 'workspace_mismatch';
  if (!account.authenticated) {
    const bypass =
      s.verificationBypass ||
      s.authorityClaim ||
      s.othersDataRequest ||
      s.ownershipChange ||
      s.crossTenantRequest;
    return bypass ? 'unverified_bypass_attempt' : 'identity_unverified';
  }
  if (s.ownershipChange || s.crossTenantRequest || s.othersDataRequest) {
    return 'ownership_or_disclosure_request';
  }

  // 2. Instructions inside the message never change policy or outcomes.
  if (s.instructionOverride) return 'instruction_override_attempt';

  if (intent === 'account_access') {
    if (s.compromise) return 'account_compromise';
    if (s.deletion) return 'account_deletion';
    if (s.outage) return 'identity_provider_unavailable';
    if (s.accessRecovery) return 'access_recovery';
    return 'unclear_request';
  }

  // 3. Escalation triggers that do not depend on the specific request.
  if (account.disputed || s.dispute) return 'payment_disputed';
  if (s.outage) return 'service_unavailable';

  // 4. Distinct intents stay distinct; missing context gets one clarifying question.
  if (intent === 'subscription_cancel' && (s.refundRequested || s.refundOfCredits))
    return 'distinct_requests';
  if (intent === 'refund_request' && account.generationStatus !== 'none' && s.cashRefund) {
    return 'refund_vs_restoration';
  }
  if (s.billingUnclear) return 'billing_context_unclear';
  if (intent === 'refund_request' && s.vagueTransaction) return 'transaction_unidentified';
  if (intent === 'technical_support' && s.statusUnknown) return 'status_unknown';

  // 5. Knowledge provenance: never answer from a document that is missing, stale, or contradicted.
  if (s.docsConflict) return 'policy_conflict';
  if (s.docsStale) return 'policy_stale';
  const requiredDoc = topicDocId(intent, s.policyTopic);
  const supplied = new Set(availablePolicyDocs.map((doc) => doc.id));
  if (availablePolicyDocs.length === 0 || (requiredDoc !== null && !supplied.has(requiredDoc))) {
    return 'policy_missing';
  }

  // 6. Request-specific policy.
  switch (intent) {
    case 'refund_request':
      if (account.lastPurchaseAgeDays === null) return 'purchase_date_unknown';
      if (account.paymentSettled !== true) return 'payment_unsettled';
      if (account.lastPurchaseAgeDays > REFUND_REVIEW_WINDOW_DAYS) return 'purchase_outside_window';
      if (account.lastPurchaseCreditsUsed > 0) return 'purchase_partly_used';
      if (account.lastPurchaseCreditsGranted === 0) return 'transaction_unidentified';
      return 'refund_review_eligible';
    case 'proration_question':
      return 'proration_review';
    case 'subscription_cancel':
      if (account.planStatus === 'cancel_pending') return 'cancellation_state_unconfirmed';
      if (account.planStatus === 'inactive') return 'plan_state_inconsistent';
      if (account.subscription === 'free') return 'unclear_request';
      return 'cancel_at_renewal';
    case 'credit_restoration':
    case 'generation_failure':
      if (s.ledgerMismatch) return 'ledger_mismatch';
      switch (account.generationStatus) {
        case 'processing':
          return s.prolongedWait ? 'prolonged_processing' : 'still_processing';
        case 'failed':
          return account.generationChargedCredits > 0
            ? 'restoration_review_eligible'
            : 'no_credits_charged';
        case 'completed':
          return 'completed_not_failure';
        case 'none':
          return 'restoration_context_missing';
        default:
          return assertNever(account.generationStatus);
      }
    case 'technical_support':
      return 'status_unknown';
    case 'policy_question':
      return 'policy_answer';
    case 'other':
      return 'unclear_request';
    default:
      return assertNever(intent);
  }
}

export function planResponse(input: AgentInput): Plan {
  const signals = extractSignals(input.message, input.account);
  const intent = classifyIntent(signals, input);
  const reason = decideReason(intent, signals, input);
  const decision = REASONS[reason];

  let route: Route;
  if (
    reason === 'workspace_mismatch' ||
    reason === 'unverified_bypass_attempt' ||
    reason === 'identity_unverified'
  ) {
    route = 'account_security';
  } else if (reason === 'ownership_or_disclosure_request') {
    route = 'account_security';
  } else if (reason === 'instruction_override_attempt') {
    route =
      intent === 'policy_question' || intent === 'other'
        ? 'account_security'
        : routeFor(intent, signals);
  } else if (decision === 'answer' && intent === 'policy_question') {
    route = 'self_serve';
  } else {
    route = routeFor(intent, signals);
  }

  return {
    intent,
    reason,
    decision,
    route,
    proposedAction: PROPOSALS[reason] ?? 'none',
    policyTopic: signals.policyTopic,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${String(value)}`);
}
