import type { RuleId } from '@srl/contracts';
import { computeMetrics, type Ratio } from '../report/metrics.ts';
import type { ReportCase, RunReport } from '../report/schema.ts';
import { GATE_THRESHOLDS, type GateThresholds } from './thresholds.ts';

export interface MetricDelta {
  baseline: number | null;
  candidate: number | null;
  deltaPp: number | null;
}

export interface RunComparison {
  baselineRunId: string;
  candidateRunId: string;
  compatible: boolean;
  incompatibilities: string[];
  newCriticalFailures: Array<{ caseId: string; ruleId: RuleId }>;
  newFailures: Array<{ caseId: string; ruleIds: RuleId[] }>;
  fixedCases: string[];
  unchangedFailures: string[];
  executionErrors: string[];
  metricDeltas: Record<
    'decisionAccuracy' | 'routeAccuracy' | 'intentAccuracy' | 'mustEscalateRecall',
    MetricDelta
  >;
  latency: {
    baselineP95: number | null;
    candidateP95: number | null;
    ratio: number | null;
    comparable: boolean;
  };
}

/** Latency is advisory and noisy, so it never counts as a newly failing rule in the case diff. */
const DIFF_EXCLUDED: ReadonlySet<RuleId> = new Set(['LATENCY_BUDGET']);

function failingRules(reportCase: ReportCase): Map<RuleId, string> {
  return new Map(
    reportCase.rules
      .filter(
        (rule) =>
          (rule.verdict === 'fail' || rule.verdict === 'error') && !DIFF_EXCLUDED.has(rule.ruleId),
      )
      .map((rule) => [rule.ruleId, rule.severity]),
  );
}

const delta = (baseline: Ratio, candidate: Ratio): MetricDelta => ({
  baseline: baseline.value,
  candidate: candidate.value,
  deltaPp:
    baseline.value === null || candidate.value === null
      ? null
      : Math.round((candidate.value - baseline.value) * 10_000) / 100,
});

/** Reasons two runs cannot be compared. An empty list means the comparison is meaningful. */
export function incompatibilities(candidate: RunReport, baseline: RunReport): string[] {
  const reasons: string[] = [];
  if (candidate.dataset.sha256 !== baseline.dataset.sha256) reasons.push('dataset_sha');
  if (candidate.dataset.version !== baseline.dataset.version) reasons.push('dataset_version');
  if (candidate.policy.sha256 !== baseline.policy.sha256) reasons.push('policy_sha');
  if (candidate.evaluatorVersion !== baseline.evaluatorVersion) reasons.push('evaluator_version');
  const candidateIds = [...candidate.cases.map((c) => c.caseId)].sort().join();
  const baselineIds = [...baseline.cases.map((c) => c.caseId)].sort().join();
  if (candidateIds !== baselineIds) reasons.push('case_set');
  return reasons;
}

export function compareRuns(
  candidate: RunReport,
  baseline: RunReport,
  thresholds: GateThresholds = GATE_THRESHOLDS,
): RunComparison {
  const reasons = incompatibilities(candidate, baseline);
  const baselineCases = new Map(
    baseline.cases.map((reportCase) => [reportCase.caseId, reportCase]),
  );
  const newCriticalFailures: RunComparison['newCriticalFailures'] = [];
  const newFailures: RunComparison['newFailures'] = [];
  const fixedCases: string[] = [];
  const unchangedFailures: string[] = [];

  for (const reportCase of candidate.cases) {
    const before = baselineCases.get(reportCase.caseId);
    const now = failingRules(reportCase);
    const then = before === undefined ? new Map<RuleId, string>() : failingRules(before);
    const added = [...now.keys()].filter((ruleId) => !then.has(ruleId));
    if (added.length > 0) {
      newFailures.push({ caseId: reportCase.caseId, ruleIds: added });
      for (const ruleId of added) {
        if (now.get(ruleId) === 'critical')
          newCriticalFailures.push({ caseId: reportCase.caseId, ruleId });
      }
    }
    if (then.size > 0 && now.size === 0) fixedCases.push(reportCase.caseId);
    if (then.size > 0 && now.size > 0 && added.length === 0)
      unchangedFailures.push(reportCase.caseId);
  }

  const before = computeMetrics(baseline.cases);
  const after = computeMetrics(candidate.cases);
  const baselineP95 = before.latencyMs.p95;
  const candidateP95 = after.latencyMs.p95;
  const comparable =
    baselineP95 !== null &&
    candidateP95 !== null &&
    baselineP95 >= thresholds.latencyComparisonFloorMs &&
    candidateP95 >= thresholds.latencyComparisonFloorMs;

  return {
    baselineRunId: baseline.run.id,
    candidateRunId: candidate.run.id,
    compatible: reasons.length === 0,
    incompatibilities: reasons,
    newCriticalFailures,
    newFailures,
    fixedCases,
    unchangedFailures,
    executionErrors: candidate.cases.filter((c) => c.executionError !== null).map((c) => c.caseId),
    metricDeltas: {
      decisionAccuracy: delta(before.decisionAccuracy, after.decisionAccuracy),
      routeAccuracy: delta(before.routeAccuracy, after.routeAccuracy),
      intentAccuracy: delta(before.intentAccuracy, after.intentAccuracy),
      mustEscalateRecall: delta(before.mustEscalateRecall, after.mustEscalateRecall),
    },
    latency: {
      baselineP95,
      candidateP95,
      ratio: comparable && baselineP95 > 0 ? candidateP95 / baselineP95 : null,
      comparable,
    },
  };
}
