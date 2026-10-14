import { asc, eq, sql } from 'drizzle-orm';
import type { AgentOutput, RuleResult } from '@srl/contracts';
import type { Db, Executor } from '../client.ts';
import { caseResults, cases, ruleResults, traceEvents } from '../schema.ts';

export interface CaseResultInsert {
  runId: string;
  caseId: string;
  status: 'pass' | 'fail' | 'error';
  executionError: string | null;
  output: AgentOutput | null;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  costSource: 'offline_zero' | 'model_reported' | 'unavailable';
  traceId: string;
  rules: readonly RuleResult[];
  traceSpans: ReadonlyArray<{ spanId: string; kind: string; attributes: Record<string, unknown> }>;
}

/**
 * Inserts a case result and its rule results in one transaction. A second delivery of the same
 * (run, case) is ignored, so retries and duplicate workers cannot double-count a case.
 */
export async function insertCaseResult(db: Db, result: CaseResultInsert): Promise<boolean> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(caseResults)
      .values({
        runId: result.runId,
        caseId: result.caseId,
        status: result.status,
        executionState: result.executionError === null ? 'completed' : 'error',
        executionError: result.executionError,
        outputJson: result.output,
        durationMs: result.durationMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd === null ? null : result.costUsd.toFixed(6),
        costSource: result.costSource,
        traceId: result.traceId,
      })
      .onConflictDoNothing({ target: [caseResults.runId, caseResults.caseId] })
      .returning({ id: caseResults.id });
    const row = inserted[0];
    if (row === undefined) {
      return false;
    }
    await tx.insert(ruleResults).values(
      result.rules.map((rule) => ({
        caseResultId: row.id,
        ruleId: rule.ruleId,
        verdict: rule.verdict,
        severity: rule.severity,
        evaluatorVersion: rule.evaluatorVersion,
        evidenceCode: rule.evidenceCode,
        evidenceJson: { evidence: rule.evidence },
      })),
    );
    if (result.traceSpans.length > 0) {
      await tx.insert(traceEvents).values(
        result.traceSpans.map((span) => ({
          runId: result.runId,
          caseId: result.caseId,
          traceId: result.traceId,
          spanId: span.spanId,
          kind: span.kind,
          redactedAttributesJson: span.attributes,
        })),
      );
    }
    return true;
  });
}

export async function listCaseIdsWithResults(db: Executor, runId: string): Promise<Set<string>> {
  const rows = await db
    .select({ caseId: caseResults.caseId })
    .from(caseResults)
    .where(eq(caseResults.runId, runId));
  return new Set(rows.map((row) => row.caseId));
}

export async function countCaseResults(db: Executor, runId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(caseResults)
    .where(eq(caseResults.runId, runId));
  return row?.count ?? 0;
}

export interface RunSummary {
  totalCases: number;
  completedCases: number;
  executionErrorCases: number;
  casesWithCriticalFailures: number;
  casesWithErrors: number;
  ruleResultRows: number;
}

/**
 * Case-level denominators. One case can fail several rules, so every count is of DISTINCT cases;
 * counting raw rule rows would overstate failures.
 */
export async function runSummary(db: Executor, runId: string): Promise<RunSummary> {
  const result = await db.execute<{
    total_cases: number;
    completed_cases: number;
    execution_error_cases: number;
    cases_with_critical_failures: number;
    cases_with_errors: number;
    rule_result_rows: number;
  }>(sql`
    select
      count(distinct cr.case_id)::int as total_cases,
      count(distinct cr.case_id) filter (where cr.execution_state = 'completed')::int as completed_cases,
      count(distinct cr.case_id) filter (where cr.execution_state = 'error')::int as execution_error_cases,
      count(distinct cr.case_id) filter (where rr.severity = 'critical' and rr.verdict = 'fail')::int
        as cases_with_critical_failures,
      count(distinct cr.case_id) filter (where rr.verdict = 'error')::int as cases_with_errors,
      count(rr.id)::int as rule_result_rows
    from case_results cr
    left join rule_results rr on rr.case_result_id = cr.id
    where cr.run_id = ${runId}`);
  const row = result.rows[0];
  return {
    totalCases: row?.total_cases ?? 0,
    completedCases: row?.completed_cases ?? 0,
    executionErrorCases: row?.execution_error_cases ?? 0,
    casesWithCriticalFailures: row?.cases_with_critical_failures ?? 0,
    casesWithErrors: row?.cases_with_errors ?? 0,
    ruleResultRows: row?.rule_result_rows ?? 0,
  };
}

export interface StoredCaseResult {
  caseResultId: string;
  caseId: string;
  caseKey: string;
  category: string;
  risk: string;
  status: string;
  executionError: string | null;
  output: unknown;
  durationMs: number;
  costUsd: string | null;
  costSource: string;
  traceId: string;
  rules: RuleResult[];
}

export async function loadRunResults(db: Executor, runId: string): Promise<StoredCaseResult[]> {
  const rows = await db
    .select({
      caseResultId: caseResults.id,
      caseId: caseResults.caseId,
      caseKey: cases.caseKey,
      category: cases.category,
      risk: cases.risk,
      status: caseResults.status,
      executionError: caseResults.executionError,
      output: caseResults.outputJson,
      durationMs: caseResults.durationMs,
      costUsd: caseResults.costUsd,
      costSource: caseResults.costSource,
      traceId: caseResults.traceId,
    })
    .from(caseResults)
    .innerJoin(cases, eq(cases.id, caseResults.caseId))
    .where(eq(caseResults.runId, runId))
    .orderBy(asc(cases.caseKey));

  const ruleRows = await db.execute<{
    case_result_id: string;
    rule_id: string;
    verdict: RuleResult['verdict'];
    severity: RuleResult['severity'];
    evaluator_version: string;
    evidence_code: string;
    evidence_json: { evidence?: string };
  }>(sql`
    select rr.case_result_id, rr.rule_id, rr.verdict, rr.severity, rr.evaluator_version, rr.evidence_code, rr.evidence_json
    from rule_results rr
    join case_results cr on cr.id = rr.case_result_id
    where cr.run_id = ${runId}`);

  const rulesByCase = new Map<string, RuleResult[]>();
  for (const rule of ruleRows.rows) {
    const list = rulesByCase.get(rule.case_result_id) ?? [];
    list.push({
      ruleId: rule.rule_id as RuleResult['ruleId'],
      verdict: rule.verdict,
      severity: rule.severity,
      evaluatorVersion: rule.evaluator_version,
      evidenceCode: rule.evidence_code,
      evidence: rule.evidence_json.evidence ?? '',
    });
    rulesByCase.set(rule.case_result_id, list);
  }
  return rows.map((row) => ({ ...row, rules: rulesByCase.get(row.caseResultId) ?? [] }));
}

export async function listTraceEvents(db: Executor, runId: string, caseId?: string) {
  const rows = await db
    .select()
    .from(traceEvents)
    .where(eq(traceEvents.runId, runId))
    .orderBy(asc(traceEvents.occurredAt));
  return caseId === undefined ? rows : rows.filter((row) => row.caseId === caseId);
}
