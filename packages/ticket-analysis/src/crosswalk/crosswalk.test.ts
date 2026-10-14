import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDataset, type ValidatedDataset } from '@srl/dataset';
import { readTaxonomy } from '../taxonomy/load.ts';
import type { ValidatedTaxonomy } from '../taxonomy/validate.ts';
import { buildCoverage, CROSSWALK_DOC } from './coverage.ts';
import type { Crosswalk } from './schema.ts';
import { readCrosswalkJson, validateCrosswalk } from './validate.ts';

let dataset: ValidatedDataset;
let taxonomy: ValidatedTaxonomy;
const committed = readCrosswalkJson() as Crosswalk;

beforeAll(async () => {
  const load = await loadDataset('v1');
  if (!load.ok) throw new Error('dataset v1 invalid');
  dataset = load.dataset;
  const registry = readTaxonomy();
  if (!registry.ok) throw new Error('registry invalid');
  taxonomy = registry.value;
});

function check(edit: (crosswalk: Crosswalk) => void, sha?: string) {
  const crosswalk = structuredClone(committed);
  edit(crosswalk);
  const result = validateCrosswalk(
    crosswalk,
    {
      version: dataset.version,
      sha256: sha ?? dataset.sha256,
      cases: dataset.cases.map((c) => ({ id: c.id, category: c.category })),
    },
    taxonomy,
  );
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

describe('coverage crosswalk', () => {
  it('has exactly one draft record per v1 case, all valid against the registry', () => {
    expect(check(() => undefined)).toEqual([]);
    expect(committed.records).toHaveLength(80);
    expect(new Set(committed.records.map((r) => r.reviewStatus))).toEqual(new Set(['draft']));
    expect(committed.reviewStatus).toBe('draft_single_author');
  });

  it('keeps the committed Markdown in sync with the data', async () => {
    const build = await buildCoverage();
    expect(build.ok).toBe(true);
    if (!build.ok) return;
    expect(readFileSync(CROSSWALK_DOC, 'utf8')).toBe(build.markdown);
  });

  it('does not claim any gap has been authored or reviewed', () => {
    for (const gap of committed.gaps) expect(gap.status).toBe('proposed_not_authored');
  });

  it('does not let one issue type stand in for an evaluator category', () => {
    const byCategory = new Map<string, Set<string | null>>();
    for (const record of committed.records) {
      const set = byCategory.get(record.originalCategory) ?? new Set();
      set.add(record.candidatePrimaryL2);
      byCategory.set(record.originalCategory, set);
    }
    const multi = [...byCategory.values()].filter((set) => set.size > 1);
    expect(multi.length).toBeGreaterThanOrEqual(6);
  });

  it.each([
    [
      'a duplicate case',
      (c: Crosswalk) => c.records.push(structuredClone(c.records[0]!)),
      'DUPLICATE_CASE',
    ],
    ['a missing case', (c: Crosswalk) => c.records.pop(), 'MISSING_CASE'],
    [
      'an unknown issue type',
      (c: Crosswalk) => {
        c.records[0]!.candidatePrimaryL2 = 'BIL-99';
      },
      'UNKNOWN_L2',
    ],
    [
      'a category that disagrees with the dataset',
      (c: Crosswalk) => {
        c.records[0]!.originalCategory = 'cancellation';
      },
      'CATEGORY_MISMATCH',
    ],
    [
      'a reviewed record in a single-author draft',
      (c: Crosswalk) => {
        c.records[0]!.reviewStatus = 'approved';
      },
      'REVIEW_STATUS_INFLATED',
    ],
    [
      'an unmapped case not marked for review',
      (c: Crosswalk) => {
        c.records[0]!.candidatePrimaryL2 = null;
        c.records[0]!.candidateSecondaryL2 = null;
      },
      'UNMAPPED_NOT_FLAGGED',
    ],
    [
      'a secondary equal to the primary',
      (c: Crosswalk) => {
        c.records[0]!.candidateSecondaryL2 = c.records[0]!.candidatePrimaryL2;
      },
      'SECONDARY_EQUALS_PRIMARY',
    ],
    [
      'an existing case marked missing',
      (c: Crosswalk) => {
        c.records[0]!.coverageStatus = 'missing';
      },
      'MISSING_ON_EXISTING_CASE',
    ],
  ])('rejects %s', (_label, edit, code) => {
    expect(check(edit)).toContain(code);
  });

  it('rejects a crosswalk written for other dataset bytes', () => {
    expect(check(() => undefined, '0'.repeat(64))).toEqual(['DATASET_MISMATCH']);
  });
});
