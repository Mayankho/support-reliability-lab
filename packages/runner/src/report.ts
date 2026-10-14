import { readFile } from 'node:fs/promises';
import {
  accountContextSchema,
  caseCategorySchema,
  parseAgentOutput,
  caseStatusSchema,
  riskSchema,
  type GateStatus,
} from '@srl/contracts';
import {
  getDatasetByVersion,
  getRun,
  loadCaseInputs,
  loadCaseLabels,
  loadRunResults,
  recordGate,
  type Db,
} from '@srl/db';
import {
  buildRunReport,
  computeGate,
  writeRunArtifacts,
  type GateArtifact,
  type RunReport,
  type WrittenArtifacts,
} from '@srl/evals';
import { z } from 'zod';
import { loadVerifiedDataset } from './service.ts';
import { runConfigSchema } from './worker.ts';

const caseInputSchema = z.object({ message: z.string(), account: accountContextSchema }).strict();
const costSourceSchema = z.enum(['offline_zero', 'model_reported', 'unavailable']);

const iso = (value: Date | null) => (value === null ? null : value.toISOString());

/** Builds a run report from stored evidence, re-validating every persisted JSON value. */
export async function buildReportFromDb(db: Db, runId: string): Promise<RunReport> {
  const run = await getRun(db, runId);
  if (run === null) {
    throw new Error(`run ${runId} not found`);
  }
  const dataset = await getDatasetByVersion(db, run.datasetVersion);
  if (dataset === null) {
    throw new Error(`dataset ${run.datasetVersion} not found`);
  }
  const [results, inputs, labels] = await Promise.all([
    loadRunResults(db, runId),
    loadCaseInputs(db, run.datasetId),
    loadCaseLabels(db, run.datasetId),
  ]);
  const inputById = new Map(inputs.map((input) => [input.caseId, input]));

  return buildRunReport({
    run: {
      id: run.id,
      status: z.enum(['queued', 'running', 'completed', 'errored', 'cancelled']).parse(run.status),
      errorCode: run.errorCode,
      startedAt: iso(run.startedAt),
      finishedAt: iso(run.finishedAt),
    },
    agent: {
      version: run.agentVersion,
      sourceHash: run.agentSourceHash,
      adapterKind: z.enum(['offline_deterministic', 'model']).parse(run.agentAdapterKind),
      sourceCommit: run.agentSourceCommit,
    },
    dataset: {
      version: run.datasetVersion,
      sha256: run.datasetSha256,
      caseCount: run.caseCount,
      reviewStatus: dataset.reviewStatus,
    },
    policy: { id: dataset.policyVersion, sha256: run.policySha },
    evaluatorVersion: run.evaluatorVersion,
    config: runConfigSchema.parse(run.config),
    cases: results.map((result) => {
      const input = inputById.get(result.caseId);
      const expected = labels.get(result.caseId);
      if (input === undefined || expected === undefined) {
        throw new Error(`stored result references an unknown case`);
      }
      const parsedInput = caseInputSchema.parse(input.input);
      return {
        caseId: result.caseKey,
        category: caseCategorySchema.parse(result.category),
        risk: riskSchema.parse(result.risk),
        status: caseStatusSchema.parse(result.status),
        executionError: result.executionError,
        durationMs: result.durationMs,
        costUsd: result.costUsd === null ? null : Number(result.costUsd),
        costSource: costSourceSchema.parse(result.costSource),
        traceId: result.traceId,
        message: parsedInput.message,
        account: parsedInput.account,
        expected,
        output: result.output === null ? null : parseAgentOutput(result.output),
        rules: result.rules,
      };
    }),
  });
}

export async function readReportFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

export interface GateOutcome {
  status: GateStatus;
  report: RunReport;
  gate: GateArtifact;
  paths: WrittenArtifacts;
}

/**
 * Builds the report, computes the gate against the current fixture and an optional baseline,
 * records the gate on the run (once), and writes the three artifacts.
 */
export async function evaluateAndGate(
  db: Db,
  runId: string,
  outDir: string,
  baseline?: unknown,
  now = new Date(),
): Promise<GateOutcome> {
  const report = await buildReportFromDb(db, runId);
  const fixture = await loadVerifiedDataset(report.dataset.version);
  const result = computeGate({
    candidate: report,
    ...(baseline === undefined ? {} : { baseline }),
    expectedDataset: { version: fixture.version, sha256: fixture.sha256 },
    now,
  });
  if (result.artifact === null) {
    throw new Error(`gate could not evaluate run ${runId}: ${result.errors.join(', ')}`);
  }
  await recordGate(db, runId, result.status, result.artifact, `gate:${runId}`);
  const paths = await writeRunArtifacts(outDir, report, result.artifact);
  return { status: result.status, report, gate: result.artifact, paths };
}
