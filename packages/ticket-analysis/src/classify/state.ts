import { z } from 'zod';
import type { Feature } from './lexicon.ts';

/**
 * Trusted fictional account state for a synthetic thread, standing in for a verified lookup. A
 * message, an agent reply, or a classification can never produce this; only the caller supplies it.
 */
export const syntheticStateSchema = z.strictObject({
  generation: z
    .strictObject({
      status: z.enum(['none', 'processing', 'failed', 'completed']),
      chargedCredits: z.number().int().min(0).max(1_000_000),
      creditsReturned: z.boolean(),
    })
    .optional(),
  charges: z
    .strictObject({
      settled: z.number().int().min(0).max(100),
      pending: z.number().int().min(0).max(100),
    })
    .optional(),
  apiKey: z
    .strictObject({
      status: z.enum(['active', 'revoked', 'rotated']),
      revokedByOwnerPasswordReset: z.boolean(),
    })
    .optional(),
});
export type SyntheticState = z.infer<typeof syntheticStateSchema>;

interface L3Rule {
  id: string;
  l3: string;
  parent: string;
  confirmed: (state: SyntheticState) => boolean;
}

/** Diagnostic options that trusted synthetic state can confirm. Every other L3 stays unconfirmed. */
const L3_RULES: readonly L3Rule[] = [
  {
    id: 'L3-CRD-01a',
    l3: 'CRD-01a',
    parent: 'CRD-01',
    confirmed: ({ generation }) =>
      generation?.status === 'failed' &&
      generation.chargedCredits > 0 &&
      !generation.creditsReturned,
  },
  {
    id: 'L3-PRC-01c',
    l3: 'PRC-01c',
    parent: 'PRC-01',
    confirmed: ({ generation }) => generation?.status === 'failed',
  },
  {
    id: 'L3-BIL-02a',
    l3: 'BIL-02a',
    parent: 'BIL-02',
    confirmed: ({ charges }) => charges?.settled === 1 && charges.pending >= 1,
  },
  {
    id: 'L3-BIL-02b',
    l3: 'BIL-02b',
    parent: 'BIL-02',
    confirmed: ({ charges }) => (charges?.settled ?? 0) >= 2,
  },
  {
    id: 'L3-API-01a',
    l3: 'API-01a',
    parent: 'API-01',
    confirmed: ({ apiKey }) => apiKey?.status === 'revoked' && apiKey.revokedByOwnerPasswordReset,
  },
];

export function confirmL3(
  issues: ReadonlyArray<string | null>,
  state: SyntheticState | undefined,
): { l3: string; ruleId: string } | null {
  if (state === undefined) return null;
  for (const issue of issues) {
    const rule = L3_RULES.find(
      (candidate) => candidate.parent === issue && candidate.confirmed(state),
    );
    if (rule !== undefined) return { l3: rule.l3, ruleId: rule.id };
  }
  return null;
}

/** Evidence codes describing the synthetic state, for display next to what the customer reported. */
export function stateEvidence(state: SyntheticState): string[] {
  const codes: string[] = [];
  if (state.generation !== undefined) {
    codes.push(`generation_${state.generation.status}`);
    codes.push(state.generation.chargedCredits > 0 ? 'credits_charged' : 'no_credits_charged');
    if (state.generation.creditsReturned) codes.push('credits_returned');
  }
  if (state.charges !== undefined) {
    codes.push(`charges_settled_${String(state.charges.settled)}`);
    if (state.charges.pending > 0) codes.push('charge_pending');
  }
  if (state.apiKey !== undefined) codes.push(`api_key_${state.apiKey.status}`);
  return codes;
}

/** Places where what the customer said disagrees with the trusted synthetic state. */
export function contradictions(customer: ReadonlySet<Feature>, state: SyntheticState): string[] {
  const found: string[] = [];
  const status = state.generation?.status;
  if (customer.has('generation_failed') && status === 'processing') {
    found.push('generation_reported_failed_but_processing');
  }
  if (customer.has('generation_stuck') && status === 'failed') {
    found.push('generation_reported_stuck_but_failed');
  }
  if (
    (customer.has('generation_failed') || customer.has('generation_stuck')) &&
    status === 'completed'
  ) {
    found.push('generation_reported_incomplete_but_completed');
  }
  if (customer.has('credits_deducted') && state.generation?.chargedCredits === 0) {
    found.push('credits_reported_charged_but_none_charged');
  }
  if (
    customer.has('duplicate_charge') &&
    state.charges !== undefined &&
    state.charges.settled < 2
  ) {
    found.push('duplicate_reported_but_not_settled_twice');
  }
  return found;
}
