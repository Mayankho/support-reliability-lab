import type { EscalationReasonCode, ReplyContext, ReplyCopy } from './types.ts';

const POLICY_SUMMARIES: Readonly<Record<string, string>> = {
  'KB-CREDIT-001':
    'Credits are product units, not cash. Purchased credits and the credits charged or restored for generations are tracked separately, and neither converts into a cash refund.',
  'KB-CANCEL-001':
    'Cancelling stops your subscription from renewing at the end of the current period. It is not the same as a refund; refunds of past payments are reviewed separately.',
  'KB-GEN-001':
    'A failed generation that charged credits can be proposed for a restoration review. A completed generation you dislike is not automatically a failure, and a job that is still processing is not a confirmed failure.',
  'KB-SEC-001':
    'Account support requires you to be signed in to the workspace in question. If you have lost access, our account security team verifies your identity first, and account data is never shared across workspaces.',
  'KB-KNOW-001':
    'I only cite policy documents I have actually been given. If the policy needed to answer is missing or contradicts another document, I say so and escalate to a specialist instead of guessing.',
  'KB-REFUND-001':
    'A recent purchase of unused credits with a settled payment and no dispute can be proposed for a human refund review. Partial use, an older purchase, a dispute, or an unknown payment status needs a specialist. A review is not a guarantee.',
  'KB-PRORATE-001':
    'Annual-plan changes and proration are reviewed by a billing specialist with your transaction history. I do not estimate prorated amounts.',
  'KB-TECH-001':
    'When a provider is down or a status is missing, I explain what is known, suggest safe next steps, and route incidents to the technical team.',
};

function policyAnswer({ citedDocIds }: ReplyContext): string {
  const answered = citedDocIds.filter((id) => id in POLICY_SUMMARIES);
  if (answered.length === 0) {
    return 'I could not find a policy document that answers this, so I would rather not guess. Could you tell me a little more about what you need?';
  }
  const body = answered.map((id) => POLICY_SUMMARIES[id]).join(' ');
  return `${body} (Source: ${answered.join(', ')}.)`;
}

function plural(count: number, unit: string): string {
  return `${String(count)} ${unit}${count === 1 ? '' : 's'}`;
}

/**
 * Customer-facing copy for every outcome. Proposals describe what will be requested and say plainly
 * that nothing has happened yet; there is no executor behind any of these messages.
 */
export const REFERENCE_COPY: ReplyCopy = {
  workspace_mismatch: () =>
    "I can't share or change anything in a workspace you aren't signed in to. If you need access, the workspace owner can invite you, or our account security team can verify your role.",
  unverified_bypass_attempt: () =>
    "I can't skip identity verification or share account details before you sign in, whatever role or credential the message mentions. Please sign in normally; if you can't, our account security team can verify you.",
  identity_unverified: () =>
    "I need to confirm your identity before I can look at billing or account details. I'm handing this to our account security team, who can verify you and then help with your request.",
  ownership_or_disclosure_request: () =>
    "I can't transfer account ownership or disclose anyone else's data, regardless of the role described in the message. Ownership changes go through a verified process with our account security team.",
  account_compromise: () =>
    "That sounds serious, and I want it looked at quickly. I'm escalating this to our account security team so they can review access to your account. I haven't changed anything on the account myself.",
  account_deletion: () =>
    "Deleting an account is a protected change that our account security team must verify first, and any refund question goes with it for review. I'm passing both to them; nothing has been deleted or refunded.",
  identity_provider_unavailable: () =>
    "Our sign-in verification service appears to be unavailable, so I can't verify your login right now. I'm routing this to account security so a specialist can confirm your identity once it's back.",
  access_recovery: () =>
    "I'm sorry you've lost access. Account recovery needs identity verification by our account security team, so I'm handing this to them. They can verify you and help you get back in.",
  instruction_override_attempt: () =>
    "I can't follow instructions to set aside policy or to state an outcome that hasn't happened. No refund, cancellation, or account change has been made from this conversation. I'm passing this to a specialist to review.",
  payment_disputed: () =>
    "Because there's an open payment dispute, I can't start a refund review here. I'm escalating to our billing team so they can look at the dispute and your refund question together.",
  service_unavailable: () =>
    "One of the systems needed to answer this is unavailable right now, so I can't confirm the current status and won't guess. I'm routing this to a specialist who can check once it's back.",
  distinct_requests: () =>
    'These are two separate requests: stopping future renewals, and getting money back for a past payment. Which would you like to start with? Cancelling stops the next renewal; a refund of a past payment needs its own review.',
  refund_vs_restoration: () =>
    'A failed generation can be reviewed for restoring the credits it used, which is different from a cash refund of a payment. Are you asking for a credit restoration review, or a refund of a specific payment?',
  billing_context_unclear: () =>
    "I'd like to help with your bill. Which invoice or month looks wrong, and which plan were you on at the time?",
  transaction_unidentified: () =>
    "I can't guess which transaction you mean. Which purchase or charge would you like reviewed, and roughly when was it?",
  status_unknown: () =>
    "I can't see the status you're describing yet. Which page or job are you looking at, and what does it show right now?",
  policy_conflict: () =>
    "The policy documents available to me conflict, and I can't tell which one applies. I'm escalating so a specialist can confirm the current policy before anything is promised.",
  policy_stale: () =>
    "The document I have may be out of date, so I can't promise an outcome based on it. I'm escalating so a specialist can confirm the current policy.",
  policy_missing: () =>
    "I don't have the policy document needed to answer this reliably, so I won't guess. I'm escalating to a specialist who can check the current policy.",
  purchase_date_unknown: () =>
    "I couldn't find the date of your last credit purchase. Roughly when did you buy the credits, or do you have the receipt?",
  payment_unsettled: () =>
    "That payment hasn't settled yet, so it can't go through a refund review. I'm escalating to our billing team to check the payment status.",
  purchase_outside_window: ({ account }) =>
    `Your last credit purchase was ${plural(account.lastPurchaseAgeDays ?? 0, 'day')} ago, which is outside the window for a standard refund review. I'm escalating it to our billing team to look at the details, and I can't promise an outcome.`,
  purchase_partly_used: ({ account }) =>
    `${plural(account.lastPurchaseCreditsUsed, 'credit')} from that purchase ${account.lastPurchaseCreditsUsed === 1 ? 'has' : 'have'} been used, which takes it outside a standard refund review. I'm escalating to our billing team to review the options.`,
  refund_review_eligible: ({ account }) =>
    `Your purchase of ${plural(account.lastPurchaseCreditsGranted, 'credit')} is unused and recent enough for a refund review. I can send it to our billing team for that review. Nothing has been refunded yet, and approval isn't guaranteed. Would you like me to submit the review request?`,
  proration_review: () =>
    "Annual-plan changes and proration need a billing specialist with your transaction history, so I won't estimate an amount. I'm escalating this to our billing team for review.",
  cancellation_state_unconfirmed: () =>
    "Your plan shows a pending cancellation, but I can't confirm the final state of your subscription or any renewal invoice from here. I'm escalating to our billing team to confirm it.",
  plan_state_inconsistent: () =>
    "Your plan shows as inactive, so that notice is unexpected. I'm escalating to our billing team to check what was sent and why.",
  cancel_at_renewal: () =>
    "I can set your subscription to cancel at the end of the current billing period so it won't renew. That doesn't refund past payments. Would you like me to submit the cancellation request?",
  ledger_mismatch: () =>
    "The records you're describing don't line up, and I don't want to guess which is right. I'm escalating to our billing team to reconcile the charge and your credit balance.",
  prolonged_processing: () =>
    "A generation that has been processing this long needs a look from our technical team, so I'm escalating it. It hasn't been marked as failed, so no credit decision has been made yet.",
  still_processing: () =>
    "This generation is still processing, which isn't a confirmed failure. Credits for a job are only reviewed for restoration if it actually fails. If it stays stuck, let me know and I'll escalate it.",
  restoration_review_eligible: ({ account }) =>
    `This generation failed after ${plural(account.generationChargedCredits, 'credit')} ${account.generationChargedCredits === 1 ? 'was' : 'were'} charged. I can propose a review to restore ${account.generationChargedCredits === 1 ? 'it' : 'them'}. Nothing has been restored yet. Would you like me to submit the review request?`,
  no_credits_charged: () =>
    "This failed generation doesn't show any credits charged, so there's nothing to restore. If you're seeing a different balance somewhere, tell me where and I'll look into it.",
  completed_not_failure: () =>
    "This generation completed, so it isn't treated as a failure, and disliking the result doesn't make it eligible for automatic credit restoration. I'm happy to suggest ways to get closer to what you want on the next run.",
  restoration_context_missing: () =>
    "I don't see a recent failed generation on your account. Which job do you mean, and what status does it show?",
  policy_answer: policyAnswer,
  unclear_request: () => 'Could you tell me a bit more about what you need help with?',
};

export const ESCALATION_REASONS: Readonly<Record<EscalationReasonCode, string>> = {
  identity_unverified:
    'Identity not verified; account security must verify before any account or billing help.',
  account_compromise: 'Reported unauthorized access; account security review required.',
  account_deletion: 'Account deletion is a protected change that requires verified handling.',
  identity_provider_unavailable: 'Identity verification provider unavailable.',
  access_recovery: 'Account recovery requires identity verification.',
  instruction_override_attempt: 'Message attempts to override policy or dictate a false outcome.',
  payment_disputed: 'Open payment dispute on the account.',
  service_unavailable: 'A system needed to confirm status is unavailable.',
  policy_conflict: 'Supplied policy documents conflict.',
  policy_stale: 'Supplied policy document may be out of date.',
  policy_missing: 'Required policy document was not supplied.',
  payment_unsettled: 'Payment has not settled.',
  purchase_outside_window: 'Purchase is outside the refund review window.',
  purchase_partly_used: 'Credits from the purchase have been used.',
  proration_review: 'Proration requires billing specialist review.',
  cancellation_state_unconfirmed: 'Cancellation state cannot be confirmed from available data.',
  plan_state_inconsistent: 'Plan state is inconsistent with the reported notice.',
  ledger_mismatch: 'Reported charge and credit records disagree.',
  prolonged_processing: 'Generation has been processing for an extended time.',
};
