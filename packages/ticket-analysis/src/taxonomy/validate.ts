import { createHash } from 'node:crypto';
import {
  RISK_FLAG_CODES,
  taxonomyManifestSchema,
  taxonomySchema,
  type L2Issue,
  type L3Option,
  type Taxonomy,
} from './schema.ts';

export type TaxonomyIssueCode =
  | 'MANIFEST_INVALID'
  | 'HASH_MISMATCH'
  | 'JSON_INVALID'
  | 'SCHEMA_INVALID'
  | 'VERSION_MISMATCH'
  | 'REVIEW_STATUS_MISMATCH'
  | 'COUNT_MISMATCH'
  | 'DUPLICATE_CODE'
  | 'UNKNOWN_L1'
  | 'L2_PREFIX_MISMATCH'
  | 'UNKNOWN_PARENT_L2'
  | 'L3_PREFIX_MISMATCH'
  | 'MISSING_FLAG_DEFINITION'
  | 'TIE_BREAK_COVERAGE'
  | 'MISSING_UNKNOWN_ISSUE'
  | 'SCOPE_TIER_MISMATCH';

/** Issues name codes and paths from the registry, never free text from it. */
export interface TaxonomyIssue {
  code: TaxonomyIssueCode;
  detail: string;
}

export interface ValidatedTaxonomy {
  taxonomy: Taxonomy;
  sha256: string;
  l1: ReadonlyMap<string, Taxonomy['l1Domains'][number]>;
  l2: ReadonlyMap<string, L2Issue>;
  l3: ReadonlyMap<string, L3Option>;
  l3ByParent: ReadonlyMap<string, readonly L3Option[]>;
}

export type TaxonomyValidation =
  | { ok: true; value: ValidatedTaxonomy }
  | { ok: false; issues: TaxonomyIssue[]; observedSha256: string };

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function duplicates(codes: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const code of codes) {
    if (seen.has(code)) repeated.add(code);
    seen.add(code);
  }
  return [...repeated];
}

/**
 * Validates the registry bytes against the manifest, then checks referential integrity. Counts are
 * recomputed from the records rather than trusted from headings or the manifest alone.
 */
export function validateTaxonomy(input: {
  bytes: Uint8Array;
  manifestText: string;
}): TaxonomyValidation {
  const observedSha256 = sha256Hex(input.bytes);
  const fail = (issues: TaxonomyIssue[]): TaxonomyValidation => ({
    ok: false,
    issues,
    observedSha256,
  });

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(input.manifestText);
  } catch {
    return fail([{ code: 'MANIFEST_INVALID', detail: 'manifest is not valid JSON' }]);
  }
  const manifest = taxonomyManifestSchema.safeParse(manifestJson);
  if (!manifest.success) {
    return fail([
      {
        code: 'MANIFEST_INVALID',
        detail: manifest.error.issues.map((issue) => issue.path.join('.')).join(', '),
      },
    ]);
  }
  if (manifest.data.sha256 !== observedSha256) {
    return fail([
      {
        code: 'HASH_MISMATCH',
        detail: 'registry bytes differ from the manifest; a change needs a new version',
      },
    ]);
  }

  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(input.bytes).toString('utf8'));
  } catch {
    return fail([{ code: 'JSON_INVALID', detail: 'registry is not valid JSON' }]);
  }
  const parsed = taxonomySchema.safeParse(json);
  if (!parsed.success) {
    return fail(
      parsed.error.issues
        .slice(0, 20)
        .map((issue) => ({ code: 'SCHEMA_INVALID' as const, detail: issue.path.join('.') })),
    );
  }
  const taxonomy = parsed.data;
  const issues: TaxonomyIssue[] = [];

  if (taxonomy.taxonomyVersion !== manifest.data.taxonomyVersion) {
    issues.push({ code: 'VERSION_MISMATCH', detail: 'manifest and registry versions differ' });
  }
  if (taxonomy.reviewStatus !== manifest.data.reviewStatus) {
    issues.push({ code: 'REVIEW_STATUS_MISMATCH', detail: 'manifest and registry differ' });
  }

  const observedCounts = {
    l1Domains: taxonomy.l1Domains.length,
    l2Issues: taxonomy.l2Issues.length,
    l3Options: taxonomy.l3Options.length,
    riskFlags: taxonomy.riskFlags.length,
  };
  for (const [kind, observed] of Object.entries(observedCounts)) {
    const declared = manifest.data.counts[kind as keyof typeof observedCounts];
    if (declared !== observed) {
      issues.push({
        code: 'COUNT_MISMATCH',
        detail: `${kind}: declared ${String(declared)}, observed ${String(observed)}`,
      });
    }
  }

  for (const [kind, codes] of [
    ['l1Domains', taxonomy.l1Domains.map((d) => d.code)],
    ['l2Issues', taxonomy.l2Issues.map((i) => i.code)],
    ['l3Options', taxonomy.l3Options.map((o) => o.code)],
    ['riskFlags', taxonomy.riskFlags.map((f) => f.code)],
  ] as const) {
    for (const code of duplicates(codes)) {
      issues.push({ code: 'DUPLICATE_CODE', detail: `${kind}: ${code}` });
    }
  }

  const l1 = new Map(taxonomy.l1Domains.map((domain) => [domain.code, domain]));
  const l2 = new Map(taxonomy.l2Issues.map((issue) => [issue.code, issue]));
  const l3 = new Map(taxonomy.l3Options.map((option) => [option.code, option]));

  for (const issue of taxonomy.l2Issues) {
    if (!l1.has(issue.l1Code)) issues.push({ code: 'UNKNOWN_L1', detail: issue.code });
    if (!issue.code.startsWith(`${issue.l1Code}-`)) {
      issues.push({ code: 'L2_PREFIX_MISMATCH', detail: issue.code });
    }
    if (
      issue.maxAutomationScope === 'Human only' &&
      !issue.candidateAutomationTier.startsWith('C')
    ) {
      issues.push({ code: 'SCOPE_TIER_MISMATCH', detail: `${issue.code}: human-only scope` });
    }
    if (
      (issue.maxAutomationScope === 'Classify + route') !==
      issue.candidateAutomationTier.startsWith('R')
    ) {
      issues.push({ code: 'SCOPE_TIER_MISMATCH', detail: `${issue.code}: route-out scope` });
    }
  }
  for (const option of taxonomy.l3Options) {
    if (!l2.has(option.parentL2)) {
      issues.push({ code: 'UNKNOWN_PARENT_L2', detail: option.code });
    }
    if (!option.code.startsWith(option.parentL2)) {
      issues.push({ code: 'L3_PREFIX_MISMATCH', detail: option.code });
    }
  }

  const definedFlags = new Set(taxonomy.riskFlags.map((flag) => flag.code));
  for (const code of RISK_FLAG_CODES) {
    if (!definedFlags.has(code)) issues.push({ code: 'MISSING_FLAG_DEFINITION', detail: code });
  }

  const tieBreak = taxonomy.classificationPrinciples.lastResortTieBreakGroups.flat();
  for (const code of duplicates(tieBreak)) {
    issues.push({ code: 'TIE_BREAK_COVERAGE', detail: `${code} appears more than once` });
  }
  for (const domain of taxonomy.l1Domains) {
    if (!tieBreak.includes(domain.code)) {
      issues.push({ code: 'TIE_BREAK_COVERAGE', detail: `${domain.code} has no tie-break rank` });
    }
  }
  for (const code of tieBreak) {
    if (!l1.has(code)) issues.push({ code: 'TIE_BREAK_COVERAGE', detail: `${code} is not an L1` });
  }

  for (const code of ['UNK-01', 'UNK-02']) {
    if (!l2.has(code)) issues.push({ code: 'MISSING_UNKNOWN_ISSUE', detail: code });
  }

  if (issues.length > 0) return fail(issues);

  const l3ByParent = new Map<string, L3Option[]>();
  for (const option of taxonomy.l3Options) {
    const siblings = l3ByParent.get(option.parentL2) ?? [];
    siblings.push(option);
    l3ByParent.set(option.parentL2, siblings);
  }
  return { ok: true, value: { taxonomy, sha256: observedSha256, l1, l2, l3, l3ByParent } };
}
