import type { Feature } from './lexicon.ts';

export const CLASSIFIER_VERSION = 'ticket-rules-1.0.0';

type Has = (feature: Feature) => boolean;

export interface IssueRule {
  id: string;
  l2: string;
  matches: (has: Has) => boolean;
}

const creditAsk = (has: Has) => has('credits_deducted') || has('wants_credits_back');
const jobProblem = (has: Has) =>
  (has('generation_stuck') && has('generation')) ||
  (has('generation_failed') && has('generation_strict'));
const moneyRefund = (has: Has) =>
  has('refund_word') && (has('money_context') || has('purchase_context') || has('cash_word'));

/**
 * Supported issue types. Anything else falls through to an explicit abstention: these rules cover a
 * representative, high-value subset of the 67 issue types, not all of them.
 */
export const ISSUE_RULES: readonly IssueRule[] = [
  {
    id: 'TR-CRD-01',
    l2: 'CRD-01',
    matches: (has) => creditAsk(has) && jobProblem(has) && !has('disliked_result'),
  },
  {
    id: 'TR-CRD-01-unexplained',
    l2: 'CRD-01',
    matches: (has) => has('credits_deducted') && has('unexplained_deduction'),
  },
  {
    id: 'TR-PRC-01',
    l2: 'PRC-01',
    matches: (has) =>
      (jobProblem(has) || (has('wants_job_fixed') && has('generation_strict'))) &&
      !(has('export_problem') && !has('generation_strict')),
  },
  {
    id: 'TR-CRD-05',
    l2: 'CRD-05',
    matches: (has) =>
      has('disliked_result') &&
      (has('wants_credits_back') || (has('refund_word') && has('credits'))) &&
      !has('generation_failed'),
  },
  {
    id: 'TR-GEN-01',
    l2: 'GEN-01',
    matches: (has) =>
      has('disliked_result') &&
      has('generation') &&
      !has('wants_credits_back') &&
      !has('refund_word') &&
      !has('generation_failed'),
  },
  {
    id: 'TR-CRD-02',
    l2: 'CRD-02',
    matches: (has) => has('purchase_credits') && has('credits_not_arrived'),
  },
  { id: 'TR-CRD-03', l2: 'CRD-03', matches: (has) => has('balance_mismatch') },
  {
    id: 'TR-BIL-02',
    l2: 'BIL-02',
    matches: (has) => has('duplicate_charge') || has('unexpected_charge'),
  },
  {
    id: 'TR-BIL-01',
    l2: 'BIL-01',
    matches: (has) =>
      moneyRefund(has) && !(has('wants_credits_back') && jobProblem(has) && !has('cash_word')),
  },
  { id: 'TR-BIL-03', l2: 'BIL-03', matches: (has) => has('cancel_request') },
  {
    id: 'TR-BIL-06',
    l2: 'BIL-06',
    matches: (has) => has('invoice_needed') && !has('duplicate_charge'),
  },
  {
    id: 'TR-PLN-01',
    l2: 'PLN-01',
    matches: (has) => has('pricing_feedback') && !has('cancel_request'),
  },
  { id: 'TR-API-01', l2: 'API-01', matches: (has) => has('api_auth_error') },
  { id: 'TR-API-03', l2: 'API-03', matches: (has) => has('api_rate_limit') },
  { id: 'TR-API-04', l2: 'API-04', matches: (has) => has('webhook_issue') },
  { id: 'TR-PRC-02', l2: 'PRC-02', matches: (has) => has('export_problem') },
  { id: 'TR-ACC-01', l2: 'ACC-01', matches: (has) => has('login_code_missing') },
  {
    id: 'TR-ACC-02',
    l2: 'ACC-02',
    matches: (has) => has('password_problem') && !has('account_compromised'),
  },
  {
    id: 'TR-PRV-01',
    l2: 'PRV-01',
    matches: (has) => has('data_deletion') || has('data_access_request'),
  },
  {
    id: 'TR-PRV-02',
    l2: 'PRV-02',
    matches: (has) => has('account_compromised') || has('other_workspace_request'),
  },
  { id: 'TR-NET-02', l2: 'NET-02', matches: (has) => has('outage_report') },
];

/** Pairs where the second issue is the same need as the first, so only the first is kept. */
export const SUBSUMED: ReadonlyArray<{ keep: string; drop: string; reason: string }> = [
  { keep: 'BIL-02', drop: 'BIL-01', reason: 'refund_of_unrecognized_charge' },
  { keep: 'PRV-02', drop: 'BIL-02', reason: 'charges_attributed_to_compromise' },
  { keep: 'PRV-02', drop: 'ACC-02', reason: 'credentials_attributed_to_compromise' },
];

/** Money or credit issue types: the customer may need a refund or grant, so `F-MON` applies. */
export const MONEY_ISSUES = new Set([
  'BIL-01',
  'BIL-02',
  'BIL-05',
  'CRD-01',
  'CRD-02',
  'CRD-04',
  'CRD-05',
  'WSP-02',
]);

export function matchRules(has: Has): Array<{ id: string; l2: string }> {
  return ISSUE_RULES.filter((rule) => rule.matches(has)).map(({ id, l2 }) => ({ id, l2 }));
}
