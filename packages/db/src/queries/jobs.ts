import { and, eq, sql } from 'drizzle-orm';
import type { Db, Executor } from '../client.ts';
import { evaluationRuns, runJobs } from '../schema.ts';
import { appendAudit } from './runs.ts';

export interface ClaimedJob {
  jobId: string;
  runId: string;
  attempts: number;
  recoveredStaleLease: boolean;
}

/**
 * Leases the oldest runnable job: queued, or leased with an expired lease (a crashed worker).
 * `FOR UPDATE SKIP LOCKED` lets concurrent workers claim different jobs without blocking.
 * A job past its attempt budget is failed and its run marked errored instead of being retried forever.
 */
export async function claimNextJob(
  db: Db,
  workerId: string,
  leaseMs: number,
): Promise<ClaimedJob | null> {
  for (;;) {
    const claim = await db.transaction(async (tx) => {
      const result = await tx.execute<{
        id: string;
        run_id: string;
        attempts: number;
        max_attempts: number;
        previous_status: string;
      }>(sql`
        with candidate as (
          select id, status as previous_status
          from run_jobs
          where status = 'queued' or (status = 'leased' and lease_expires_at < now())
          order by updated_at, id
          for update skip locked
          limit 1
        )
        update run_jobs as job
        set status = 'leased',
            worker_id = ${workerId},
            lease_expires_at = now() + make_interval(secs => ${leaseMs}::double precision / 1000),
            attempts = job.attempts + 1,
            updated_at = now()
        from candidate
        where job.id = candidate.id
        returning job.id, job.run_id, job.attempts, job.max_attempts, candidate.previous_status`);
      const row = result.rows[0];
      if (row === undefined) {
        return null;
      }

      if (row.attempts > row.max_attempts) {
        await tx
          .update(runJobs)
          .set({
            status: 'failed',
            workerId: null,
            leaseExpiresAt: null,
            lastError: 'max_attempts_exceeded',
            updatedAt: sql`now()`,
          })
          .where(eq(runJobs.id, row.id));
        await tx
          .update(evaluationRuns)
          .set({ status: 'errored', errorCode: 'max_attempts_exceeded', finishedAt: sql`now()` })
          .where(eq(evaluationRuns.id, row.run_id));
        await appendAudit(tx, {
          actor: workerId,
          action: 'run.errored',
          resourceId: row.run_id,
          correlationId: row.id,
          details: { errorCode: 'max_attempts_exceeded', attempts: row.attempts - 1 },
        });
        return { exhausted: true as const };
      }

      await tx
        .update(evaluationRuns)
        .set({ status: 'running', startedAt: sql`coalesce(${evaluationRuns.startedAt}, now())` })
        .where(
          and(
            eq(evaluationRuns.id, row.run_id),
            sql`${evaluationRuns.status} in ('queued', 'running')`,
          ),
        );
      const recovered = row.previous_status === 'leased';
      await appendAudit(tx, {
        actor: workerId,
        action: recovered ? 'job.lease_recovered' : 'job.leased',
        resourceId: row.run_id,
        correlationId: row.id,
        details: { attempts: row.attempts },
      });
      return {
        exhausted: false as const,
        job: {
          jobId: row.id,
          runId: row.run_id,
          attempts: row.attempts,
          recoveredStaleLease: recovered,
        },
      };
    });

    if (claim === null) return null;
    if (!claim.exhausted) return claim.job;
  }
}

/** Extends the lease only if this worker still holds it. Returns false once the lease is lost. */
export async function renewLease(
  db: Executor,
  jobId: string,
  workerId: string,
  leaseMs: number,
): Promise<boolean> {
  const updated = await db
    .update(runJobs)
    .set({
      leaseExpiresAt: sql`now() + make_interval(secs => ${leaseMs}::double precision / 1000)`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(runJobs.id, jobId), eq(runJobs.workerId, workerId), eq(runJobs.status, 'leased')))
    .returning({ id: runJobs.id });
  return updated.length === 1;
}

/** Returns a job to the queue after a recoverable failure, keeping the attempt count. */
export async function releaseJob(
  db: Executor,
  jobId: string,
  workerId: string,
  errorCode: string,
): Promise<void> {
  await db
    .update(runJobs)
    .set({
      status: 'queued',
      workerId: null,
      leaseExpiresAt: null,
      lastError: errorCode,
      updatedAt: sql`now()`,
    })
    .where(
      and(eq(runJobs.id, jobId), eq(runJobs.workerId, workerId), eq(runJobs.status, 'leased')),
    );
}

export interface FinishRunInput {
  jobId: string;
  runId: string;
  workerId: string;
  outcome: 'completed' | 'errored';
  errorCode: string | null;
  correlationId: string;
}

/**
 * Finishes the run and its job atomically, but only while this worker holds the lease. `completed`
 * means every case has a result; it says nothing about whether the release gate passes.
 */
export async function finishRun(db: Db, input: FinishRunInput): Promise<boolean> {
  return db.transaction(async (tx) => {
    const job = await tx
      .update(runJobs)
      .set({
        status: input.outcome === 'completed' ? 'done' : 'failed',
        leaseExpiresAt: null,
        lastError: input.errorCode,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(runJobs.id, input.jobId),
          eq(runJobs.workerId, input.workerId),
          eq(runJobs.status, 'leased'),
        ),
      )
      .returning({ id: runJobs.id });
    if (job.length !== 1) {
      return false;
    }
    await tx
      .update(evaluationRuns)
      .set({ status: input.outcome, errorCode: input.errorCode, finishedAt: sql`now()` })
      .where(and(eq(evaluationRuns.id, input.runId), eq(evaluationRuns.status, 'running')));
    await appendAudit(tx, {
      actor: input.workerId,
      action: `run.${input.outcome}`,
      resourceId: input.runId,
      correlationId: input.correlationId,
      details: { errorCode: input.errorCode },
    });
    return true;
  });
}

export async function getJobForRun(db: Executor, runId: string) {
  const [row] = await db.select().from(runJobs).where(eq(runJobs.runId, runId));
  return row ?? null;
}
