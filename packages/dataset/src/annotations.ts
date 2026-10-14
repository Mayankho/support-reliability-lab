import { z } from 'zod';
import { caseIdSchema } from '@srl/contracts';
import type { DatasetIssue } from './issues.ts';
import type { ValidatedDataset } from './validate.ts';

export const ANNOTATION_STATUSES = ['consistent', 'note', 'disputed'] as const;

export const annotationReviewSchema = z
  .object({
    datasetVersion: z.string().min(1),
    datasetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    policyVersion: z.string().min(1),
    reviewType: z.enum(['single_reviewer_author_pass', 'independent_double_annotation']),
    independentlyAdjudicated: z.boolean(),
    reviewedOn: z.iso.date(),
    summary: z.string().min(1),
    entries: z.array(
      z
        .object({
          caseId: caseIdSchema,
          status: z.enum(ANNOTATION_STATUSES),
          scored: z.boolean(),
          notes: z.array(z.string().min(1)),
        })
        .strict(),
    ),
  })
  .strict();

export type AnnotationReview = z.infer<typeof annotationReviewSchema>;

export type AnnotationCheck =
  { ok: true; review: AnnotationReview } | { ok: false; issues: DatasetIssue[] };

/**
 * Checks that a review file describes exactly this dataset and does not claim more review than happened.
 */
export function checkAnnotationReview(text: string, dataset: ValidatedDataset): AnnotationCheck {
  const fail = (detail: string): DatasetIssue => ({ code: 'ANNOTATION_INVALID', detail });

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, issues: [fail('review file is not valid JSON')] };
  }
  const parsed = annotationReviewSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) =>
        fail(`${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`),
      ),
    };
  }

  const review = parsed.data;
  const issues: DatasetIssue[] = [];
  if (review.datasetVersion !== dataset.version) {
    issues.push(fail(`review is for ${review.datasetVersion}, dataset is ${dataset.version}`));
  }
  if (review.datasetSha256 !== dataset.sha256) {
    issues.push(fail('review datasetSha256 does not match the fixture bytes'));
  }
  if (review.policyVersion !== dataset.policy.id) {
    issues.push(fail(`review policy ${review.policyVersion} differs from ${dataset.policy.id}`));
  }
  const adjudicatedInManifest = dataset.manifest.humanReviewStatus === 'independently_adjudicated';
  if (review.independentlyAdjudicated !== adjudicatedInManifest) {
    issues.push(fail('independentlyAdjudicated disagrees with the manifest humanReviewStatus'));
  }
  if (review.independentlyAdjudicated && review.reviewType === 'single_reviewer_author_pass') {
    issues.push(fail('a single-reviewer pass cannot be marked independently adjudicated'));
  }

  const caseIds = new Set(dataset.cases.map((goldenCase) => goldenCase.id));
  const seen = new Set<string>();
  for (const entry of review.entries) {
    if (!caseIds.has(entry.caseId)) {
      issues.push(fail(`${entry.caseId} is not in the dataset`));
    }
    if (seen.has(entry.caseId)) {
      issues.push(fail(`${entry.caseId} is reviewed more than once`));
    }
    seen.add(entry.caseId);
    if (entry.status !== 'consistent' && entry.notes.length === 0) {
      issues.push(fail(`${entry.caseId} has status ${entry.status} without a note`));
    }
    if (!entry.scored && entry.status !== 'disputed') {
      issues.push(fail(`${entry.caseId} is unscored without a dispute`));
    }
  }
  for (const id of caseIds) {
    if (!seen.has(id)) {
      issues.push(fail(`${id} has no review entry`));
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, review };
}
