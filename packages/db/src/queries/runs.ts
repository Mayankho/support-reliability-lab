import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db, Executor } from '../client.ts';
import { agentVersions, auditEvents, datasets, evaluationRuns, runJobs } from '../schema.ts';

export interface AgentVersionRecord {
  version: string;
  sourceHash: string;
  policyHash: string;
  adapterKind: 'offline_deterministic' | 'model';
  sourceCommit: string | null;
  description: string;
}

/** One row per (version, source hash): the label alone never stands in for the code that ran. */
export async function registerAgentVersion(
  db: Executor,
  record: AgentVersionRecord,
): Promise<string> {
  await db
    .insert(agentVersions)
    .values(record)
    .onConflictDoNothing({
      target: [agentVersions.version, agentVersions.sourceHash],
    });
  const [row] = await db
    .select({ id: agentVersions.id })
    .from(agentVersions)
    .where(
      and(
        eq(agentVersions.version, record.version),
        eq(agentVersions.sourceHash, record.sourceHash),
      ),
    );
  if (row === undefined) {
    throw new Error('agent version registration returned no row');
  }
  return row.id;
}

export interface AuditInput {
  actor: string;
  action: string;
  resourceId: string;
  correlationId: string;
  details: Record<string, unknown>;
}

export async function appendAudit(db: Executor, event: AuditInput): Promise<void> {
  await db.insert(auditEvents).values({
    actor: event.actor,
    action: event.action,
    resourceId: event.resourceId,
    correlationId: event.correlationId,
    detailsJson: event.details,
  });
}

export interface CreateRunInput {
  workspaceId: string;
  datasetId: string;
  agentVersionId: string;
  baselineRunId: string | null;
  caseCount: number;
  manifestSha: string;
  policySha: string;
  evaluatorVersion: string;
  config: Record<string, unknown>;
  actor: string;
  correlationId: string;
  maxAttempts?: number;
}

export async function createRun(db: Db, input: CreateRunInput): Promise<string> {
  return db.transaction(async (tx) => {
    const [run] = await tx
      .insert(evaluationRuns)
      .values({
        workspaceId: input.workspaceId,
        datasetId: input.datasetId,
        agentVersionId: input.agentVersionId,
        baselineRunId: input.baselineRunId,
        caseCount: input.caseCount,
        manifestSha: input.manifestSha,
        policySha: input.policySha,
        evaluatorVersion: input.evaluatorVersion,
        configJson: input.config,
      })
      .returning({ id: evaluationRuns.id });
    if (run === undefined) {
      throw new Error('run insert returned no row');
    }
    await tx.insert(runJobs).values({ runId: run.id, maxAttempts: input.maxAttempts ?? 3 });
    await appendAudit(tx, {
      actor: input.actor,
      action: 'run.enqueued',
      resourceId: run.id,
      correlationId: input.correlationId,
      details: { caseCount: input.caseCount, baselineRunId: input.baselineRunId },
    });
    return run.id;
  });
}

export interface RunRecord {
  id: string;
  workspaceId: string;
  status: string;
  gateStatus: string | null;
  gateJson: unknown;
  caseCount: number;
  manifestSha: string;
  policySha: string;
  evaluatorVersion: string;
  config: unknown;
  errorCode: string | null;
  baselineRunId: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  datasetId: string;
  datasetVersion: string;
  datasetSha256: string;
  agentVersionId: string;
  agentVersion: string;
  agentSourceHash: string;
  agentAdapterKind: string;
  agentSourceCommit: string | null;
}

const runColumns = {
  id: evaluationRuns.id,
  workspaceId: evaluationRuns.workspaceId,
  status: evaluationRuns.status,
  gateStatus: evaluationRuns.gateStatus,
  gateJson: evaluationRuns.gateJson,
  caseCount: evaluationRuns.caseCount,
  manifestSha: evaluationRuns.manifestSha,
  policySha: evaluationRuns.policySha,
  evaluatorVersion: evaluationRuns.evaluatorVersion,
  config: evaluationRuns.configJson,
  errorCode: evaluationRuns.errorCode,
  baselineRunId: evaluationRuns.baselineRunId,
  createdAt: evaluationRuns.createdAt,
  startedAt: evaluationRuns.startedAt,
  finishedAt: evaluationRuns.finishedAt,
  datasetId: datasets.id,
  datasetVersion: datasets.version,
  datasetSha256: datasets.sha256,
  agentVersionId: agentVersions.id,
  agentVersion: agentVersions.version,
  agentSourceHash: agentVersions.sourceHash,
  agentAdapterKind: agentVersions.adapterKind,
  agentSourceCommit: agentVersions.sourceCommit,
};

export async function getRun(db: Executor, runId: string): Promise<RunRecord | null> {
  const [row] = await db
    .select(runColumns)
    .from(evaluationRuns)
    .innerJoin(datasets, eq(datasets.id, evaluationRuns.datasetId))
    .innerJoin(agentVersions, eq(agentVersions.id, evaluationRuns.agentVersionId))
    .where(eq(evaluationRuns.id, runId));
  return row ?? null;
}

export interface ListRunsInput {
  workspaceId: string;
  limit: number;
  status?: string | undefined;
  before?: { createdAt: Date; id: string } | undefined;
}

/** Keyset pagination on (created_at, id), newest first. */
export async function listRuns(db: Executor, input: ListRunsInput): Promise<RunRecord[]> {
  const filters = [eq(evaluationRuns.workspaceId, input.workspaceId)];
  if (input.status !== undefined) {
    filters.push(eq(evaluationRuns.status, input.status));
  }
  if (input.before !== undefined) {
    const before = input.before;
    const cursorFilter = or(
      lt(evaluationRuns.createdAt, before.createdAt),
      and(eq(evaluationRuns.createdAt, before.createdAt), lt(evaluationRuns.id, before.id)),
    );
    if (cursorFilter !== undefined) {
      filters.push(cursorFilter);
    }
  }
  return db
    .select(runColumns)
    .from(evaluationRuns)
    .innerJoin(datasets, eq(datasets.id, evaluationRuns.datasetId))
    .innerJoin(agentVersions, eq(agentVersions.id, evaluationRuns.agentVersionId))
    .where(and(...filters))
    .orderBy(desc(evaluationRuns.createdAt), desc(evaluationRuns.id))
    .limit(input.limit);
}

export class GateAlreadyRecordedError extends Error {
  readonly code = 'GATE_ALREADY_RECORDED';
  constructor(runId: string) {
    super(`gate for run ${runId} is already recorded or the run has not finished`);
    this.name = 'GateAlreadyRecordedError';
  }
}

/** Records the gate exactly once, and only for a finished run. */
export async function recordGate(
  db: Db,
  runId: string,
  gateStatus: 'PASS' | 'BLOCK' | 'ERROR',
  gateJson: unknown,
  correlationId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(evaluationRuns)
      .set({ gateStatus, gateJson })
      .where(
        and(
          eq(evaluationRuns.id, runId),
          isNull(evaluationRuns.gateStatus),
          inArray(evaluationRuns.status, ['completed', 'errored', 'cancelled']),
        ),
      )
      .returning({ id: evaluationRuns.id });
    if (updated.length !== 1) {
      throw new GateAlreadyRecordedError(runId);
    }
    await appendAudit(tx, {
      actor: 'gate',
      action: 'gate.recorded',
      resourceId: runId,
      correlationId,
      details: { gateStatus },
    });
  });
}

export async function countAuditEvents(db: Executor, resourceId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditEvents)
    .where(eq(auditEvents.resourceId, resourceId));
  return row?.count ?? 0;
}
