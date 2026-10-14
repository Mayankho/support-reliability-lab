import type { RiskFlagCode } from '../taxonomy/schema.ts';
import type { SecretKind } from '../thread/text.ts';
import type { Feature } from './lexicon.ts';
import { MONEY_ISSUES } from './rules.ts';

export type EvidenceOrigin =
  | 'customer_reported'
  | 'agent_claimed'
  | 'verified_synthetic_state'
  | 'inferred_pattern'
  | 'unknown';

export interface FlagResult {
  code: RiskFlagCode;
  origin: EvidenceOrigin;
  reason: string;
}

/**
 * Risk flags, decided independently of the issue type. `F-ABUSE` needs account history and is never
 * set here. `F-OUT` needs volume across threads and is only set by the incident check.
 */
export function detectFlags(input: {
  customer: ReadonlySet<Feature>;
  secretKinds: readonly SecretKind[];
  issues: ReadonlyArray<string | null>;
  plans: readonly string[];
}): FlagResult[] {
  const { customer, secretKinds, issues, plans } = input;
  const flags: FlagResult[] = [];
  if (secretKinds.length > 0) {
    flags.push({ code: 'F-SEC', origin: 'inferred_pattern', reason: 'secret_like_value_present' });
  }
  if (
    customer.has('legal_framing') ||
    (customer.has('deadline_days') &&
      (customer.has('data_deletion') || customer.has('data_access_request')))
  ) {
    flags.push({
      code: 'F-LEG',
      origin: 'customer_reported',
      reason: 'legal_basis_or_deadline_stated',
    });
  }
  if (
    issues.some((issue) => issue !== null && MONEY_ISSUES.has(issue)) ||
    customer.has('wants_credits_back') ||
    (customer.has('credits_deducted') && customer.has('generation')) ||
    (customer.has('refund_word') && (customer.has('money_context') || customer.has('cash_word')))
  ) {
    flags.push({
      code: 'F-MON',
      origin: 'inferred_pattern',
      reason: 'money_or_credit_remedy_possible',
    });
  }
  if (customer.has('chargeback')) {
    flags.push({ code: 'F-CHB', origin: 'customer_reported', reason: 'dispute_mentioned' });
  }
  if (customer.has('vat_or_tax_id')) {
    flags.push({
      code: 'F-REG',
      origin: 'customer_reported',
      reason: 'regional_tax_requirement_stated',
    });
  }
  if (
    customer.has('cancel_request') ||
    customer.has('cancelled_already') ||
    customer.has('pricing_feedback')
  ) {
    flags.push({
      code: 'F-CHURN',
      origin: 'customer_reported',
      reason: 'cancellation_or_value_complaint',
    });
  }
  if (plans.includes('enterprise') || customer.has('enterprise_mention')) {
    flags.push({ code: 'F-ENT', origin: 'customer_reported', reason: 'enterprise_plan_reported' });
  }
  return flags;
}
