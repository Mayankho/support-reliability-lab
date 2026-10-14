import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getRun, listRuns, runSummary, type Db, type RunRecord } from '@srl/db';
import { compareRuns, computeMetrics, gateArtifactSchema } from '@srl/evals';
import { DEFAULT_RUN_CONFIG, RunRequestError, buildReportFromDb, enqueueRun } from '@srl/runner';
import { requireRole } from '../auth.ts';
import { parseRunId, requireDb, uuidSchema } from '../context.ts';
import { ApiError, notFound } from '../errors.ts';
import { decodeCursor, encodeCursor, limitSchema } from '../pagination.ts';
import type { RateLimiter } from '../rate-limit.ts';

const RUN_STATUSES = ['queued', 'running', 'completed', 'errored', 'cancelled'] as const;
const FINISHED = new Set(['completed', 'errored', 'cancelled']);

export const createRunBodySchema = z
  .object({
    datasetVersion: z.string().regex(/^v[0-9]+(?:\.[0-9]+)?$/u),
    agentVersion: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9-]+$/u),
    baselineRunId: uuidSchema.nullable().default(null),
    runMode: z.literal('offline'),
    maxConcurrency: z.number().int().min(1).max(8).default(4),
  })
  .strict();

const listQuerySchema = z
  .object({
    limit: limitSchema,
    cursor: z.string().max(512).optional(),
    status: z.enum(RUN_STATUSES).optional(),
  })
  .strict();
const listCursorSchema = z.object({ createdAt: z.iso.datetime(), id: uuidSchema }).strict();
const compareQuerySchema = z.object({ baselineRunId: z.string() }).strict();

/** Loads a run the caller's workspace owns; anything else is indistinguishable from missing. */
export async function loadOwnedRun(
  db: Db,
  request: FastifyRequest,
  rawId: unknown,
): Promise<RunRecord> {
  const run = await getRun(db, parseRunId(rawId));
  if (run === null || run.workspaceId !== request.workspaceId) {
    throw notFound();
  }
  return run;
}

function runView(run: RunRecord) {
  return {
    id: run.id,
    status: run.status,
    gateStatus: run.gateStatus,
    errorCode: run.errorCode,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    baselineRunId: run.baselineRunId,
    agent: {
      version: run.agentVersion,
      sourceHash: run.agentSourceHash,
      adapterKind: run.agentAdapterKind,
      sourceCommit: run.agentSourceCommit,
    },
    dataset: { version: run.datasetVersion, sha256: run.datasetSha256, caseCount: run.caseCount },
    policySha256: run.policySha,
    evaluatorVersion: run.evaluatorVersion,
  };
}

function mapRunRequestError(error: RunRequestError): ApiError {
  switch (error.code) {
    case 'UNKNOWN_AGENT_VERSION':
      return new ApiError(422, 'VALIDATION_FAILED', 'Invalid request: agentVersion.');
    case 'DATASET_INVALID':
      return new ApiError(422, 'VALIDATION_FAILED', 'Invalid request: datasetVersion.');
    case 'DATASET_HASH_MISMATCH':
      return new ApiError(409, 'CONFLICT', 'Dataset on disk no longer matches the stored version.');
    case 'BASELINE_NOT_FOUND':
      return notFound();
    case 'BASELINE_INCOMPATIBLE':
      return new ApiError(409, 'INCOMPATIBLE_RUNS', 'Baseline run used a different dataset.');
    default:
      return new ApiError(500, 'INTERNAL', 'Internal error.');
  }
}

export function registerRunRoutes(
  app: FastifyInstance,
  db: Db | undefined,
  limiter: RateLimiter,
): void {
  app.post('/api/v1/evaluation-runs', async (request, reply) => {
    requireRole(request.principal, 'reviewer');
    const body = createRunBodySchema.parse(request.body);
    limiter.check(`runs:${request.workspaceId}`);
    let runId: string;
    try {
      runId = await enqueueRun(requireDb(db), {
        datasetVersion: body.datasetVersion,
        agentVersion: body.agentVersion,
        baselineRunId: body.baselineRunId,
        workspaceId: request.workspaceId,
        config: { ...DEFAULT_RUN_CONFIG, maxConcurrency: body.maxConcurrency },
        actor: `api:${request.workspaceId}`,
        correlationId: request.id,
      });
    } catch (error) {
      throw error instanceof RunRequestError ? mapRunRequestError(error) : error;
    }
    return reply
      .status(202)
      .header('location', `/api/v1/evaluation-runs/${runId}`)
      .send({ runId, status: 'queued' });
  });

  app.get('/api/v1/evaluation-runs', async (request) => {
    const query = listQuerySchema.parse(request.query);
    const before =
      query.cursor === undefined ? undefined : decodeCursor(query.cursor, listCursorSchema);
    const runs = await listRuns(requireDb(db), {
      workspaceId: request.workspaceId,
      limit: query.limit,
      status: query.status,
      before:
        before === undefined ? undefined : { createdAt: new Date(before.createdAt), id: before.id },
    });
    const last = runs.at(-1);
    return {
      items: runs.map(runView),
      nextCursor:
        runs.length === query.limit && last !== undefined
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  });

  app.get('/api/v1/evaluation-runs/:runId', async (request) => {
    const database = requireDb(db);
    const run = await loadOwnedRun(
      database,
      request,
      (request.params as { runId?: unknown }).runId,
    );
    const summary = await runSummary(database, run.id);
    let metrics = null;
    if (run.status === 'completed') {
      const computed = computeMetrics((await buildReportFromDb(database, run.id)).cases);
      metrics = {
        decisionAccuracy: computed.decisionAccuracy,
        routeAccuracy: computed.routeAccuracy,
        intentAccuracy: computed.intentAccuracy,
        mustEscalateRecall: computed.mustEscalateRecall,
        latencyMs: computed.latencyMs,
        cost: computed.cost,
      };
    }
    return { ...runView(run), summary, metrics };
  });

  app.get('/api/v1/evaluation-runs/:runId/gate', async (request) => {
    const run = await loadOwnedRun(
      requireDb(db),
      request,
      (request.params as { runId?: unknown }).runId,
    );
    if (run.gateStatus === null) {
      throw FINISHED.has(run.status)
        ? new ApiError(
            409,
            'GATE_NOT_RECORDED',
            'The run has finished but no gate has been recorded.',
          )
        : new ApiError(409, 'RUN_NOT_FINISHED', 'The run has not finished.');
    }
    return gateArtifactSchema.parse(run.gateJson);
  });

  app.get('/api/v1/evaluation-runs/:runId/compare', async (request) => {
    const database = requireDb(db);
    const { baselineRunId } = compareQuerySchema.parse(request.query);
    const candidate = await loadOwnedRun(
      database,
      request,
      (request.params as { runId?: unknown }).runId,
    );
    const baseline = await loadOwnedRun(database, request, baselineRunId);
    if (candidate.status !== 'completed' || baseline.status !== 'completed') {
      throw new ApiError(409, 'RUN_NOT_FINISHED', 'Both runs must be completed to compare.');
    }
    const comparison = compareRuns(
      await buildReportFromDb(database, candidate.id),
      await buildReportFromDb(database, baseline.id),
    );
    if (!comparison.compatible) {
      throw new ApiError(
        409,
        'INCOMPATIBLE_RUNS',
        `Runs cannot be compared: ${comparison.incompatibilities.join(', ')}.`,
      );
    }
    return comparison;
  });
}
