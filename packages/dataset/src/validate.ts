import { createHash } from 'node:crypto';
import {
  CASE_CATEGORIES,
  RISKS,
  goldenCaseSchema,
  type CaseCategory,
  type GoldenCase,
} from '@srl/contracts';
import { getSyntheticPolicy, lookupPolicyDocument } from '@srl/policies';
import { sortIssues, type DatasetIssue } from './issues.ts';
import { datasetManifestSchema, type DatasetManifest } from './manifest.ts';
import { findSensitivePatterns } from './sensitive.ts';

export const MAX_FIXTURE_BYTES = 5 * 1024 * 1024;
export const MAX_CASES = 100;
export const MIN_TOTAL_CASES = 80;
export const MIN_CRITICAL_CASES = 20;

export const MIN_CATEGORY_CASES: Readonly<Record<CaseCategory, number>> = {
  refund_guidance: 12,
  cancellation: 10,
  generation_credits: 12,
  annual_proration: 8,
  account_security: 10,
  knowledge_grounding: 10,
  tool_failure: 8,
  adversarial_ambiguous: 10,
};

export interface ValidatedDataset {
  version: string;
  manifest: DatasetManifest;
  sha256: string;
  byteLength: number;
  policy: { id: string; sha256: string };
  cases: GoldenCase[];
}

export type DatasetValidation =
  | { ok: true; dataset: ValidatedDataset }
  | { ok: false; issues: DatasetIssue[]; observedSha256: string | null };

export interface DatasetSource {
  expectedVersion: string;
  fixtureBytes: Uint8Array;
  manifestText: string;
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function validateDataset(source: DatasetSource): DatasetValidation {
  const issues: DatasetIssue[] = [];

  if (source.fixtureBytes.byteLength > MAX_FIXTURE_BYTES) {
    return {
      ok: false,
      issues: [
        {
          code: 'FILE_TOO_LARGE',
          detail: `fixture is ${String(source.fixtureBytes.byteLength)} bytes; limit is ${String(MAX_FIXTURE_BYTES)}`,
        },
      ],
      observedSha256: null,
    };
  }

  const observedSha256 = sha256Hex(source.fixtureBytes);
  const manifest = parseManifest(source.manifestText, issues);

  if (manifest !== null) {
    if (manifest.datasetVersion !== source.expectedVersion) {
      issues.push({
        code: 'MANIFEST_VERSION_MISMATCH',
        detail: `requested ${source.expectedVersion}, manifest declares ${manifest.datasetVersion}`,
      });
    }
    const policy = getSyntheticPolicy();
    if (manifest.policyVersion !== policy.id) {
      issues.push({
        code: 'POLICY_VERSION_MISMATCH',
        detail: `manifest declares ${manifest.policyVersion}, registry provides ${policy.id}`,
      });
    }
    if (manifest.sha256 !== observedSha256) {
      issues.push({
        code: 'SHA256_MISMATCH',
        detail: `manifest ${manifest.sha256}, fixture bytes ${observedSha256}`,
      });
    }
  }

  const cases = parseCases(source.fixtureBytes, issues);

  if (cases.length > MAX_CASES) {
    issues.push({
      code: 'TOO_MANY_CASES',
      detail: `${String(cases.length)} cases; limit is ${String(MAX_CASES)}`,
    });
  }

  checkPolicyReferences(cases, issues);
  checkCoverage(cases, issues);
  if (manifest !== null) {
    checkDeclaredCounts(manifest, cases, issues);
  }

  if (issues.length > 0 || manifest === null) {
    return { ok: false, issues: sortIssues(issues), observedSha256 };
  }

  const policy = getSyntheticPolicy();
  return {
    ok: true,
    dataset: {
      version: manifest.datasetVersion,
      manifest,
      sha256: observedSha256,
      byteLength: source.fixtureBytes.byteLength,
      policy: { id: policy.id, sha256: policy.sha256 },
      cases: cases.map(({ goldenCase }) => goldenCase),
    },
  };
}

function parseManifest(text: string, issues: DatasetIssue[]): DatasetManifest | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    issues.push({ code: 'MANIFEST_INVALID_JSON', detail: 'manifest is not valid JSON' });
    return null;
  }
  const parsed = datasetManifestSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        code: 'MANIFEST_INVALID',
        detail: `${pathOf(issue.path)}: ${issue.message}`,
      });
    }
    return null;
  }
  return parsed.data;
}

interface ParsedCase {
  line: number;
  goldenCase: GoldenCase;
}

function parseCases(bytes: Uint8Array, issues: DatasetIssue[]): ParsedCase[] {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    issues.push({ code: 'INVALID_ENCODING', detail: 'fixture is not valid UTF-8' });
    return [];
  }

  const rawLines = text.split('\n');
  if (rawLines.at(-1) === '') {
    rawLines.pop();
  }

  const parsed: ParsedCase[] = [];
  const firstLineById = new Map<string, number>();

  for (const [index, rawLine] of rawLines.entries()) {
    const line = index + 1;
    if (rawLine.includes('\r')) {
      issues.push({ code: 'LINE_ENDING_INVALID', line, detail: 'carriage return found' });
      continue;
    }
    if (rawLine.trim() === '') {
      issues.push({ code: 'EMPTY_LINE', line, detail: 'blank line inside JSONL' });
      continue;
    }

    for (const kind of findSensitivePatterns(rawLine)) {
      issues.push({ code: 'SENSITIVE_PATTERN', line, detail: `value resembling ${kind}` });
    }

    let raw: unknown;
    try {
      raw = JSON.parse(rawLine);
    } catch {
      issues.push({ code: 'INVALID_JSON', line, detail: 'line is not valid JSON' });
      continue;
    }

    const result = goldenCaseSchema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) {
        issues.push({
          code: 'SCHEMA_INVALID',
          line,
          detail: `${pathOf(issue.path)}: ${issue.message}`,
        });
      }
      continue;
    }

    const goldenCase = result.data;
    const firstLine = firstLineById.get(goldenCase.id);
    if (firstLine !== undefined) {
      issues.push({
        code: 'DUPLICATE_CASE_ID',
        line,
        caseId: goldenCase.id,
        detail: `first seen on line ${String(firstLine)}`,
      });
      continue;
    }
    firstLineById.set(goldenCase.id, line);
    parsed.push({ line, goldenCase });
  }

  return parsed;
}

function checkPolicyReferences(cases: readonly ParsedCase[], issues: DatasetIssue[]): void {
  for (const { line, goldenCase } of cases) {
    const referenced = new Set([
      ...goldenCase.availablePolicyIds,
      ...goldenCase.expected.requiredPolicyIds,
    ]);
    for (const id of [...referenced].sort()) {
      if (lookupPolicyDocument(id).status !== 'found') {
        issues.push({
          code: 'UNKNOWN_POLICY_ID',
          line,
          caseId: goldenCase.id,
          detail: `${id} is not in the policy registry`,
        });
      }
    }
    const available = new Set(goldenCase.availablePolicyIds);
    for (const id of goldenCase.expected.requiredPolicyIds) {
      if (!available.has(id)) {
        issues.push({
          code: 'REQUIRED_POLICY_NOT_AVAILABLE',
          line,
          caseId: goldenCase.id,
          detail: `${id} is required but not supplied to the agent`,
        });
      }
    }
  }
}

function checkCoverage(cases: readonly ParsedCase[], issues: DatasetIssue[]): void {
  if (cases.length < MIN_TOTAL_CASES) {
    issues.push({
      code: 'COVERAGE_BELOW_TARGET',
      detail: `${String(cases.length)} valid cases; target is at least ${String(MIN_TOTAL_CASES)}`,
    });
  }
  const critical = cases.filter(({ goldenCase }) => goldenCase.risk === 'critical').length;
  if (critical < MIN_CRITICAL_CASES) {
    issues.push({
      code: 'COVERAGE_BELOW_TARGET',
      detail: `${String(critical)} critical cases; target is at least ${String(MIN_CRITICAL_CASES)}`,
    });
  }
  const byCategory = countBy(cases, ({ goldenCase }) => goldenCase.category);
  for (const category of CASE_CATEGORIES) {
    const observed = byCategory.get(category) ?? 0;
    const minimum = MIN_CATEGORY_CASES[category];
    if (observed < minimum) {
      issues.push({
        code: 'COVERAGE_BELOW_TARGET',
        detail: `${category} has ${String(observed)} cases; target is at least ${String(minimum)}`,
      });
    }
  }
}

function checkDeclaredCounts(
  manifest: DatasetManifest,
  cases: readonly ParsedCase[],
  issues: DatasetIssue[],
): void {
  const mismatch = (field: string, declared: number, observed: number) => {
    if (declared !== observed) {
      issues.push({
        code: 'COUNT_MISMATCH',
        detail: `${field}: manifest ${String(declared)}, observed ${String(observed)}`,
      });
    }
  };

  mismatch('recordCount', manifest.recordCount, cases.length);
  const byRisk = countBy(cases, ({ goldenCase }) => goldenCase.risk);
  mismatch('criticalCaseCount', manifest.criticalCaseCount, byRisk.get('critical') ?? 0);
  for (const risk of RISKS) {
    mismatch(`riskCounts.${risk}`, manifest.riskCounts[risk] ?? 0, byRisk.get(risk) ?? 0);
  }
  const byCategory = countBy(cases, ({ goldenCase }) => goldenCase.category);
  for (const category of CASE_CATEGORIES) {
    mismatch(
      `categoryCounts.${category}`,
      manifest.categoryCounts[category] ?? 0,
      byCategory.get(category) ?? 0,
    );
  }
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function pathOf(path: readonly PropertyKey[]): string {
  return path.length === 0 ? '(root)' : path.map(String).join('.');
}
