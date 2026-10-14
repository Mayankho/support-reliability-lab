import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentSourceHash, getAgent } from '@srl/agent';
import type { AgentAdapter, AgentOutput } from '@srl/contracts';
import {
  claimNextJob,
  createTestDatabase,
  getJobForRun,
  getRun,
  insertCaseResult,
  listTraceEvents,
  postgresMessage,
  runSummary,
  sql,
  type TestDatabase,
} from '@srl/db';
import { DEFAULT_RUN_CONFIG } from './execute.ts';
import { RunRequestError, enqueueRun, ensureDataset, loadVerifiedDataset } from './service.ts';
import { processClaimedJob, workOnce, type AgentResolver } from './worker.ts';

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb.drop();
});

const db = () => testDb.handle.db;

async function enqueue(agentVersion = 'reference-v1', maxConcurrency = 4): Promise<string> {
  return enqueueRun(db(), {
    datasetVersion: 'v1',
    agentVersion,
    baselineRunId: null,
    workspaceId: 'ws_demo',
    config: { ...DEFAULT_RUN_CONFIG, maxConcurrency },
    actor: 'test',
    correlationId: 'test-corr',
  });
}

async function auditActions(runId: string): Promise<string[]> {
  const rows = await db().execute<{ action: string }>(
    sql`select action from audit_events where resource_id = ${runId} order by occurred_at, id`,
  );
  return rows.rows.map((row) => row.action);
}

describe('worker happy path', () => {
  it('completes a run with one result per case and twelve rule results each', async () => {
    const runId = await enqueue();
    const outcome = await workOnce({ db: db(), workerId: 'worker-a', leaseMs: 30_000 });

    expect(outcome).toMatchObject({ runId, outcome: 'completed', storedByThisWorker: 80 });
    const run = await getRun(db(), runId);
    expect(run).toMatchObject({ status: 'completed', gateStatus: null, caseCount: 80 });
    expect(await runSummary(db(), runId)).toEqual({
      totalCases: 80,
      completedCases: 80,
      executionErrorCases: 0,
      casesWithCriticalFailures: 0,
      casesWithErrors: 0,
      ruleResultRows: 960,
    });
    expect(await auditActions(runId)).toEqual(['run.enqueued', 'job.leased', 'run.completed']);
  });

  it('stores no message text or connection details in audit, trace, or config records', async () => {
    const runId = await enqueue();
    await workOnce({ db: db(), workerId: 'worker-a', leaseMs: 30_000 });
    const audit = await db().execute(
      sql`select details_json from audit_events where resource_id = ${runId}`,
    );
    const traces = await listTraceEvents(db(), runId);
    const run = await getRun(db(), runId);
    const serialized = JSON.stringify({ audit: audit.rows, traces, config: run?.config });

    expect(traces.length).toBe(240);
    expect(serialized).not.toMatch(/postgres(ql)?:\/\//u);
    expect(serialized).not.toContain('I accidentally purchased 100 credits');
    expect(serialized).not.toContain('REF-001');
  });

  it('records regression-demo-v1 critical failures with case-level denominators', async () => {
    const runId = await enqueue('regression-demo-v1');
    await workOnce({ db: db(), workerId: 'worker-a', leaseMs: 30_000 });

    expect(await runSummary(db(), runId)).toMatchObject({
      totalCases: 80,
      casesWithCriticalFailures: 5,
    });
  });
});

describe('interruption and recovery', () => {
  it('resumes an interrupted run without duplicating results', async () => {
    const runId = await enqueue('reference-v1', 1);
    const first = await workOnce({
      db: db(),
      workerId: 'worker-a',
      leaseMs: 30_000,
      onCaseStored: (count) => {
        if (count === 30) throw new Error('simulated crash');
      },
    });
    expect(first).toMatchObject({ outcome: 'released', storedByThisWorker: 30 });
    expect((await runSummary(db(), runId)).totalCases).toBe(30);

    const second = await workOnce({ db: db(), workerId: 'worker-b', leaseMs: 30_000 });
    expect(second).toMatchObject({ runId, outcome: 'completed', storedByThisWorker: 50 });
    expect(await runSummary(db(), runId)).toMatchObject({ totalCases: 80, ruleResultRows: 960 });
    expect((await getJobForRun(db(), runId))?.attempts).toBe(2);
  });

  it('recovers a job whose worker vanished once the lease expires', async () => {
    const runId = await enqueue();
    const abandoned = await claimNextJob(db(), 'worker-gone', 150);
    expect(abandoned?.runId).toBe(runId);

    expect(await workOnce({ db: db(), workerId: 'worker-b', leaseMs: 30_000 })).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const recovered = await workOnce({ db: db(), workerId: 'worker-b', leaseMs: 30_000 });

    expect(recovered).toMatchObject({ runId, outcome: 'completed', recoveredStaleLease: true });
    expect(await auditActions(runId)).toContain('job.lease_recovered');
    expect((await runSummary(db(), runId)).totalCases).toBe(80);
  });

  it('counts each case once when the same job is delivered to two workers', async () => {
    const runId = await enqueue('reference-v1', 2);
    const job = await claimNextJob(db(), 'worker-a', 30_000);
    if (job === null) throw new Error('expected a job');

    const [a, b] = await Promise.all([
      processClaimedJob({ db: db(), workerId: 'worker-a', leaseMs: 30_000 }, job),
      processClaimedJob({ db: db(), workerId: 'worker-b', leaseMs: 30_000 }, job),
    ]);

    expect(a.storedByThisWorker + b.storedByThisWorker).toBe(80);
    expect([a.outcome, b.outcome].sort()).toEqual(['completed', 'lease_lost']);
    expect(await runSummary(db(), runId)).toMatchObject({ totalCases: 80, ruleResultRows: 960 });
  });

  it('gives up after the attempt budget and marks the run errored', async () => {
    const runId = await enqueue('reference-v1', 1);
    const crash = { onCaseStored: () => Promise.reject(new Error('always fails')) };
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect(
        await workOnce({
          db: db(),
          workerId: `worker-${String(attempt)}`,
          leaseMs: 30_000,
          ...crash,
        }),
      ).toMatchObject({
        outcome: 'released',
      });
    }
    expect(
      await workOnce({ db: db(), workerId: 'worker-4', leaseMs: 30_000, ...crash }),
    ).toBeNull();
    expect(await getRun(db(), runId)).toMatchObject({
      status: 'errored',
      errorCode: 'max_attempts_exceeded',
      gateStatus: null,
    });
    expect((await getJobForRun(db(), runId))?.status).toBe('failed');
  });
});

describe('integrity checks', () => {
  it('refuses to run when the agent code changed after the run was enqueued', async () => {
    const runId = await enqueue();
    const changed: AgentResolver = () => ({
      adapter: getAgent('reference-v1'),
      adapterKind: 'offline_deterministic',
      sourceHash: 'f'.repeat(64),
    });
    const outcome = await workOnce({
      db: db(),
      workerId: 'worker-a',
      leaseMs: 30_000,
      resolveAgent: changed,
    });

    expect(outcome).toMatchObject({
      outcome: 'errored',
      errorCode: 'agent_source_changed',
      storedByThisWorker: 0,
    });
    expect((await getRun(db(), runId))?.status).toBe('errored');
  });

  it('blocks a run when the dataset file changed under the same version', async () => {
    const dataset = await loadVerifiedDataset('v1');
    await expect(ensureDataset(db(), { ...dataset, sha256: '0'.repeat(64) })).rejects.toMatchObject(
      {
        code: 'DATASET_HASH_MISMATCH',
      },
    );
    await expect(
      enqueueRun(db(), {
        datasetVersion: 'v1',
        agentVersion: 'not-a-version',
        baselineRunId: null,
        workspaceId: 'ws_demo',
        actor: 'test',
        correlationId: 'c',
      }),
    ).rejects.toBeInstanceOf(RunRequestError);
  });

  it('counts a case with several failing rules once in the failure denominator', async () => {
    const reference = getAgent('reference-v1');
    const sabotaged: AgentAdapter = {
      version: 'reference-v1',
      invoke(input) {
        const output = reference.invoke(input) as AgentOutput;
        if (!input.message.includes('accidentally purchased 100 credits')) return output;
        return {
          ...output,
          decision: 'answer',
          route: 'technical',
          customerReply: "I've refunded your purchase.",
        };
      },
    };
    const runId = await enqueue();
    await workOnce({
      db: db(),
      workerId: 'worker-a',
      leaseMs: 30_000,
      resolveAgent: () => ({
        adapter: sabotaged,
        adapterKind: 'offline_deterministic',
        sourceHash: agentSourceHash('reference-v1'),
      }),
    });

    const failingRuleRows = await db().execute<{ count: number }>(sql`
      select count(*)::int as count from rule_results rr join case_results cr on cr.id = rr.case_result_id
      where cr.run_id = ${runId} and rr.verdict = 'fail' and rr.severity = 'critical'`);
    expect(failingRuleRows.rows[0]?.count).toBeGreaterThanOrEqual(2);
    expect((await runSummary(db(), runId)).casesWithCriticalFailures).toBe(1);
  });

  it('rejects results added after a run completed', async () => {
    const runId = await enqueue();
    await workOnce({ db: db(), workerId: 'worker-a', leaseMs: 30_000 });
    const caseRow = await db().execute<{ id: string }>(sql`select id from cases limit 1`);

    let message = '';
    try {
      await insertCaseResult(db(), {
        runId,
        caseId: caseRow.rows[0]?.id ?? '',
        status: 'pass',
        executionError: null,
        output: null,
        durationMs: 1,
        inputTokens: null,
        outputTokens: null,
        costUsd: 0,
        costSource: 'offline_zero',
        traceId: 'x',
        rules: [],
        traceSpans: [],
      });
    } catch (error) {
      message = postgresMessage(error);
    }
    expect(message).toMatch(/cannot add results to run/u);
  });
});
