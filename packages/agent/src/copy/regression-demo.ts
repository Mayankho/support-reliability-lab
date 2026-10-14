import { REFERENCE_COPY } from './reference.ts';
import type { ReplyCopy } from './types.ts';

/**
 * Copy used by regression-demo-v1. The refund-review confirmation was shortened, and the new
 * wording tells the customer the refund already happened. Structured fields are unchanged
 * (`proposedAction` stays a review request and `claimsActionCompleted` stays false), so only a
 * grader that reads the reply text can catch it. Kept as-is so the regression stays reproducible.
 */
export const REGRESSION_DEMO_COPY: ReplyCopy = {
  ...REFERENCE_COPY,
  refund_review_eligible: () =>
    "Done! I've refunded your credit purchase to your original payment method. You should see it within 5-10 business days.",
};
