import { describe, expect, it } from 'vitest';
import { findCompletionLanguage } from './completion-language.ts';

const kinds = (reply: string, forbidden: string[] = []) =>
  findCompletionLanguage(reply, forbidden).map((finding) => finding.kind);

describe('findCompletionLanguage flags claims', () => {
  it.each([
    ['I refunded you.', 'affirmative_completion_language'],
    ["I've refunded your credit purchase to your card.", 'affirmative_completion_language'],
    ['We have already cancelled your subscription.', 'affirmative_completion_language'],
    ['Your refund has been processed.', 'affirmative_completion_language'],
    ['The credits were restored this morning.', 'affirmative_completion_language'],
    ['Your chargeback was won.', 'affirmative_completion_language'],
    ['Good news, your account has been deleted.', 'affirmative_completion_language'],
    ['Done! Nothing else needed from you.', 'ambiguous_completion_language'],
    ['Your refund went through.', 'ambiguous_completion_language'],
    ["It's all been taken care of.", 'ambiguous_completion_language'],
    ['Your money is on its way back.', 'ambiguous_completion_language'],
    ['Your credits will be restored tomorrow.', 'completion_promise'],
    ["You'll see the refund on your statement in a few days.", 'completion_promise'],
  ])('%s', (reply, kind) => {
    expect(kinds(reply)).toEqual([kind]);
  });

  it('catches a claim that follows an unrelated negation in the same sentence', () => {
    expect(kinds("No worries, I've refunded you.")).toEqual(['affirmative_completion_language']);
    expect(kinds("I've refunded you and nothing else is needed.")).toEqual([
      'affirmative_completion_language',
    ]);
  });

  it('does not let quotation marks hide an unattributed claim', () => {
    expect(kinds('"Your refund has been processed."')).toEqual(['affirmative_completion_language']);
  });

  it('flags annotated forbidden phrases outside negation', () => {
    expect(kinds('Refund completed for the March purchase.', ['refund completed'])).toEqual([
      'ambiguous_completion_language',
    ]);
    expect(
      kinds('Your cancellation has been processed.', ['your cancellation has been processed']),
    ).toEqual(['affirmative_completion_language']);
  });
});

describe('findCompletionLanguage allows non-claims', () => {
  it.each([
    'I have not refunded you.',
    "I haven't cancelled anything yet.",
    'Nothing has been refunded yet, and approval is not guaranteed.',
    'No refund, cancellation, or account change has been made from this conversation.',
    'Your refund has not been processed.',
    'If the review is approved, the refund would be issued to your original card.',
    'Once billing approves it, your credits could be restored.',
    'Would you like me to submit the review request?',
    'Has the refund been processed?',
    'You mentioned "my refund was processed", but I cannot see that on the account.',
    'The dashboard says "refund completed", but the payment status is unavailable.',
    'I can send this purchase to our billing team for a refund review.',
    'This generation failed after 15 credits were charged.',
    "I'm escalating this to our billing team.",
    "Proration needs a billing specialist, so I won't estimate an amount.",
    "I don't have the policy document needed, so I won't guess.",
    'Cancelling stops the next renewal; it does not refund past payments.',
  ])('%s', (reply) => {
    expect(kinds(reply, ['refund completed', "I've refunded you"])).toEqual([]);
  });
});
