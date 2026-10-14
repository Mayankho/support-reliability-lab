import type { Decision, RuleId, RuleVerdict } from '@srl/contracts';
import type { ReportCase } from './schema.ts';

export interface Ratio {
  numerator: number;
  denominator: number;
  value: number | null;
}

const ratio = (numerator: number, denominator: number): Ratio => ({
  numerator,
  denominator,
  value: denominator === 0 ? null : numerator / denominator,
});

export interface RunMetrics {
  caseCount: number;
  passedCases: number;
  failedCases: number;
  erroredCases: number;
  decisionAccuracy: Ratio;
  routeAccuracy: Ratio;
  intentAccuracy: Ratio;
  mustEscalateRecall: Ratio;
  criticalFailures: Array<{ caseId: string; ruleId: RuleId; evidenceCode: string }>;
  ruleErrors: Array<{ caseId: string; ruleId: RuleId; evidenceCode: string }>;
  ruleCounts: Record<string, Record<RuleVerdict, number>>;
  categoryCounts: Record<string, { cases: number; failed: number; errored: number }>;
  decisionConfusion: Record<string, Record<string, number>>;
  latencyMs: { p50: number | null; p95: number | null; max: number | null };
  cost: {
    totalUsd: number | null;
    source: 'offline_zero' | 'model_reported' | 'mixed' | 'unavailable';
  };
}

function verdictOf(reportCase: ReportCase, ruleId: RuleId): RuleVerdict | null {
  return reportCase.rules.find((rule) => rule.ruleId === ruleId)?.verdict ?? null;
}

/** Nearest-rank percentile. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? null;
}

function accuracy(cases: readonly ReportCase[], ruleId: RuleId): Ratio {
  const scored = cases.filter((reportCase) => {
    const verdict = verdictOf(reportCase, ruleId);
    return verdict === 'pass' || verdict === 'fail';
  });
  return ratio(
    scored.filter((reportCase) => verdictOf(reportCase, ruleId) === 'pass').length,
    scored.length,
  );
}

/**
 * All denominators count cases, never rule rows. Accuracy is over cases whose rule produced a
 * pass or fail; must-escalate recall is over critical cases labeled must-escalate.
 */
export function computeMetrics(cases: readonly ReportCase[]): RunMetrics {
  const criticalMustEscalate = cases.filter(
    (reportCase) => reportCase.risk === 'critical' && reportCase.expected.mustEscalate,
  );
  const ruleCounts: RunMetrics['ruleCounts'] = {};
  const categoryCounts: RunMetrics['categoryCounts'] = {};
  const decisionConfusion: RunMetrics['decisionConfusion'] = {};
  const criticalFailures: RunMetrics['criticalFailures'] = [];
  const ruleErrors: RunMetrics['ruleErrors'] = [];

  for (const reportCase of cases) {
    const category = (categoryCounts[reportCase.category] ??= { cases: 0, failed: 0, errored: 0 });
    category.cases += 1;
    if (reportCase.status === 'fail') category.failed += 1;
    if (reportCase.status === 'error') category.errored += 1;

    for (const rule of reportCase.rules) {
      const counts = (ruleCounts[rule.ruleId] ??= {
        pass: 0,
        fail: 0,
        error: 0,
        not_applicable: 0,
      });
      counts[rule.verdict] += 1;
      if (rule.verdict === 'fail' && rule.severity === 'critical') {
        criticalFailures.push({
          caseId: reportCase.caseId,
          ruleId: rule.ruleId,
          evidenceCode: rule.evidenceCode,
        });
      }
      if (rule.verdict === 'error') {
        ruleErrors.push({
          caseId: reportCase.caseId,
          ruleId: rule.ruleId,
          evidenceCode: rule.evidenceCode,
        });
      }
    }

    const actual: Decision | 'no_output' = reportCase.output?.decision ?? 'no_output';
    const row = (decisionConfusion[reportCase.expected.decision] ??= {});
    row[actual] = (row[actual] ?? 0) + 1;
  }

  const durations = cases.map((reportCase) => reportCase.durationMs);
  const sources = new Set(cases.map((reportCase) => reportCase.costSource));
  const costs = cases.map((reportCase) => reportCase.costUsd);
  const cost: RunMetrics['cost'] = costs.some((value) => value === null)
    ? { totalUsd: null, source: sources.size > 1 ? 'mixed' : 'unavailable' }
    : {
        totalUsd: costs.reduce<number>((sum, value) => sum + (value ?? 0), 0),
        source:
          sources.size === 1 ? ([...sources][0] as 'offline_zero' | 'model_reported') : 'mixed',
      };

  return {
    caseCount: cases.length,
    passedCases: cases.filter((reportCase) => reportCase.status === 'pass').length,
    failedCases: cases.filter((reportCase) => reportCase.status === 'fail').length,
    erroredCases: cases.filter((reportCase) => reportCase.status === 'error').length,
    decisionAccuracy: accuracy(cases, 'DECISION_MATCH'),
    routeAccuracy: accuracy(cases, 'ROUTE_MATCH'),
    intentAccuracy: accuracy(cases, 'INTENT_MATCH'),
    mustEscalateRecall: ratio(
      criticalMustEscalate.filter(
        (reportCase) => verdictOf(reportCase, 'ESCALATION_MATCH') === 'pass',
      ).length,
      criticalMustEscalate.length,
    ),
    criticalFailures,
    ruleErrors,
    ruleCounts,
    categoryCounts,
    decisionConfusion,
    latencyMs: {
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      max: durations.length === 0 ? null : Math.max(...durations),
    },
    cost,
  };
}
