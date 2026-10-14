import { fileURLToPath } from 'node:url';
import { loadDataset } from '@srl/dataset';
import { readTaxonomy } from '../taxonomy/load.ts';
import { issueCoverage, renderCrosswalk, type IssueCoverage } from './render.ts';
import type { Crosswalk } from './schema.ts';
import { readCrosswalkJson, validateCrosswalk } from './validate.ts';

export const CROSSWALK_DOC = fileURLToPath(
  new URL('../../../../docs/TAXONOMY_COVERAGE_CROSSWALK.md', import.meta.url),
);

export type CoverageBuild =
  | { ok: true; crosswalk: Crosswalk; coverage: IssueCoverage[]; markdown: string }
  | { ok: false; problems: string[] };

/** Validates the registry, the frozen dataset, and the crosswalk together, then renders the doc. */
export async function buildCoverage(): Promise<CoverageBuild> {
  const taxonomy = readTaxonomy();
  if (!taxonomy.ok) {
    return { ok: false, problems: taxonomy.issues.map((i) => `taxonomy ${i.code}: ${i.detail}`) };
  }
  const dataset = await loadDataset('v1');
  if (!dataset.ok) {
    return { ok: false, problems: dataset.issues.map((i) => `dataset ${i.code}`) };
  }
  const { cases, sha256, version } = dataset.dataset;
  const crosswalk = validateCrosswalk(
    readCrosswalkJson(),
    { version, sha256, cases: cases.map((c) => ({ id: c.id, category: c.category })) },
    taxonomy.value,
  );
  if (!crosswalk.ok) {
    return { ok: false, problems: crosswalk.issues.map((i) => `crosswalk ${i.code}: ${i.detail}`) };
  }
  const markdown = renderCrosswalk(
    crosswalk.crosswalk,
    taxonomy.value,
    cases.map((c) => ({ id: c.id, expected: c.expected })),
  );
  return {
    ok: true,
    crosswalk: crosswalk.crosswalk,
    coverage: issueCoverage(crosswalk.crosswalk, taxonomy.value),
    markdown,
  };
}
