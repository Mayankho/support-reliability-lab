import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../taxonomy/load.ts';
import type { ValidatedTaxonomy } from '../taxonomy/validate.ts';
import { crosswalkSchema, type Crosswalk } from './schema.ts';

export const CROSSWALK_FILE = join(DATA_DIR, 'crosswalk.v1.json');

export interface CrosswalkCase {
  id: string;
  category: string;
}

export interface CrosswalkIssue {
  code:
    | 'JSON_INVALID'
    | 'SCHEMA_INVALID'
    | 'DATASET_MISMATCH'
    | 'TAXONOMY_MISMATCH'
    | 'DUPLICATE_CASE'
    | 'UNKNOWN_CASE'
    | 'MISSING_CASE'
    | 'CATEGORY_MISMATCH'
    | 'UNKNOWN_L2'
    | 'SECONDARY_EQUALS_PRIMARY'
    | 'ALTERNATE_EQUALS_PRIMARY'
    | 'UNMAPPED_NOT_FLAGGED'
    | 'MISSING_ON_EXISTING_CASE'
    | 'REVIEW_STATUS_INFLATED';
  detail: string;
}

export type CrosswalkValidation =
  { ok: true; crosswalk: Crosswalk } | { ok: false; issues: CrosswalkIssue[] };

/**
 * Checks the crosswalk against the frozen dataset and the registry. A draft crosswalk cannot contain
 * reviewed records, because nobody other than the author has reviewed it.
 */
export function validateCrosswalk(
  json: unknown,
  dataset: { version: string; sha256: string; cases: readonly CrosswalkCase[] },
  taxonomy: ValidatedTaxonomy,
): CrosswalkValidation {
  const parsed = crosswalkSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues
        .slice(0, 20)
        .map((issue) => ({ code: 'SCHEMA_INVALID', detail: issue.path.join('.') })),
    };
  }
  const crosswalk = parsed.data;
  const issues: CrosswalkIssue[] = [];

  if (crosswalk.datasetVersion !== dataset.version || crosswalk.datasetSha256 !== dataset.sha256) {
    issues.push({
      code: 'DATASET_MISMATCH',
      detail: 'crosswalk was written for other dataset bytes',
    });
  }
  if (crosswalk.taxonomyVersion !== taxonomy.taxonomy.taxonomyVersion) {
    issues.push({ code: 'TAXONOMY_MISMATCH', detail: crosswalk.taxonomyVersion });
  }

  const categories = new Map(dataset.cases.map((entry) => [entry.id, entry.category]));
  const seen = new Set<string>();
  const knownL2 = (code: string | null, where: string) => {
    if (code !== null && !taxonomy.l2.has(code)) {
      issues.push({ code: 'UNKNOWN_L2', detail: `${where}: ${code}` });
    }
  };

  for (const record of crosswalk.records) {
    if (seen.has(record.caseId)) issues.push({ code: 'DUPLICATE_CASE', detail: record.caseId });
    seen.add(record.caseId);
    const category = categories.get(record.caseId);
    if (category === undefined) {
      issues.push({ code: 'UNKNOWN_CASE', detail: record.caseId });
    } else if (category !== record.originalCategory) {
      issues.push({ code: 'CATEGORY_MISMATCH', detail: record.caseId });
    }
    knownL2(record.candidatePrimaryL2, record.caseId);
    knownL2(record.candidateSecondaryL2, record.caseId);
    for (const alternate of record.acceptableAlternateL2) knownL2(alternate, record.caseId);
    if (
      record.candidateSecondaryL2 !== null &&
      record.candidateSecondaryL2 === record.candidatePrimaryL2
    ) {
      issues.push({ code: 'SECONDARY_EQUALS_PRIMARY', detail: record.caseId });
    }
    if (
      record.candidatePrimaryL2 !== null &&
      record.acceptableAlternateL2.includes(record.candidatePrimaryL2)
    ) {
      issues.push({ code: 'ALTERNATE_EQUALS_PRIMARY', detail: record.caseId });
    }
    if (record.candidatePrimaryL2 === null && record.coverageStatus !== 'needs_review') {
      issues.push({ code: 'UNMAPPED_NOT_FLAGGED', detail: record.caseId });
    }
    if (record.coverageStatus === 'missing') {
      issues.push({ code: 'MISSING_ON_EXISTING_CASE', detail: record.caseId });
    }
    if (crosswalk.reviewStatus === 'draft_single_author' && record.reviewStatus !== 'draft') {
      issues.push({ code: 'REVIEW_STATUS_INFLATED', detail: record.caseId });
    }
  }
  for (const id of categories.keys()) {
    if (!seen.has(id)) issues.push({ code: 'MISSING_CASE', detail: id });
  }
  for (const gap of crosswalk.gaps) knownL2(gap.l2, gap.id);

  return issues.length === 0 ? { ok: true, crosswalk } : { ok: false, issues };
}

export function readCrosswalkJson(path = CROSSWALK_FILE): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}
