import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { AGENT_VERSION_IDS, type AgentVersionId } from '@srl/agent';
import type { GateStatus } from '@srl/contracts';
import type { Db } from '@srl/db';
import { renderDemoIndexHtml } from '@srl/evals';
import {
  ensureAgentVersion,
  ensureDataset,
  enqueueRun,
  loadVerifiedDataset,
  runUntilFinished,
} from './service.ts';
import { evaluateAndGate, type GateOutcome } from './report.ts';

export interface DemoStep {
  version: AgentVersionId;
  expected: GateStatus;
  baseline: 'none' | 'reference-v1';
  outcome: GateOutcome;
}

export interface DemoResult {
  ok: boolean;
  verdict: string;
  problems: string[];
  steps: DemoStep[];
  indexPath: string;
}

const PLAN: ReadonlyArray<{
  version: AgentVersionId;
  expected: GateStatus;
  baseline: 'none' | 'reference-v1';
}> = [
  { version: 'reference-v1', expected: 'PASS', baseline: 'none' },
  { version: 'regression-demo-v1', expected: 'BLOCK', baseline: 'reference-v1' },
  { version: 'repaired-v1', expected: 'PASS', baseline: 'reference-v1' },
];

/**
 * Runs the three versions on the same verified dataset and checks the observed gates. The demo
 * succeeds only if it actually sees PASS, BLOCK (on a critical completion claim), PASS.
 */
export async function runDemo(
  db: Db,
  outDir: string,
  workerId = `demo-${String(process.pid)}`,
): Promise<DemoResult> {
  const dataset = await loadVerifiedDataset('v1');
  await ensureDataset(db, dataset);
  for (const version of AGENT_VERSION_IDS) {
    await ensureAgentVersion(db, version);
  }

  const steps: DemoStep[] = [];
  let referenceRunId: string | null = null;
  let referenceReport: unknown;

  for (const step of PLAN) {
    const baselineRunId = step.baseline === 'reference-v1' ? referenceRunId : null;
    const runId = await enqueueRun(db, {
      datasetVersion: 'v1',
      agentVersion: step.version,
      baselineRunId,
      workspaceId: 'ws_demo',
      actor: 'demo',
      correlationId: `demo:${step.version}`,
    });
    await runUntilFinished({ db, workerId, leaseMs: 30_000 }, runId);
    const outcome = await evaluateAndGate(
      db,
      runId,
      join(outDir, step.version),
      step.baseline === 'reference-v1' ? referenceReport : undefined,
    );
    if (step.version === 'reference-v1') {
      referenceRunId = runId;
      referenceReport = outcome.report;
    }
    steps.push({ ...step, outcome });
  }

  const problems: string[] = [];
  for (const step of steps) {
    if (step.outcome.status !== step.expected) {
      problems.push(`${step.version}: expected ${step.expected}, observed ${step.outcome.status}`);
    }
  }
  const regression = steps.find((step) => step.version === 'regression-demo-v1');
  if (
    regression !== undefined &&
    !regression.outcome.gate.blockers.some((b) => b.startsWith('critical:NO_FALSE_COMPLETION:'))
  ) {
    problems.push('regression-demo-v1 was not blocked by a critical NO_FALSE_COMPLETION failure');
  }
  const datasetHashes = new Set(steps.map((step) => step.outcome.report.dataset.sha256));
  if (datasetHashes.size !== 1) {
    problems.push('runs did not share one dataset hash');
  }

  const ok = problems.length === 0;
  const verdict = ok
    ? 'Observed PASS, BLOCK, PASS on the same frozen dataset.'
    : `Demo did not observe the expected pattern: ${problems.join('; ')}`;

  await mkdir(outDir, { recursive: true });
  const indexPath = join(outDir, 'index.html');
  await writeFile(
    indexPath,
    renderDemoIndexHtml(
      steps.map((step) => ({
        label: step.version,
        expected: step.expected,
        report: step.outcome.report,
        gate: step.outcome.gate,
        href: relative(outDir, step.outcome.paths.reportHtml),
      })),
      verdict,
    ),
  );
  await writeFile(
    join(outDir, 'demo-summary.json'),
    `${JSON.stringify(
      {
        ok,
        verdict,
        datasetSha256: [...datasetHashes],
        steps: steps.map((step) => ({
          version: step.version,
          expected: step.expected,
          observed: step.outcome.status,
          runId: step.outcome.report.run.id,
          baselineRunId: step.outcome.gate.baselineRunId,
          agentSourceHash: step.outcome.report.agent.sourceHash,
          blockers: step.outcome.gate.blockers,
          gateJson: relative(outDir, step.outcome.paths.gateJson),
        })),
      },
      null,
      2,
    )}\n`,
  );

  return { ok, verdict, problems, steps, indexPath };
}
