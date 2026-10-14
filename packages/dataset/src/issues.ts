export type DatasetIssueCode =
  | 'READ_ERROR'
  | 'FILE_TOO_LARGE'
  | 'MANIFEST_INVALID_JSON'
  | 'MANIFEST_INVALID'
  | 'MANIFEST_VERSION_MISMATCH'
  | 'POLICY_VERSION_MISMATCH'
  | 'SHA256_MISMATCH'
  | 'INVALID_ENCODING'
  | 'LINE_ENDING_INVALID'
  | 'EMPTY_LINE'
  | 'INVALID_JSON'
  | 'SCHEMA_INVALID'
  | 'DUPLICATE_CASE_ID'
  | 'UNKNOWN_POLICY_ID'
  | 'REQUIRED_POLICY_NOT_AVAILABLE'
  | 'TOO_MANY_CASES'
  | 'COUNT_MISMATCH'
  | 'COVERAGE_BELOW_TARGET'
  | 'SENSITIVE_PATTERN'
  | 'ANNOTATION_INVALID';

/**
 * `detail` never contains raw fixture text. It carries schema paths, counts, codes, or policy IDs only.
 */
export interface DatasetIssue {
  code: DatasetIssueCode;
  detail: string;
  line?: number;
  caseId?: string;
}

export function sortIssues(issues: readonly DatasetIssue[]): DatasetIssue[] {
  return [...issues].sort(
    (a, b) =>
      (a.line ?? 0) - (b.line ?? 0) ||
      a.code.localeCompare(b.code) ||
      a.detail.localeCompare(b.detail),
  );
}

export function formatIssue(issue: DatasetIssue): string {
  const location = [
    issue.line === undefined ? null : `line ${String(issue.line)}`,
    issue.caseId === undefined ? null : issue.caseId,
  ]
    .filter((part) => part !== null)
    .join(' ');
  return location.length > 0
    ? `${issue.code} (${location}): ${issue.detail}`
    : `${issue.code}: ${issue.detail}`;
}
