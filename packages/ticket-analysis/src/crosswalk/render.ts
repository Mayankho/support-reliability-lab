import type { ValidatedTaxonomy } from '../taxonomy/validate.ts';
import { COVERAGE_STATUSES, type CoverageStatus, type Crosswalk } from './schema.ts';

export interface CaseEvidence {
  id: string;
  expected: { decision: string; route: string; proposedAction: string; mustEscalate: boolean };
}

export interface IssueCoverage {
  code: string;
  name: string;
  priority: string;
  primaryCases: string[];
  otherCases: string[];
  status: CoverageStatus;
}

const RANK: Record<CoverageStatus, number> = {
  covered: 3,
  partial: 2,
  needs_review: 1,
  missing: 0,
};

/**
 * Per-issue coverage: the best status among cases with the issue as primary. An issue that appears
 * only as a secondary is `partial`; one that appears only as an acceptable alternate is `needs_review`.
 */
export function issueCoverage(crosswalk: Crosswalk, taxonomy: ValidatedTaxonomy): IssueCoverage[] {
  return taxonomy.taxonomy.l2Issues.map((issue) => {
    const primary = crosswalk.records.filter((r) => r.candidatePrimaryL2 === issue.code);
    const other = crosswalk.records.filter(
      (r) =>
        r.candidatePrimaryL2 !== issue.code &&
        (r.candidateSecondaryL2 === issue.code || r.acceptableAlternateL2.includes(issue.code)),
    );
    const floor: CoverageStatus = other.some((r) => r.candidateSecondaryL2 === issue.code)
      ? 'partial'
      : other.length > 0
        ? 'needs_review'
        : 'missing';
    const best = primary.reduce<CoverageStatus>(
      (status, record) =>
        RANK[record.coverageStatus] > RANK[status] ? record.coverageStatus : status,
      floor,
    );
    return {
      code: issue.code,
      name: issue.name,
      priority: issue.candidatePriority,
      primaryCases: primary.map((r) => r.caseId),
      otherCases: other.map((r) => r.caseId),
      status: best,
    };
  });
}

const cell = (value: string) => value.replaceAll('|', '\\|');

function evidenceText(evidence: CaseEvidence | undefined): string {
  if (evidence === undefined) return 'n/a';
  const { decision, route, proposedAction, mustEscalate } = evidence.expected;
  const parts = [decision, route];
  if (proposedAction !== 'none') parts.push(`proposes ${proposedAction}`);
  if (mustEscalate) parts.push('must escalate');
  return parts.join(', ');
}

/** Renders the reviewable Markdown crosswalk. Output is deterministic so the committed copy can be checked. */
export function renderCrosswalk(
  crosswalk: Crosswalk,
  taxonomy: ValidatedTaxonomy,
  cases: readonly CaseEvidence[],
): string {
  const evidence = new Map(cases.map((entry) => [entry.id, entry]));
  const coverage = issueCoverage(crosswalk, taxonomy);
  const counts = Object.fromEntries(
    COVERAGE_STATUSES.map((status) => [
      status,
      crosswalk.records.filter((r) => r.coverageStatus === status).length,
    ]),
  ) as Record<CoverageStatus, number>;
  const mapped = crosswalk.records.filter((r) => r.candidatePrimaryL2 !== null).length;
  const touched = coverage.filter((c) => c.status !== 'missing');
  const urgentMissing = coverage.filter(
    (c) => c.status === 'missing' && (c.priority === 'P1' || c.priority === 'P2'),
  );
  const total = crosswalk.records.length;

  const lines = [
    '# Taxonomy coverage crosswalk',
    '',
    `Maps each of the ${String(total)} golden cases in dataset \`${crosswalk.datasetVersion}\` (sha256 \`${crosswalk.datasetSha256.slice(0, 12)}…\`) to candidate issue types and risk flags from \`${taxonomy.taxonomy.taxonomyVersion}\` (sha256 \`${taxonomy.sha256.slice(0, 12)}…\`).`,
    '',
    `**Review status: \`${crosswalk.reviewStatus}\`.** One author wrote every mapping. Nobody else has reviewed them, so every record is \`draft\`. The crosswalk shows which safety boundaries the existing cases exercise for which issue types. It says nothing about how often any issue occurs, and the eight evaluator categories do not map one-to-one to issue types.`,
    '',
    'Written by `pnpm tickets:coverage -- --write` from `packages/ticket-analysis/data/crosswalk.v1.json`. A test fails if this file is out of date.',
    '',
    'Status meanings:',
    '',
    '- `covered`: the case directly exercises the safety boundary that matters for its candidate issue type.',
    '- `partial`: the case exercises part of that boundary, or a weaker form of it.',
    '- `needs_review`: the mapping itself is uncertain; alternatives are listed.',
    '- `missing`: used only for issue types with no case at all.',
    '',
    '## Summary',
    '',
    `| Measure | Value |`,
    `| --- | --- |`,
    `| Cases with a candidate primary issue type | ${String(mapped)} of ${String(total)} |`,
    ...COVERAGE_STATUSES.filter((s) => s !== 'missing').map(
      (status) => `| Cases marked \`${status}\` | ${String(counts[status])} of ${String(total)} |`,
    ),
    `| Issue types touched by at least one case | ${String(touched.length)} of ${String(coverage.length)} |`,
    `| P1 or P2 issue types with no case | ${String(urgentMissing.length)} |`,
    '',
    '## Gaps',
    '',
    'Chosen by safety boundary, not by how often an issue occurs. Nothing here has been authored as a test case yet. A new case would go into a separately versioned dataset with independently reviewed labels, and would never change the v1 gate.',
    '',
    '| Gap | Issue type | Flags | Boundary | Finding | Proposal | Resolution |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...crosswalk.gaps.map(
      (gap) =>
        `| ${gap.id} | ${gap.l2} | ${gap.flags.join(', ') || '–'} | \`${gap.boundary}\` | ${cell(gap.finding)} | ${cell(gap.proposal)} | ${gap.resolution.replaceAll('_', ' ')} |`,
    ),
    '',
    '## Issue types with cases',
    '',
    '| Issue type | Name | Priority | Primary in | Secondary or alternate in | Best status |',
    '| --- | --- | --- | --- | --- | --- |',
    ...touched.map(
      (c) =>
        `| ${c.code} | ${cell(c.name)} | ${c.priority} | ${c.primaryCases.join(', ') || '–'} | ${c.otherCases.join(', ') || '–'} | ${c.status} |`,
    ),
    '',
    '## P1 and P2 issue types with no case',
    '',
    ...urgentMissing.map((c) => `- ${c.code} ${c.name} (${c.priority})`),
    '',
    'Lower-priority issue types without cases are not listed. Many fall outside what a support agent should decide alone (route-out categories, feature requests, praise).',
    '',
    '## Case records',
    '',
    'Expected behavior comes from the case labels under `SYN-POLICY-1`. Rationales describe the mapping, not the customer message.',
    '',
    '| Case | Category | Primary | Secondary | Alternates | Flags | Boundary tested | Expected behavior | Status | Rationale |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...crosswalk.records.map(
      (r) =>
        `| ${r.caseId} | ${r.originalCategory} | ${r.candidatePrimaryL2 ?? 'none'} | ${r.candidateSecondaryL2 ?? '–'} | ${r.acceptableAlternateL2.join(', ') || '–'} | ${r.candidateFlags.join(', ') || '–'} | ${r.boundaryTested.map((b) => `\`${b}\``).join(', ')} | ${evidenceText(evidence.get(r.caseId))} | ${r.coverageStatus} | ${cell(r.rationale)} |`,
    ),
    '',
  ];
  return lines.join('\n');
}
