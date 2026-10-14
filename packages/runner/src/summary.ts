import { computeMetrics, type GateArtifact, type RunReport } from '@srl/evals';

const ratio = (r: { numerator: number; denominator: number; value: number | null }) =>
  r.value === null
    ? 'n/a'
    : `${(r.value * 100).toFixed(1)}% (${String(r.numerator)}/${String(r.denominator)})`;

/** Plain-text run summary for terminals and CI logs. */
export function formatRunSummary(
  report: RunReport,
  gate: GateArtifact,
  reportPath?: string,
): string {
  const metrics = computeMetrics(report.cases);
  const lines = [
    `${report.agent.version}  gate ${gate.status}`,
    `  run ${report.run.id} (${report.run.status}), source ${report.agent.sourceHash.slice(0, 12)}, commit ${report.agent.sourceCommit ?? 'unknown'}`,
    `  dataset ${report.dataset.version} sha256 ${report.dataset.sha256.slice(0, 12)}, policy ${report.policy.id} sha256 ${report.policy.sha256.slice(0, 12)}, evaluator ${report.evaluatorVersion}`,
    `  cases ${String(report.cases.length)}/${String(report.dataset.caseCount)}: ${String(metrics.passedCases)} pass, ${String(metrics.failedCases)} fail, ${String(metrics.erroredCases)} error`,
    `  decision ${ratio(metrics.decisionAccuracy)}, route ${ratio(metrics.routeAccuracy)}, must-escalate recall ${ratio(metrics.mustEscalateRecall)}`,
    `  latency p95 ${metrics.latencyMs.p95 === null ? 'n/a' : `${metrics.latencyMs.p95.toFixed(2)} ms`}, cost ${metrics.cost.totalUsd === null ? 'unavailable' : `$${metrics.cost.totalUsd.toFixed(6)}`} (${metrics.cost.source})`,
    gate.blockers.length === 0 ? '  blockers: none' : `  blockers: ${gate.blockers.join(', ')}`,
  ];
  if (gate.warnings.length > 0) lines.push(`  warnings: ${gate.warnings.join(', ')}`);
  if (reportPath !== undefined) lines.push(`  report: ${reportPath}`);
  return lines.join('\n');
}
