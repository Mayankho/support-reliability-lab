import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AGENT_VERSIONS, agentSourceHash, getAgent, isAgentVersionId } from '@srl/agent';
import type { AdapterKind, AgentAdapter } from '@srl/contracts';
import {
  claimNextJob,
  countCaseResults,
  finishRun,
  getRun,
  insertCaseResult,
  listCaseIdsWithResults,
  loadCaseInputs,
  loadCaseLabels,
  rebuildGoldenCase,
  releaseJob,
  renewLease,
  type ClaimedJob,
  type Db,
} from '@srl/db';
import { EVALUATOR_VERSION } from '@srl/evals';
import { executeCase, mapWithConcurrency, prepareCase, type CaseResult } from './execute.ts';

export interface AgentResolution {
  adapter: AgentAdapter;
  adapterKind: AdapterKind;
  sourceHash: string;
}

export type AgentResolver = (version: string) => AgentResolution | null;

export const resolveBuiltInAgent: AgentResolver = (version) =>
  isAgentVersionId(version)
    ? {
        adapter: getAgent(version),
        adapterKind: AGENT_VERSIONS[version].adapterKind,
        sourceHash: agentSourceHash(version),
      }
    : null;

export const runConfigSchema = z
  .object({
    caseTimeoutMs: z.number().int().min(1).max(60_000),
    latencyBudgetMs: z.number().int().min(1).max(60_000),
    graderTimeoutMs: z.number().int().min(1).max(60_000),
    maxConcurrency: z.number().int().min(1).max(16),
  })
  .strict();

export interface WorkerOptions {
  db: Db;
  workerId: string;
  leaseMs: number;
  resolveAgent?: AgentResolver;
  /** Called after each case is stored. A throw here behaves like the worker failing mid-batch. */
  onCaseStored?: (storedByThisWorker: number) => void | Promise<void>;
}

export type WorkerOutcomeKind = 'completed' | 'errored' | 'lease_lost' | 'released';

export interface WorkerOutcome {
  runId: string;
  outcome: WorkerOutcomeKind;
  errorCode: string | null;
  storedByThisWorker: number;
  recoveredStaleLease: boolean;
}

class LeaseLostError extends Error {}

const shortHash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);

function costFields(result: CaseResult, adapterKind: AdapterKind) {
  const usage = result.output?.model;
  if (usage !== undefined) {
    return {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.estimatedCostUsd,
      costSource: 'model_reported' as const,
    };
  }
  return adapterKind === 'offline_deterministic'
    ? { inputTokens: null, outputTokens: null, costUsd: 0, costSource: 'offline_zero' as const }
    : { inputTokens: null, outputTokens: null, costUsd: null, costSource: 'unavailable' as const };
}

/** Claims the next runnable job, if any, and processes it. */
export async function workOnce(options: WorkerOptions): Promise<WorkerOutcome | null> {
  const job = await claimNextJob(options.db, options.workerId, options.leaseMs);
  return job === null ? null : processClaimedJob(options, job);
}

export async function processClaimedJob(
  options: WorkerOptions,
  job: ClaimedJob,
): Promise<WorkerOutcome> {
  const { db, workerId, leaseMs } = options;
  const resolveAgent = options.resolveAgent ?? resolveBuiltInAgent;
  let stored = 0;
  const outcome = (kind: WorkerOutcomeKind, errorCode: string | null = null): WorkerOutcome => ({
    runId: job.runId,
    outcome: kind,
    errorCode,
    storedByThisWorker: stored,
    recoveredStaleLease: job.recoveredStaleLease,
  });
  const fail = async (errorCode: string): Promise<WorkerOutcome> => {
    const finished = await finishRun(db, {
      jobId: job.jobId,
      runId: job.runId,
      workerId,
      outcome: 'errored',
      errorCode,
      correlationId: job.jobId,
    });
    return outcome(finished ? 'errored' : 'lease_lost', errorCode);
  };

  try {
    const run = await getRun(db, job.runId);
    if (run === null) {
      return await fail('run_missing');
    }
    const config = runConfigSchema.safeParse(run.config);
    if (!config.success) {
      return await fail('run_config_invalid');
    }
    const agent = resolveAgent(run.agentVersion);
    if (agent === null) {
      return await fail('agent_version_unavailable');
    }
    if (agent.sourceHash !== run.agentSourceHash) {
      return await fail('agent_source_changed');
    }
    if (run.datasetSha256 !== run.manifestSha) {
      return await fail('dataset_hash_mismatch');
    }

    const inputs = await loadCaseInputs(db, run.datasetId);
    if (inputs.length !== run.caseCount) {
      return await fail('case_count_mismatch');
    }
    const labels = await loadCaseLabels(db, run.datasetId);
    const done = await listCaseIdsWithResults(db, run.id);
    const pending = inputs.filter((input) => !done.has(input.caseId));

    let leaseLost = false;
    await mapWithConcurrency(pending, config.data.maxConcurrency, async (input) => {
      if (leaseLost) return;
      const goldenCase = rebuildGoldenCase(input, labels.get(input.caseId));
      const prepared = prepareCase(goldenCase, `${run.id}:${input.caseKey}`);
      const result = await executeCase(prepared, agent.adapter, agent.adapterKind, config.data);
      const traceId = randomBytes(16).toString('hex');
      const failedRules = result.rules
        .filter((rule) => rule.verdict === 'fail' || rule.verdict === 'error')
        .map((rule) => rule.ruleId);

      const inserted = await insertCaseResult(db, {
        runId: run.id,
        caseId: input.caseId,
        status: result.status,
        executionError: result.executionError,
        output: result.output,
        durationMs: result.durationMs,
        ...costFields(result, agent.adapterKind),
        traceId,
        rules: result.rules,
        traceSpans: [
          {
            spanId: randomBytes(8).toString('hex'),
            kind: 'eval.case',
            attributes: {
              caseHash: shortHash(input.caseKey),
              status: result.status,
              agentVersion: run.agentVersion,
              evaluatorVersion: EVALUATOR_VERSION,
            },
          },
          {
            spanId: randomBytes(8).toString('hex'),
            kind: 'agent.invoke',
            attributes: {
              durationMs: Number(result.durationMs.toFixed(3)),
              executionError: result.executionError,
            },
          },
          {
            spanId: randomBytes(8).toString('hex'),
            kind: 'grader.evaluate',
            attributes: { ruleCount: result.rules.length, failedRules },
          },
        ],
      });
      if (inserted) {
        stored += 1;
      }
      if (!(await renewLease(db, job.jobId, workerId, leaseMs))) {
        leaseLost = true;
        throw new LeaseLostError();
      }
      await options.onCaseStored?.(stored);
    });

    const count = await countCaseResults(db, run.id);
    if (count !== run.caseCount) {
      return await fail('missing_results');
    }
    const finished = await finishRun(db, {
      jobId: job.jobId,
      runId: run.id,
      workerId,
      outcome: 'completed',
      errorCode: null,
      correlationId: job.jobId,
    });
    return outcome(finished ? 'completed' : 'lease_lost');
  } catch (error) {
    if (error instanceof LeaseLostError) {
      return outcome('lease_lost');
    }
    await releaseJob(db, job.jobId, workerId, 'worker_exception');
    return outcome('released', 'worker_exception');
  }
}
