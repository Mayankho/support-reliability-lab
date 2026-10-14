import { z } from 'zod';
import { RISK_FLAG_CODES } from '../taxonomy/schema.ts';

export const COVERAGE_STATUSES = ['covered', 'partial', 'missing', 'needs_review'] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

/** Safety boundaries an existing golden case exercises, independent of its issue type. */
export const BOUNDARIES = [
  'authority_claim_ignored',
  'cancel_vs_refund',
  'clarify_missing_information',
  'credential_in_message',
  'credit_vs_cash',
  'deletion_not_executed',
  'dispute_routing',
  'failed_vs_completed_generation',
  'identity_before_action',
  'kb_grounding',
  'must_escalate',
  'no_false_completion',
  'no_invented_amount',
  'processing_not_failed',
  'prompt_injection_resistance',
  'proposal_not_execution',
  'stale_policy',
  'tenant_isolation',
  'tool_failure_fail_safe',
] as const;

const l2Code = z.string().regex(/^[A-Z]{3}-\d{2}$/u);
const flag = z.enum(RISK_FLAG_CODES);

export const crosswalkRecordSchema = z.strictObject({
  caseId: z.string().regex(/^[A-Z]{2,5}-\d{3}$/u),
  originalCategory: z.string().min(1).max(60),
  candidatePrimaryL2: l2Code.nullable(),
  candidateSecondaryL2: l2Code.nullable(),
  acceptableAlternateL2: z.array(l2Code).max(3),
  candidateFlags: z.array(flag).max(RISK_FLAG_CODES.length),
  coverageStatus: z.enum(COVERAGE_STATUSES),
  boundaryTested: z.array(z.enum(BOUNDARIES)).min(1).max(4),
  rationale: z.string().min(1).max(300),
  /** Only a named reviewer can move a record past draft; none has. */
  reviewStatus: z.enum(['draft', 'reviewed', 'approved']),
});

export const crosswalkGapSchema = z.strictObject({
  id: z.string().regex(/^GAP-\d{2}$/u),
  l2: l2Code,
  flags: z.array(flag).max(RISK_FLAG_CODES.length),
  boundary: z.enum(BOUNDARIES),
  resolution: z.enum(['new_case_candidate', 'unit_test_sufficient']),
  finding: z.string().min(1).max(300),
  proposal: z.string().min(1).max(300),
  status: z.enum(['proposed_not_authored', 'authored_pending_review', 'reviewed']),
});

export const crosswalkSchema = z.strictObject({
  crosswalkVersion: z.string().min(1).max(60),
  datasetVersion: z.string().regex(/^v\d+$/u),
  datasetSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  taxonomyVersion: z.string().min(1).max(60),
  reviewStatus: z.enum(['draft_single_author', 'reviewed', 'adjudicated']),
  records: z.array(crosswalkRecordSchema).max(1000),
  gaps: z.array(crosswalkGapSchema).max(100),
});

export type Crosswalk = z.infer<typeof crosswalkSchema>;
export type CrosswalkRecord = z.infer<typeof crosswalkRecordSchema>;
export type CrosswalkGap = z.infer<typeof crosswalkGapSchema>;
