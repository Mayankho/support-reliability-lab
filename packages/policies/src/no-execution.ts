import { actionProposalSchema, type ProposedAction } from '@srl/contracts';

export class PolicyGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyGuardError';
  }
}

export type NoExecutionDecision =
  | { status: 'pass'; action: ProposedAction }
  | {
      status: 'fail';
      ruleId: 'NO_EXECUTION';
      reason: 'completion_claim' | 'confirmation_required';
    };

/**
 * Structural guard only. Reply-text completion checks belong to the independent graders.
 * This function never performs a refund, cancellation, restoration, or account change.
 */
export function guardProposedAction(value: unknown): NoExecutionDecision {
  const parsed = actionProposalSchema.safeParse(value);
  if (!parsed.success) {
    throw new PolicyGuardError('Action fields are invalid.');
  }

  if (parsed.data.claimsActionCompleted) {
    return { status: 'fail', ruleId: 'NO_EXECUTION', reason: 'completion_claim' };
  }
  if (parsed.data.proposedAction !== 'none' && !parsed.data.requiresExplicitConfirmation) {
    return { status: 'fail', ruleId: 'NO_EXECUTION', reason: 'confirmation_required' };
  }
  return { status: 'pass', action: parsed.data.proposedAction };
}
