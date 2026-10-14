import { computeMetrics, type Ratio } from './metrics.ts';
import type { GateArtifact, ReportCase, RunReport } from './schema.ts';

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/gu, (char) => ESCAPES[char] ?? char);
}

const fmtRatio = (ratio: Ratio) =>
  ratio.value === null
    ? `n/a (0 cases)`
    : `${(ratio.value * 100).toFixed(1)}% (${String(ratio.numerator)}/${String(ratio.denominator)})`;

const fmtMs = (value: number | null) => (value === null ? 'n/a' : `${value.toFixed(2)} ms`);

const STYLE = `
  body { font-family: system-ui, -apple-system, sans-serif; margin: 2rem auto; max-width: 72rem; padding: 0 1rem; color: #1a1a1a; line-height: 1.45; }
  h1, h2, h3 { line-height: 1.2; }
  table { border-collapse: collapse; width: 100%; margin: 0.75rem 0 1.5rem; }
  th, td { border: 1px solid #c8c8c8; padding: 0.35rem 0.55rem; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; }
  code, pre { font-family: ui-monospace, Menlo, monospace; font-size: 0.9em; }
  pre { white-space: pre-wrap; background: #f7f7f7; padding: 0.6rem; border: 1px solid #ddd; }
  .status { display: inline-block; padding: 0.15rem 0.6rem; border: 2px solid; font-weight: 700; }
  .status-PASS { border-color: #1b6e2d; color: #1b6e2d; }
  .status-BLOCK { border-color: #a11b1b; color: #a11b1b; }
  .status-ERROR { border-color: #8a5a00; color: #8a5a00; }
  .note { color: #555; font-size: 0.92em; }
  details { margin: 0.5rem 0 1rem; }
  summary { cursor: pointer; font-weight: 600; }
`;

function statusBadge(status: string): string {
  const label =
    status === 'PASS'
      ? 'PASS: release allowed'
      : status === 'BLOCK'
        ? 'BLOCK: release stopped'
        : 'ERROR: evidence incomplete';
  return `<span class="status status-${escapeHtml(status)}" role="status">${escapeHtml(label)}</span>`;
}

function blockerLink(blocker: string): string {
  const caseId = /:([A-Z]{2,5}-\d{3})$/u.exec(blocker)?.[1];
  return caseId === undefined
    ? `<code>${escapeHtml(blocker)}</code>`
    : `<a href="#case-${escapeHtml(caseId)}"><code>${escapeHtml(blocker)}</code></a>`;
}

function caseDetail(reportCase: ReportCase): string {
  const failing = reportCase.rules.filter(
    (rule) => rule.verdict === 'fail' || rule.verdict === 'error',
  );
  const account = reportCase.input.account;
  const output = reportCase.output;
  return `
  <section id="case-${escapeHtml(reportCase.caseId)}">
    <h3>${escapeHtml(reportCase.caseId)} <span class="note">(${escapeHtml(reportCase.category)}, ${escapeHtml(reportCase.risk)} risk, status ${escapeHtml(reportCase.status)})</span></h3>
    <p><strong>Customer message (synthetic):</strong></p>
    <pre>${escapeHtml(reportCase.input.message)}</pre>
    <p class="note">Account: authenticated ${escapeHtml(account.authenticated)}, actor ${escapeHtml(account.actorWorkspaceId)}, workspace ${escapeHtml(account.workspaceId)}, plan ${escapeHtml(account.subscription)}/${escapeHtml(account.planStatus)}, generation ${escapeHtml(account.generationStatus)}.</p>
    <table>
      <thead><tr><th scope="col">Field</th><th scope="col">Expected</th><th scope="col">Actual</th></tr></thead>
      <tbody>
        <tr><th scope="row">intent</th><td>${escapeHtml(reportCase.expected.intent)}</td><td>${escapeHtml(output?.intent ?? 'no output')}</td></tr>
        <tr><th scope="row">decision</th><td>${escapeHtml(reportCase.expected.decision)}</td><td>${escapeHtml(output?.decision ?? 'no output')}</td></tr>
        <tr><th scope="row">route</th><td>${escapeHtml(reportCase.expected.route)}</td><td>${escapeHtml(output?.route ?? 'no output')}</td></tr>
        <tr><th scope="row">proposed action</th><td>${escapeHtml(reportCase.expected.proposedAction)}</td><td>${escapeHtml(output?.proposedAction ?? 'no output')}</td></tr>
        <tr><th scope="row">claims action completed</th><td>false</td><td>${escapeHtml(output?.claimsActionCompleted ?? 'no output')}</td></tr>
      </tbody>
    </table>
    <p><strong>Agent reply:</strong></p>
    <pre>${escapeHtml(output?.customerReply ?? `(no output: ${reportCase.executionError ?? 'invalid output'})`)}</pre>
    <table>
      <thead><tr><th scope="col">Rule</th><th scope="col">Verdict</th><th scope="col">Severity</th><th scope="col">Evidence</th></tr></thead>
      <tbody>${failing
        .map(
          (rule) =>
            `<tr><td><code>${escapeHtml(rule.ruleId)}</code></td><td>${escapeHtml(rule.verdict)}</td><td>${escapeHtml(rule.severity)}</td><td>${escapeHtml(rule.evidence)}</td></tr>`,
        )
        .join('')}</tbody>
    </table>
    <p class="note">Suggested fix layer (hypothesis, needs human review): ${escapeHtml(reportCase.fixLayers.join(', ') || 'none')}. Trace ID: <code>${escapeHtml(reportCase.traceId ?? 'n/a')}</code>.</p>
  </section>`;
}

export function renderRunReportHtml(report: RunReport, gate: GateArtifact): string {
  const metrics = computeMetrics(report.cases);
  const problemCases = report.cases.filter((reportCase) =>
    reportCase.rules.some(
      (rule) =>
        rule.verdict === 'error' || (rule.verdict === 'fail' && rule.severity !== 'standard'),
    ),
  );
  const ruleRows = Object.entries(metrics.ruleCounts)
    .map(
      ([ruleId, counts]) =>
        `<tr><td><code>${escapeHtml(ruleId)}</code></td><td>${String(counts.pass)}</td><td>${String(counts.fail)}</td><td>${String(counts.error)}</td><td>${String(counts.not_applicable)}</td></tr>`,
    )
    .join('');
  const actualDecisions = [
    ...new Set(Object.values(metrics.decisionConfusion).flatMap((row) => Object.keys(row))),
  ].sort();
  const confusionRows = Object.entries(metrics.decisionConfusion)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([expected, row]) =>
        `<tr><th scope="row">${escapeHtml(expected)}</th>${actualDecisions.map((actual) => `<td>${String(row[actual] ?? 0)}</td>`).join('')}</tr>`,
    )
    .join('');
  const categoryRows = Object.entries(metrics.categoryCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([category, counts]) =>
        `<tr><td>${escapeHtml(category)}</td><td>${String(counts.cases)}</td><td>${String(counts.failed)}</td><td>${String(counts.errored)}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Run report: ${escapeHtml(report.agent.version)} (${escapeHtml(gate.status)})</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <h1>Run report: ${escapeHtml(report.agent.version)}</h1>
  <p>${statusBadge(gate.status)}</p>
  <p class="note">Synthetic suite. Thresholds are illustrative demo criteria, not production safety claims. Gold labels are starter labels (${escapeHtml(report.dataset.reviewStatus)}).</p>

  <h2>Release decision</h2>
  ${
    gate.blockers.length === 0
      ? '<p>No blockers. Every case has complete results, no critical rule failed, and thresholds are met.</p>'
      : `<p>${String(gate.blockers.length)} blocker(s):</p><ul>${gate.blockers.map((blocker) => `<li>${blockerLink(blocker)}</li>`).join('')}</ul>`
  }
  ${gate.warnings.length > 0 ? `<p class="note">Warnings: ${gate.warnings.map(escapeHtml).join(', ')}</p>` : ''}

  <h2>Provenance</h2>
  <table>
    <tbody>
      <tr><th scope="row">Run</th><td><code>${escapeHtml(report.run.id)}</code> (${escapeHtml(report.run.status)})</td></tr>
      <tr><th scope="row">Agent</th><td>${escapeHtml(report.agent.version)}, source <code>${escapeHtml(report.agent.sourceHash.slice(0, 16))}…</code>, commit <code>${escapeHtml(report.agent.sourceCommit ?? 'unknown')}</code></td></tr>
      <tr><th scope="row">Dataset</th><td>${escapeHtml(report.dataset.version)}, ${String(report.dataset.caseCount)} cases, sha256 <code>${escapeHtml(report.dataset.sha256)}</code></td></tr>
      <tr><th scope="row">Policy</th><td>${escapeHtml(report.policy.id)}, sha256 <code>${escapeHtml(report.policy.sha256)}</code></td></tr>
      <tr><th scope="row">Evaluator</th><td>${escapeHtml(report.evaluatorVersion)}</td></tr>
      <tr><th scope="row">Baseline</th><td>${gate.baselineRunId === null ? 'none' : `<code>${escapeHtml(gate.baselineRunId)}</code>`}</td></tr>
    </tbody>
  </table>

  <h2>Metrics</h2>
  <table>
    <tbody>
      <tr><th scope="row">Cases with results</th><td>${String(report.cases.length)} of ${String(report.dataset.caseCount)}</td></tr>
      <tr><th scope="row">Cases passed / failed (critical) / errored</th><td>${String(metrics.passedCases)} / ${String(metrics.failedCases)} / ${String(metrics.erroredCases)}</td></tr>
      <tr><th scope="row">Decision accuracy</th><td>${fmtRatio(metrics.decisionAccuracy)}</td></tr>
      <tr><th scope="row">Route accuracy</th><td>${fmtRatio(metrics.routeAccuracy)}</td></tr>
      <tr><th scope="row">Intent accuracy</th><td>${fmtRatio(metrics.intentAccuracy)}</td></tr>
      <tr><th scope="row">Must-escalate recall (critical cases)</th><td>${fmtRatio(metrics.mustEscalateRecall)}</td></tr>
      <tr><th scope="row">Latency p50 / p95</th><td>${fmtMs(metrics.latencyMs.p50)} / ${fmtMs(metrics.latencyMs.p95)}</td></tr>
      <tr><th scope="row">Model cost</th><td>${metrics.cost.totalUsd === null ? 'unavailable' : `$${metrics.cost.totalUsd.toFixed(6)}`} (${escapeHtml(metrics.cost.source)})</td></tr>
    </tbody>
  </table>
  <p class="note">Accuracy denominators are cases whose rule produced pass or fail. Percentages on 80 synthetic cases are not evidence of production accuracy.</p>

  <h3>Cases by category</h3>
  <p class="note">Most categories have fewer than 10 cases, so counts are shown instead of percentages.</p>
  <table><thead><tr><th scope="col">Category</th><th scope="col">Cases</th><th scope="col">Failed</th><th scope="col">Errored</th></tr></thead><tbody>${categoryRows}</tbody></table>

  <h3>Rule results</h3>
  <table><thead><tr><th scope="col">Rule</th><th scope="col">Pass</th><th scope="col">Fail</th><th scope="col">Error</th><th scope="col">N/A</th></tr></thead><tbody>${ruleRows}</tbody></table>

  <h3>Decision confusion (rows expected, columns actual)</h3>
  <table><thead><tr><th scope="col">Expected</th>${actualDecisions.map((actual) => `<th scope="col">${escapeHtml(actual)}</th>`).join('')}</tr></thead><tbody>${confusionRows}</tbody></table>

  <h2>Cases needing attention (${String(problemCases.length)})</h2>
  ${problemCases.length === 0 ? '<p>None. No critical or high-severity failures and no errors.</p>' : problemCases.map(caseDetail).join('')}
</main>
</body>
</html>
`;
}

export interface DemoRunSummary {
  label: string;
  expected: string;
  report: RunReport;
  gate: GateArtifact;
  href: string;
}

export function renderDemoIndexHtml(runs: readonly DemoRunSummary[], verdict: string): string {
  const rows = runs
    .map((run) => {
      const metrics = computeMetrics(run.report.cases);
      return `<tr>
        <th scope="row"><a href="${escapeHtml(run.href)}">${escapeHtml(run.label)}</a></th>
        <td>${statusBadge(run.gate.status)}</td>
        <td>${escapeHtml(run.expected)}</td>
        <td>${fmtRatio(metrics.decisionAccuracy)}</td>
        <td>${fmtRatio(metrics.routeAccuracy)}</td>
        <td>${String(new Set(metrics.criticalFailures.map((failure) => failure.caseId)).size)}</td>
        <td>${run.gate.blockers.length === 0 ? 'none' : run.gate.blockers.map(blockerLink).join('<br>')}</td>
      </tr>`;
    })
    .join('');
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Release gate demo</title><style>${STYLE}</style></head>
<body>
<main>
  <h1>Release gate demo</h1>
  <p><strong>${escapeHtml(verdict)}</strong></p>
  <p class="note">Three agent versions on the identical frozen dataset. Synthetic data and illustrative thresholds.</p>
  <table>
    <thead><tr><th scope="col">Version</th><th scope="col">Gate</th><th scope="col">Expected</th><th scope="col">Decision accuracy</th><th scope="col">Route accuracy</th><th scope="col">Cases with critical failures</th><th scope="col">Blockers</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</main>
</body>
</html>
`;
}
