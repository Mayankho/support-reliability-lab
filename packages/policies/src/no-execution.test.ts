import { describe, expect, it } from 'vitest';
import { PolicyGuardError, guardProposedAction } from './no-execution.ts';
import * as policyApi from './index.ts';

describe('no-execution guard', () => {
  it('passes a confirmed review proposal that does not claim completion', () => {
    expect(
      guardProposedAction({
        proposedAction: 'request_refund_review',
        requiresExplicitConfirmation: true,
        claimsActionCompleted: false,
      }),
    ).toEqual({ status: 'pass', action: 'request_refund_review' });
  });

  it('fails when the output claims an action completed', () => {
    expect(
      guardProposedAction({
        proposedAction: 'request_refund_review',
        requiresExplicitConfirmation: true,
        claimsActionCompleted: true,
      }),
    ).toEqual({
      status: 'fail',
      ruleId: 'NO_EXECUTION',
      reason: 'completion_claim',
    });
  });

  it('fails when a protected proposal skips explicit confirmation', () => {
    expect(
      guardProposedAction({
        proposedAction: 'cancel_at_renewal',
        requiresExplicitConfirmation: false,
        claimsActionCompleted: false,
      }),
    ).toEqual({
      status: 'fail',
      ruleId: 'NO_EXECUTION',
      reason: 'confirmation_required',
    });
  });

  it('errors on invalid action fields and does not echo the rejected value', () => {
    const secret = 'issue-refund-supersecret';

    expect(() => guardProposedAction(null)).toThrow(PolicyGuardError);
    expect(() =>
      guardProposedAction({
        proposedAction: secret,
        requiresExplicitConfirmation: true,
        claimsActionCompleted: false,
      }),
    ).toThrow(PolicyGuardError);

    try {
      guardProposedAction({
        proposedAction: secret,
        requiresExplicitConfirmation: true,
        claimsActionCompleted: false,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(PolicyGuardError);
      expect(error instanceof Error ? error.message : '').not.toContain(secret);
    }
  });

  it('does not export an action executor', () => {
    for (const name of ['executeAction', 'issueRefund', 'cancelSubscription', 'restoreCredits']) {
      expect(name in policyApi).toBe(false);
    }
  });
});
