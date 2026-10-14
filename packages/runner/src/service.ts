import { execFileSync } from 'node:child_process';
import { AGENT_VERSIONS, agentSourceHash, isAgentVersionId, type AgentVersionId } from '@srl/agent';
import { loadDataset, type ValidatedDataset } from '@srl/dataset';
import {
  createRun,
  getDatasetByVersion,
  getRun,
  importDataset,
  registerAgentVersion,
  type Db,
} from '@srl/db';
import { EVALUATOR_VERSION } from '@srl/evals';
import { getSyntheticPolicy } from '@srl/policies';
import { DEFAULT_RUN_CONFIG, type RunConfig } from './execute.ts';
import { workOnce, type WorkerOptions } from './worker.ts';

export type RunRequestErrorCode =
  | 'DATASET_INVALID'
  | 'DATASET_HASH_MISMATCH'
  | 'UNKNOWN_AGENT_VERSION'
  | 'BASELINE_NOT_FOUND'
  | 'BASELINE_INCOMPATIBLE';

export class RunRequestError extends Error {
  readonly code: RunRequestErrorCode;

  constructor(code: RunRequestErrorCode, message: string) {
    super(message);
    this.name = 'RunRequestError';
    this.code = code;
  }
}

/** The commit the code ran from, marked `-dirty` when the working tree has uncommitted changes. */
export function currentSourceCommit(): string | null {
  try {
    const commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const dirty =
      execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
    return dirty ? `${commit}-dirty` : commit;
  } catch {
    return null;
  }
}

export async function loadVerifiedDataset(version: string): Promise<ValidatedDataset> {
  const loaded = await loadDataset(version);
  if (!loaded.ok) {
    throw new RunRequestError(
      'DATASET_INVALID',
      `dataset ${version} failed validation: ${loaded.issues.map((issue) => issue.code).join(', ')}`,
    );
  }
  return loaded.dataset;
}

/** Imports the dataset if new, and refuses to proceed if the stored bytes differ from the file. */
export async function ensureDataset(db: Db, dataset: ValidatedDataset): Promise<string> {
  const stored = await getDatasetByVersion(db, dataset.version);
  if (stored !== null) {
    if (stored.sha256 !== dataset.sha256) {
      throw new RunRequestError(
        'DATASET_HASH_MISMATCH',
        `dataset ${dataset.version} on disk no longer matches the stored copy`,
      );
    }
    return stored.id;
  }
  const imported = await importDataset(db, {
    version: dataset.version,
    sha256: dataset.sha256,
    policyVersion: dataset.policy.id,
    policySha256: dataset.policy.sha256,
    reviewStatus: dataset.manifest.humanReviewStatus,
    manifest: dataset.manifest,
    cases: dataset.cases,
  });
  return imported.id;
}

export async function ensureAgentVersion(db: Db, version: AgentVersionId): Promise<string> {
  const info = AGENT_VERSIONS[version];
  return registerAgentVersion(db, {
    version,
    sourceHash: agentSourceHash(version),
    policyHash: getSyntheticPolicy().sha256,
    adapterKind: info.adapterKind,
    sourceCommit: currentSourceCommit(),
    description: info.description,
  });
}

export interface EnqueueRunInput {
  datasetVersion: string;
  agentVersion: string;
  baselineRunId: string | null;
  workspaceId: string;
  config?: RunConfig;
  actor: string;
  correlationId: string;
}

export async function enqueueRun(db: Db, input: EnqueueRunInput): Promise<string> {
  if (!isAgentVersionId(input.agentVersion)) {
    throw new RunRequestError(
      'UNKNOWN_AGENT_VERSION',
      `unknown agent version ${input.agentVersion}`,
    );
  }
  const dataset = await loadVerifiedDataset(input.datasetVersion);
  const datasetId = await ensureDataset(db, dataset);
  const agentVersionId = await ensureAgentVersion(db, input.agentVersion);

  if (input.baselineRunId !== null) {
    const baseline = await getRun(db, input.baselineRunId);
    if (baseline === null || baseline.workspaceId !== input.workspaceId) {
      throw new RunRequestError('BASELINE_NOT_FOUND', 'baseline run not found');
    }
    if (baseline.datasetSha256 !== dataset.sha256) {
      throw new RunRequestError('BASELINE_INCOMPATIBLE', 'baseline run used a different dataset');
    }
  }

  return createRun(db, {
    workspaceId: input.workspaceId,
    datasetId,
    agentVersionId,
    baselineRunId: input.baselineRunId,
    caseCount: dataset.cases.length,
    manifestSha: dataset.sha256,
    policySha: dataset.policy.sha256,
    evaluatorVersion: EVALUATOR_VERSION,
    config: { ...(input.config ?? DEFAULT_RUN_CONFIG) },
    actor: input.actor,
    correlationId: input.correlationId,
  });
}

const FINISHED = new Set(['completed', 'errored', 'cancelled']);

/** Works jobs until the given run finishes. Used by the CLI and demo; the API enqueues only. */
export async function runUntilFinished(
  options: Omit<WorkerOptions, 'onCaseStored'>,
  runId: string,
  maxIterations = 20,
): Promise<string> {
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const run = await getRun(options.db, runId);
    if (run === null) {
      throw new Error(`run ${runId} not found`);
    }
    if (FINISHED.has(run.status)) {
      return run.status;
    }
    const outcome = await workOnce(options);
    if (outcome === null) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(options.leaseMs, 500)));
    }
  }
  throw new Error(`run ${runId} did not finish within ${String(maxIterations)} worker iterations`);
}
