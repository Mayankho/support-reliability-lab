import { RULE_IDS, type GateStatus } from '@srl/contracts';
import { computeMetrics, type Ratio } from '../report/metrics.ts';
import { runReportSchema, type GateArtifact, type RunReport } from '../report/schema.ts';
import { compareRuns, type RunComparison } from './compare.ts';
import { GATE_THRESHOLDS, GATE_VERSION, type GateThresholds } from './thresholds.ts';

export interface GateInput {
  /** Raw report, validated here. A report that fails validation can only produce ERROR. */
  candidate: unknown;
  baseline?: unknown;
  /** The dataset the gate expects, from the current fixture manifest. */
  expectedDataset?: { version: string; sha256: string };
  thresholds?: GateThresholds;
  now?: Date;
}

export interface GateResult {
  status: GateStatus;
  artifact: GateArtifact | null;
  errors: string[];
  blockers: string[];
  warnings: string[];
  comparison: RunComparison | null;
}

const pct = (ratio: Ratio) => `${String(ratio.numerator)}/${String(ratio.denominator)}`;

function integrityErrors(report: RunReport): string[] {
  const errors: string[] = [];
  if (report.run.status !== 'completed') {
    errors.push(`error:run_status:${report.run.status}`);
  }
  if (report.cases.length !== report.dataset.caseCount) {
    errors.push(
      `error:missing_results:${String(report.cases.length)}/${String(report.dataset.caseCount)}`,
    );
  }
  const seen = new Set<string>();
  for (const reportCase of report.cases) {
    if (seen.has(reportCase.caseId)) errors.push(`error:duplicate_case:${reportCase.caseId}`);
    seen.add(reportCase.caseId);
    const ruleIds = new Set(reportCase.rules.map((rule) => rule.ruleId));
    for (const ruleId of RULE_IDS) {
      if (!ruleIds.has(ruleId)) errors.push(`error:missing_rule:${ruleId}:${reportCase.caseId}`);
    }
    if (reportCase.rules.length !== RULE_IDS.length) {
      errors.push(`error:rule_count:${reportCase.caseId}`);
    }
    for (const rule of reportCase.rules) {
      if (rule.verdict === 'error')
        errors.push(`error:${rule.evidenceCode}:${rule.ruleId}:${reportCase.caseId}`);
    }
  }
  return errors;
}

/**
 * Release decision. ERROR means the evidence is incomplete or untrustworthy; BLOCK means the evidence
 * is complete and shows a problem; PASS requires complete evidence and no problem. Every metric is
 * recomputed from case results rather than read from the report.
 */
export function computeGate(input: GateInput): GateResult {
  const thresholds = input.thresholds ?? GATE_THRESHOLDS;
  const generatedAt = (input.now ?? new Date()).toISOString();
  const parsed = runReportSchema.safeParse(input.candidate);
  if (!parsed.success) {
    return {
      status: 'ERROR',
      artifact: null,
      errors: ['error:report_invalid'],
      blockers: [],
      warnings: [],
      comparison: null,
    };
  }
  const candidate = parsed.data;
  const errors = integrityErrors(candidate);
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (input.expectedDataset !== undefined) {
    if (candidate.dataset.version !== input.expectedDataset.version)
      errors.push('integrity:dataset_version_mismatch');
    if (candidate.dataset.sha256 !== input.expectedDataset.sha256)
      errors.push('integrity:dataset_sha_mismatch');
  }

  const metrics = computeMetrics(candidate.cases);
  for (const failure of metrics.criticalFailures) {
    blockers.push(`critical:${failure.ruleId}:${failure.caseId}`);
  }
  if (
    metrics.decisionAccuracy.value === null ||
    metrics.decisionAccuracy.value < thresholds.minDecisionAccuracy
  ) {
    blockers.push(`threshold:decision_accuracy:${pct(metrics.decisionAccuracy)}`);
  }
  if (
    metrics.routeAccuracy.value === null ||
    metrics.routeAccuracy.value < thresholds.minRouteAccuracy
  ) {
    blockers.push(`threshold:route_accuracy:${pct(metrics.routeAccuracy)}`);
  }
  if (metrics.mustEscalateRecall.denominator === 0) {
    warnings.push('must_escalate_recall_not_applicable');
  } else if ((metrics.mustEscalateRecall.value ?? 0) < thresholds.minMustEscalateRecall) {
    blockers.push(`threshold:must_escalate_recall:${pct(metrics.mustEscalateRecall)}`);
  }

  let comparison: RunComparison | null = null;
  if (input.baseline !== undefined) {
    const baselineParsed = runReportSchema.safeParse(input.baseline);
    if (!baselineParsed.success) {
      errors.push('incompatible_baseline:report_invalid');
    } else {
      const baseline = baselineParsed.data;
      if (integrityErrors(baseline).length > 0) {
        errors.push('incompatible_baseline:baseline_incomplete');
      }
      comparison = compareRuns(candidate, baseline, thresholds);
      for (const reason of comparison.incompatibilities) {
        errors.push(`incompatible_baseline:${reason}`);
      }
      if (comparison.compatible) {
        for (const failure of comparison.newCriticalFailures) {
          blockers.push(`regression:new_critical:${failure.ruleId}:${failure.caseId}`);
        }
        for (const [name, metricDelta] of Object.entries(comparison.metricDeltas)) {
          if (name === 'intentAccuracy' || metricDelta.deltaPp === null) continue;
          if (metricDelta.deltaPp < -thresholds.maxAccuracyDropPp) {
            blockers.push(`regression:${name}_drop:${metricDelta.deltaPp.toFixed(2)}pp`);
          }
        }
        if (!comparison.latency.comparable) {
          warnings.push('latency_not_comparable_below_floor');
        } else if (
          comparison.latency.ratio !== null &&
          comparison.latency.ratio > thresholds.maxP95LatencyRatio
        ) {
          blockers.push(`regression:p95_latency:${comparison.latency.ratio.toFixed(2)}x`);
        }
        const baselineCost = computeMetrics(baseline.cases).cost;
        if (baselineCost.totalUsd === null || metrics.cost.totalUsd === null) {
          warnings.push('cost_not_comparable');
        }
      }
    }
  }

  const status: GateStatus = errors.length > 0 ? 'ERROR' : blockers.length > 0 ? 'BLOCK' : 'PASS';
  const criticalFailureCases = new Set(metrics.criticalFailures.map((failure) => failure.caseId))
    .size;
  const errorCases = new Set(metrics.ruleErrors.map((failure) => failure.caseId)).size;

  const artifact: GateArtifact = {
    gateVersion: GATE_VERSION,
    generatedAt,
    status,
    candidateRunId: candidate.run.id,
    baselineRunId: comparison?.baselineRunId ?? null,
    agentVersion: candidate.agent.version,
    agentSourceHash: candidate.agent.sourceHash,
    datasetVersion: candidate.dataset.version,
    datasetSha256: candidate.dataset.sha256,
    policySha256: candidate.policy.sha256,
    evaluatorVersion: candidate.evaluatorVersion,
    caseCount: candidate.dataset.caseCount,
    blockers: [...errors, ...blockers],
    warnings,
    metrics: {
      decisionAccuracy: metrics.decisionAccuracy.value,
      routeAccuracy: metrics.routeAccuracy.value,
      intentAccuracy: metrics.intentAccuracy.value,
      mustEscalateRecall: metrics.mustEscalateRecall.value,
      criticalFailureCases,
      errorCases,
      p50LatencyMs: metrics.latencyMs.p50,
      p95LatencyMs: metrics.latencyMs.p95,
      totalCostUsd: metrics.cost.totalUsd,
    },
    denominators: {
      caseCount: candidate.dataset.caseCount,
      resultCount: candidate.cases.length,
      decisionScoredCases: metrics.decisionAccuracy.denominator,
      routeScoredCases: metrics.routeAccuracy.denominator,
      mustEscalateCriticalCases: metrics.mustEscalateRecall.denominator,
    },
    thresholds: { ...thresholds },
    comparison:
      comparison === null
        ? null
        : {
            compatible: comparison.compatible,
            incompatibilities: comparison.incompatibilities,
            newCriticalFailures: comparison.newCriticalFailures,
            newFailures: comparison.newFailures,
            fixedCases: comparison.fixedCases,
            unchangedFailures: comparison.unchangedFailures,
            metricDeltas: comparison.metricDeltas,
            latency: comparison.latency,
          },
  };

  return { status, artifact, errors, blockers, warnings, comparison };
}
