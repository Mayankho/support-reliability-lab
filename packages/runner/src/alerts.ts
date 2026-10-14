import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listRuns, loadRunResults, type Db } from '@srl/db';
import { gateArtifactSchema } from '@srl/evals';
import { ALERT_RULES, evaluateAlerts, type AlertEvent, type GatedRun } from '@srl/telemetry';

const CRITICAL_BLOCKER = /^critical:([A-Z_]+):([A-Z]{2,5}-\d{3})$/u;

/** Builds the alert timeline from recorded gates. Runs without a valid gate artifact count as ungated. */
export async function loadGatedRunTimeline(db: Db, workspaceId: string): Promise<GatedRun[]> {
  const runs = await listRuns(db, { workspaceId, limit: 100 });
  const timeline: GatedRun[] = [];
  for (const run of runs) {
    const gate = gateArtifactSchema.safeParse(run.gateJson);
    const artifact = gate.success ? gate.data : null;
    let firstFailingCase: GatedRun['firstFailingCase'] = null;
    const firstCritical = artifact?.blockers
      .map((blocker) => CRITICAL_BLOCKER.exec(blocker))
      .find((match) => match !== null);
    if (firstCritical?.[1] !== undefined && firstCritical[2] !== undefined) {
      const caseId = firstCritical[2];
      const result = (await loadRunResults(db, run.id)).find(
        (candidate) => candidate.caseKey === caseId,
      );
      firstFailingCase = {
        caseId,
        ruleId: firstCritical[1],
        traceId: result?.traceId ?? 'unknown',
      };
    }
    const comparison = artifact?.comparison as
      { latency?: { ratio?: number | null } } | null | undefined;
    timeline.push({
      runId: run.id,
      agentVersion: run.agentVersion,
      status: run.status,
      gateStatus: artifact?.status ?? null,
      createdAt: run.createdAt,
      baselineRunId: run.baselineRunId,
      criticalFailureCases: artifact?.metrics.criticalFailureCases ?? 0,
      blockers: artifact?.blockers ?? [],
      latencyRatio: comparison?.latency?.ratio ?? null,
      firstFailingCase,
    });
  }
  return timeline;
}

/** Alerts that fired and were not cleared by a later event with the same key. */
export function openAlerts(events: readonly AlertEvent[]): AlertEvent[] {
  const open = new Map<string, AlertEvent>();
  for (const event of events) {
    if (event.state === 'firing') open.set(event.key, event);
    else open.delete(event.key);
  }
  return [...open.values()];
}

export function renderIncidentReport(
  events: readonly AlertEvent[],
  timeline: readonly GatedRun[],
  generatedAt: Date,
): string {
  const rows = [...timeline]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(
      (run) =>
        `| ${run.createdAt.toISOString()} | ${run.agentVersion} | \`${run.runId}\` | ${run.status} | ${run.gateStatus ?? 'not recorded'} | ${String(run.criticalFailureCases)} |`,
    );
  const eventLines = events.map((event) => {
    const evidence =
      event.evidence === null
        ? ''
        : ` Evidence: case ${event.evidence.caseId}, rule ${event.evidence.ruleId}, trace \`${event.evidence.traceId}\`.`;
    return `- **${event.state.toUpperCase()}** ${event.rule} at ${event.at} on ${event.agentVersion} (run \`${event.runId}\`): ${event.detail}${evidence}`;
  });
  const open = openAlerts(events);
  return [
    `# Simulated incident report`,
    '',
    `Generated ${generatedAt.toISOString()} from recorded release gates. Synthetic evaluation data; no alert was delivered to any channel.`,
    '',
    '## Alert events',
    '',
    ...(eventLines.length > 0 ? eventLines : ['- None.']),
    '',
    `## Open alerts: ${String(open.length)}`,
    '',
    ...(open.length > 0
      ? open.map((event) => `- ${event.rule} (run \`${event.runId}\`)`)
      : ['- None. Every alert that fired has been cleared by a later run.']),
    '',
    '## Run timeline',
    '',
    '| Created | Agent version | Run | Status | Gate | Cases with critical failures |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    '## Rules',
    '',
    ...Object.entries(ALERT_RULES).map(([id, rule]) => `- \`${id}\`: ${rule.description}`),
    '',
  ].join('\n');
}

export async function writeIncidentReport(
  dir: string,
  content: string,
  generatedAt: Date,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `incident-${generatedAt.toISOString().replace(/[:.]/gu, '-')}.md`);
  await writeFile(path, content);
  return path;
}

export { evaluateAlerts };
