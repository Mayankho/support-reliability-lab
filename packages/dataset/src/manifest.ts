import { z } from 'zod';
import { CASE_CATEGORIES, RISKS } from '@srl/contracts';

export const REVIEW_STATUSES = [
  'starter_labels_not_independently_adjudicated',
  'single_reviewer_checked',
  'independently_adjudicated',
] as const;

const countSchema = z.number().int().nonnegative();

const categoryCountsSchema = z
  .object(Object.fromEntries(CASE_CATEGORIES.map((category) => [category, countSchema])))
  .strict();

const riskCountsSchema = z
  .object(Object.fromEntries(RISKS.map((risk) => [risk, countSchema])))
  .strict();

export const datasetManifestSchema = z
  .object({
    datasetVersion: z.string().regex(/^v[0-9]+(?:\.[0-9]+)?$/u),
    policyVersion: z.string().min(1),
    recordCount: countSchema,
    criticalCaseCount: countSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    categoryCounts: categoryCountsSchema,
    riskCounts: riskCountsSchema,
    humanReviewStatus: z.enum(REVIEW_STATUSES),
    usesRealCustomerData: z.literal(false),
    format: z.literal('jsonl'),
    notes: z.string().min(1),
  })
  .strict();

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface DatasetManifest {
  datasetVersion: string;
  policyVersion: string;
  recordCount: number;
  criticalCaseCount: number;
  sha256: string;
  categoryCounts: Record<string, number>;
  riskCounts: Record<string, number>;
  humanReviewStatus: ReviewStatus;
  usesRealCustomerData: false;
  format: 'jsonl';
  notes: string;
}
