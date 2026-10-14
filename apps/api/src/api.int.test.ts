import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  connect,
  createRun,
  createTestDatabase,
  getRun,
  importDataset,
  registerAgentVersion,
  sql,
  type TestDatabase,
} from '@srl/db';
import { enqueueRun, evaluateAndGate, loadVerifiedDataset, runUntilFinished } from '@srl/runner';
import { buildApp } from './app.ts';
import { jwtPrincipal } from './auth.ts';
import { loadConfig } from './config.ts';
import {
  DEV_AUDIENCE,
  DEV_ISSUER,
  generateDevKeyPair,
  signDevToken,
  type DevKeyPair,
} from './dev-auth.ts';
import { createRateLimiter } from './rate-limit.ts';

const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://app:app@localhost:5432/support_reliability',
  LOG_LEVEL: 'silent',
});

let testDb: TestDatabase;
let app: FastifyInstance;
let artifacts: string;
const ids = { reference: '', regression: '', ungated: '', queued: '', other: '', foreign: '' };

async function processAndGate(runId: string, baseline?: unknown) {
  await runUntilFinished({ db: testDb.handle.db, workerId: 'api-test', leaseMs: 30_000 }, runId);
  return evaluateAndGate(testDb.handle.db, runId, join(artifacts, runId), baseline);
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  artifacts = await mkdtemp(join(tmpdir(), 'srl-api-'));
  app = buildApp(config, {
    logger: false,
    database: testDb.handle,
    rateLimiter: createRateLimiter(100, 60_000),
  });

  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/evaluation-runs',
    payload: { datasetVersion: 'v1', agentVersion: 'reference-v1', runMode: 'offline' },
  });
  ids.reference = (created.json() as { runId: string }).runId;
  const reference = await processAndGate(ids.reference);

  const regression = await app.inject({
    method: 'POST',
    url: '/api/v1/evaluation-runs',
    payload: {
      datasetVersion: 'v1',
      agentVersion: 'regression-demo-v1',
      baselineRunId: ids.reference,
      runMode: 'offline',
    },
  });
  ids.regression = (regression.json() as { runId: string }).runId;
  await processAndGate(ids.regression, reference.report);

  ids.ungated = await enqueueRun(testDb.handle.db, {
    datasetVersion: 'v1',
    agentVersion: 'repaired-v1',
    baselineRunId: null,
    workspaceId: 'ws_demo',
    actor: 'test',
    correlationId: 'c',
  });
  await runUntilFinished(
    { db: testDb.handle.db, workerId: 'api-test', leaseMs: 30_000 },
    ids.ungated,
  );

  ids.other = await enqueueRun(testDb.handle.db, {
    datasetVersion: 'v1',
    agentVersion: 'reference-v1',
    baselineRunId: null,
    workspaceId: 'ws_other',
    actor: 'test',
    correlationId: 'c',
  });

  const foreignDataset = await importDataset(testDb.handle.db, {
    version: 'v0',
    sha256: 'e'.repeat(64),
    policyVersion: 'SYN-POLICY-1',
    policySha256: (await loadVerifiedDataset('v1')).policy.sha256,
    reviewStatus: 'starter_labels_not_independently_adjudicated',
    manifest: {},
    cases: (await loadVerifiedDataset('v1')).cases.slice(0, 1),
  });
  const agentVersionId = await registerAgentVersion(testDb.handle.db, {
    version: 'reference-v1',
    sourceHash: 'd'.repeat(64),
    policyHash: 'b'.repeat(64),
    adapterKind: 'offline_deterministic',
    sourceCommit: null,
    description: 'foreign',
  });
  ids.foreign = await createRun(testDb.handle.db, {
    workspaceId: 'ws_demo',
    datasetId: foreignDataset.id,
    agentVersionId,
    baselineRunId: null,
    caseCount: 1,
    manifestSha: 'e'.repeat(64),
    policySha: 'b'.repeat(64),
    evaluatorVersion: '1.0.0',
    config: { caseTimeoutMs: 5000, latencyBudgetMs: 250, graderTimeoutMs: 1000, maxConcurrency: 1 },
    actor: 'test',
    correlationId: 'c',
  });
  await testDb.handle.db.execute(
    sql`update evaluation_runs set status = 'running' where id = ${ids.foreign}`,
  );
  await testDb.handle.db.execute(
    sql`update evaluation_runs set status = 'completed', finished_at = now() where id = ${ids.foreign}`,
  );

  ids.queued = (
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/evaluation-runs',
        payload: { datasetVersion: 'v1', agentVersion: 'reference-v1', runMode: 'offline' },
      })
    ).json() as { runId: string }
  ).runId;
});

afterAll(async () => {
  await app.close();
  await testDb.drop();
});

const errorBody = (response: { json: () => unknown }) =>
  response.json() as { code: string; message: string; correlationId: string };

describe('health', () => {
  it('reports liveness and readiness', async () => {
    expect((await app.inject('/health/live')).json()).toEqual({ status: 'ok' });
    const ready = await app.inject('/health/ready');
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ready', checks: { database: 'ok', dataset: 'ok' } });
  });

  it('reports not ready when the database is missing or unreachable', async () => {
    const noDb = buildApp(config, { logger: false });
    const unreachable = connect('postgresql://app:app@127.0.0.1:1/nowhere');
    const badDb = buildApp(config, { logger: false, database: unreachable });
    try {
      expect((await noDb.inject('/health/ready')).json()).toMatchObject({
        status: 'not_ready',
        checks: { database: 'not_configured' },
      });
      const response = await badDb.inject('/health/ready');
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ checks: { database: 'unavailable' } });
    } finally {
      await noDb.close();
      await badDb.close();
      await unreachable.close();
    }
  });
});

describe('datasets', () => {
  it('lists stored dataset manifests', async () => {
    const response = await app.inject('/api/v1/datasets');
    const body = response.json() as {
      items: Array<{ version: string; sha256: string; caseCount: number }>;
    };
    expect(response.statusCode).toBe(200);
    expect(body.items.find((item) => item.version === 'v1')).toMatchObject({
      sha256: 'e02ae60e86b80da3866098c0d731630d4e199cb11ebf40d78caa508f58e4cf1d',
      caseCount: 80,
    });
  });
});

describe('POST /api/v1/evaluation-runs', () => {
  it('enqueues and returns 202 with a location, not a result', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/evaluation-runs',
      payload: {
        datasetVersion: 'v1',
        agentVersion: 'repaired-v1',
        runMode: 'offline',
        maxConcurrency: 2,
      },
    });
    expect(response.statusCode).toBe(202);
    const body = response.json() as { runId: string; status: string };
    expect(body.status).toBe('queued');
    expect(response.headers.location).toBe(`/api/v1/evaluation-runs/${body.runId}`);
  });

  it.each([
    [{ datasetVersion: 'v1', agentVersion: 'reference-v1' }, 'runMode'],
    [{ datasetVersion: 'v1', agentVersion: 'reference-v1', runMode: 'online' }, 'runMode'],
    [
      { datasetVersion: 'v1', agentVersion: 'reference-v1', runMode: 'offline', extra: true },
      '(root)',
    ],
    [
      { datasetVersion: '../v1', agentVersion: 'reference-v1', runMode: 'offline' },
      'datasetVersion',
    ],
    [
      {
        datasetVersion: 'v1',
        agentVersion: 'reference-v1',
        runMode: 'offline',
        maxConcurrency: 50,
      },
      'maxConcurrency',
    ],
  ])('returns 422 for an invalid body %#', async (payload, field) => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/evaluation-runs', payload });
    expect(response.statusCode).toBe(422);
    expect(errorBody(response)).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(errorBody(response).message).toContain(field);
  });

  it('returns 422 for an unknown agent version or dataset version', async () => {
    for (const payload of [
      { datasetVersion: 'v1', agentVersion: 'not-real', runMode: 'offline' },
      { datasetVersion: 'v9', agentVersion: 'reference-v1', runMode: 'offline' },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/evaluation-runs',
        payload,
      });
      expect(response.statusCode).toBe(422);
    }
  });

  it('returns 400 for malformed JSON, 415 for other media types, 413 for oversized bodies', async () => {
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/v1/evaluation-runs',
      headers: { 'content-type': 'application/json' },
      payload: '{"datasetVersion": ',
    });
    expect(malformed.statusCode).toBe(400);
    expect(errorBody(malformed).code).toBe('BAD_REQUEST');

    const text = await app.inject({
      method: 'POST',
      url: '/api/v1/evaluation-runs',
      headers: { 'content-type': 'text/plain' },
      payload: 'hello',
    });
    expect(text.statusCode).toBe(415);

    const big = await app.inject({
      method: 'POST',
      url: '/api/v1/evaluation-runs',
      payload: {
        datasetVersion: 'v1',
        agentVersion: 'reference-v1',
        runMode: 'offline',
        pad: 'x'.repeat(20_000),
      },
    });
    expect(big.statusCode).toBe(413);
  });

  it('returns 404 for an unknown baseline and 409 for a baseline on a different dataset', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/evaluation-runs',
      payload: {
        datasetVersion: 'v1',
        agentVersion: 'reference-v1',
        runMode: 'offline',
        baselineRunId: '00000000-0000-4000-8000-000000000000',
      },
    });
    expect(missing.statusCode).toBe(404);

    const foreign = await app.inject({
      method: 'POST',
      url: '/api/v1/evaluation-runs',
      payload: {
        datasetVersion: 'v1',
        agentVersion: 'reference-v1',
        runMode: 'offline',
        baselineRunId: ids.foreign,
      },
    });
    expect(foreign.statusCode).toBe(409);
    expect(errorBody(foreign).code).toBe('INCOMPATIBLE_RUNS');
  });

  it('rate-limits run creation per workspace with 429', async () => {
    const limited = buildApp(config, {
      logger: false,
      database: testDb.handle,
      rateLimiter: createRateLimiter(1, 60_000),
    });
    try {
      const payload = { datasetVersion: 'v1', agentVersion: 'reference-v1', runMode: 'offline' };
      expect(
        (await limited.inject({ method: 'POST', url: '/api/v1/evaluation-runs', payload }))
          .statusCode,
      ).toBe(202);
      const second = await limited.inject({
        method: 'POST',
        url: '/api/v1/evaluation-runs',
        payload,
      });
      expect(second.statusCode).toBe(429);
      expect(errorBody(second).code).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });
});

describe('GET /api/v1/evaluation-runs', () => {
  it('lists only runs in the caller workspace, newest first, with cursor pagination', async () => {
    const first = await app.inject('/api/v1/evaluation-runs?limit=2');
    const page1 = first.json() as { items: Array<{ id: string }>; nextCursor: string | null };
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const second = await app.inject(
      `/api/v1/evaluation-runs?limit=2&cursor=${page1.nextCursor ?? ''}`,
    );
    const page2 = second.json() as { items: Array<{ id: string }> };
    expect(page2.items.map((item) => item.id)).not.toContain(page1.items[0]?.id);

    const all = (await app.inject('/api/v1/evaluation-runs?limit=100')).json() as {
      items: Array<{ id: string }>;
    };
    expect(all.items.map((item) => item.id)).toContain(ids.reference);
    expect(all.items.map((item) => item.id)).not.toContain(ids.other);
  });

  it('filters by status and rejects bad cursors or filters with 422', async () => {
    const queued = (await app.inject('/api/v1/evaluation-runs?status=queued&limit=100')).json() as {
      items: Array<{ status: string }>;
    };
    expect(queued.items.every((item) => item.status === 'queued')).toBe(true);
    expect((await app.inject('/api/v1/evaluation-runs?cursor=not-a-cursor')).statusCode).toBe(422);
    expect((await app.inject('/api/v1/evaluation-runs?status=done')).statusCode).toBe(422);
    expect((await app.inject('/api/v1/evaluation-runs?limit=1000')).statusCode).toBe(422);
  });
});

describe('GET /api/v1/evaluation-runs/:runId', () => {
  it('returns provenance, case-level denominators, and metrics for a completed run', async () => {
    const response = await app.inject(`/api/v1/evaluation-runs/${ids.regression}`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: ids.regression,
      status: 'completed',
      gateStatus: 'BLOCK',
      agent: { version: 'regression-demo-v1', adapterKind: 'offline_deterministic' },
      dataset: { version: 'v1', caseCount: 80 },
      summary: { totalCases: 80, casesWithCriticalFailures: 5, ruleResultRows: 960 },
      metrics: { decisionAccuracy: { numerator: 80, denominator: 80 } },
    });
  });

  it('returns the same 404 for a missing, malformed, or other-workspace run', async () => {
    for (const id of ['00000000-0000-4000-8000-000000000000', 'abc', ids.other]) {
      const response = await app.inject(`/api/v1/evaluation-runs/${id}`);
      expect(response.statusCode).toBe(404);
      expect(errorBody(response)).toMatchObject({
        code: 'NOT_FOUND',
        message: 'Resource not found.',
      });
    }
  });
});

describe('gate and comparison', () => {
  it('returns the recorded gate artifact', async () => {
    const pass = (await app.inject(`/api/v1/evaluation-runs/${ids.reference}/gate`)).json() as {
      status: string;
      blockers: string[];
    };
    const block = (await app.inject(`/api/v1/evaluation-runs/${ids.regression}/gate`)).json() as {
      status: string;
      blockers: string[];
    };
    expect(pass).toMatchObject({ status: 'PASS', blockers: [] });
    expect(block.status).toBe('BLOCK');
    expect(block.blockers).toContain('critical:NO_FALSE_COMPLETION:REF-001');
  });

  it('returns 409 when the run has not finished or has no recorded gate', async () => {
    const queued = await app.inject(`/api/v1/evaluation-runs/${ids.queued}/gate`);
    expect(queued.statusCode).toBe(409);
    expect(errorBody(queued).code).toBe('RUN_NOT_FINISHED');
    const ungated = await app.inject(`/api/v1/evaluation-runs/${ids.ungated}/gate`);
    expect(errorBody(ungated).code).toBe('GATE_NOT_RECORDED');
  });

  it('compares compatible runs case by case', async () => {
    const response = await app.inject(
      `/api/v1/evaluation-runs/${ids.regression}/compare?baselineRunId=${ids.reference}`,
    );
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      compatible: boolean;
      newCriticalFailures: Array<{ caseId: string }>;
    };
    expect(body.compatible).toBe(true);
    expect(body.newCriticalFailures.map((failure) => failure.caseId)).toEqual([
      'REF-001',
      'REF-002',
      'REF-003',
      'REF-010',
      'REF-011',
    ]);
  });

  it('returns 409 instead of a delta for runs on different datasets, and 404 or 422 for bad baselines', async () => {
    const incompatible = await app.inject(
      `/api/v1/evaluation-runs/${ids.reference}/compare?baselineRunId=${ids.foreign}`,
    );
    expect(incompatible.statusCode).toBe(409);
    expect(errorBody(incompatible).code).toBe('INCOMPATIBLE_RUNS');
    expect(errorBody(incompatible).message).toContain('dataset_sha');

    expect(
      (
        await app.inject(
          `/api/v1/evaluation-runs/${ids.reference}/compare?baselineRunId=${ids.other}`,
        )
      ).statusCode,
    ).toBe(404);
    expect((await app.inject(`/api/v1/evaluation-runs/${ids.reference}/compare`)).statusCode).toBe(
      422,
    );
    expect(
      (
        await app.inject(
          `/api/v1/evaluation-runs/${ids.reference}/compare?baselineRunId=${ids.queued}`,
        )
      ).statusCode,
    ).toBe(409);
  });
});

describe('case results', () => {
  it('pages through case results and filters by status, rule, and verdict', async () => {
    const all = (
      await app.inject(`/api/v1/evaluation-runs/${ids.regression}/cases?limit=100`)
    ).json() as { total: number };
    expect(all.total).toBe(80);

    const failed = (
      await app.inject(`/api/v1/evaluation-runs/${ids.regression}/cases?status=fail&limit=100`)
    ).json() as {
      items: Array<{ caseId: string; failingRules: Array<{ ruleId: string }> }>;
    };
    expect(failed.items.map((item) => item.caseId)).toEqual([
      'REF-001',
      'REF-002',
      'REF-003',
      'REF-010',
      'REF-011',
    ]);
    expect(failed.items[0]?.failingRules).toEqual([
      { ruleId: 'NO_FALSE_COMPLETION', verdict: 'fail', severity: 'critical' },
    ]);

    const byRule = (
      await app.inject(
        `/api/v1/evaluation-runs/${ids.regression}/cases?rule=NO_FALSE_COMPLETION&verdict=fail&limit=2`,
      )
    ).json() as {
      items: unknown[];
      total: number;
      nextCursor: string | null;
    };
    expect(byRule).toMatchObject({ total: 5 });
    expect(byRule.items).toHaveLength(2);
    const next = (
      await app.inject(
        `/api/v1/evaluation-runs/${ids.regression}/cases?rule=NO_FALSE_COMPLETION&verdict=fail&limit=2&cursor=${byRule.nextCursor ?? ''}`,
      )
    ).json() as { items: Array<{ caseId: string }> };
    expect(next.items.map((item) => item.caseId)).toEqual(['REF-003', 'REF-010']);

    expect(
      (await app.inject(`/api/v1/evaluation-runs/${ids.regression}/cases?rule=NOT_A_RULE`))
        .statusCode,
    ).toBe(422);
  });

  it('returns sanitized case evidence with traces and without gold labels', async () => {
    const response = await app.inject(`/api/v1/evaluation-runs/${ids.regression}/cases/REF-001`);
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown> & {
      output: { customerReply: string };
      rules: unknown[];
      trace: Array<{ kind: string }>;
      suggestedFixLayers: string[];
    };
    expect(body.output.customerReply).toContain("I've refunded");
    expect(body.rules).toHaveLength(12);
    expect(body.trace.map((event) => event.kind)).toEqual([
      'eval.case',
      'agent.invoke',
      'grader.evaluate',
    ]);
    expect(body.suggestedFixLayers).toEqual(['prompt']);
    expect(body).not.toHaveProperty('expected');
    expect(JSON.stringify(body)).not.toMatch(/rationale|forbiddenClaims|mustEscalate/u);
  });

  it('returns 404 for unknown or malformed case IDs and for another workspace', async () => {
    expect(
      (await app.inject(`/api/v1/evaluation-runs/${ids.regression}/cases/ZZZ-999`)).statusCode,
    ).toBe(404);
    expect(
      (await app.inject(`/api/v1/evaluation-runs/${ids.regression}/cases/ref-001`)).statusCode,
    ).toBe(404);
    expect((await app.inject(`/api/v1/evaluation-runs/${ids.other}/cases`)).statusCode).toBe(404);
  });
});

describe('metrics summary', () => {
  it('reports workspace aggregates with distinct-case denominators', async () => {
    const response = await app.inject('/api/v1/metrics/summary');
    const body = response.json() as {
      runsByStatus: Record<string, number>;
      latestByAgentVersion: Array<{
        agentVersion: string;
        caseCount: number;
        casesWithCriticalFailures: number;
      }>;
    };
    expect(response.statusCode).toBe(200);
    expect(body.runsByStatus.completed).toBeGreaterThanOrEqual(3);
    expect(
      body.latestByAgentVersion.find((row) => row.agentVersion === 'regression-demo-v1'),
    ).toMatchObject({
      caseCount: 80,
      casesWithCriticalFailures: 5,
    });
  });
});

describe('JWT-scoped access to real data', () => {
  let secured: FastifyInstance;
  let pair: DevKeyPair;
  const bearer = async (workspaceId: string, role: 'viewer' | 'reviewer') => ({
    authorization: `Bearer ${await signDevToken(pair.privateJwk, { subject: `${role}-${workspaceId}`, workspaceId, role })}`,
  });

  beforeAll(async () => {
    pair = await generateDevKeyPair();
    secured = buildApp(config, {
      logger: false,
      database: testDb.handle,
      resolvePrincipal: jwtPrincipal({
        issuer: DEV_ISSUER,
        audience: DEV_AUDIENCE,
        jwks: pair.jwks,
      }),
    });
  });

  afterAll(async () => {
    await secured.close();
  });

  it('scopes reads to the workspace in the verified token', async () => {
    const demo = (
      await secured.inject({
        url: '/api/v1/evaluation-runs?limit=100',
        headers: await bearer('ws_demo', 'viewer'),
      })
    ).json() as {
      items: Array<{ id: string }>;
    };
    const other = (
      await secured.inject({
        url: '/api/v1/evaluation-runs?limit=100',
        headers: await bearer('ws_other', 'viewer'),
      })
    ).json() as {
      items: Array<{ id: string }>;
    };
    expect(demo.items.map((item) => item.id)).toContain(ids.reference);
    expect(other.items.map((item) => item.id)).toEqual([ids.other]);
  });

  it('returns 404, not 403, for another workspace’s run, case, gate, or comparison', async () => {
    const headers = await bearer('ws_other', 'reviewer');
    for (const url of [
      `/api/v1/evaluation-runs/${ids.regression}`,
      `/api/v1/evaluation-runs/${ids.regression}/cases`,
      `/api/v1/evaluation-runs/${ids.regression}/cases/REF-001`,
      `/api/v1/evaluation-runs/${ids.regression}/gate`,
      `/api/v1/evaluation-runs/${ids.regression}/compare?baselineRunId=${ids.reference}`,
    ]) {
      const response = await secured.inject({ url, headers });
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain(ids.regression);
    }
  });

  it('shows expected values only to an authenticated reviewer', async () => {
    const asReviewer = (
      await secured.inject({
        url: `/api/v1/evaluation-runs/${ids.regression}/cases/REF-001`,
        headers: await bearer('ws_demo', 'reviewer'),
      })
    ).json() as { expected?: { decision: string; proposedAction: string } };
    const asViewer = (
      await secured.inject({
        url: `/api/v1/evaluation-runs/${ids.regression}/cases/REF-001`,
        headers: await bearer('ws_demo', 'viewer'),
      })
    ).json() as Record<string, unknown>;
    const local = (
      await app.inject(`/api/v1/evaluation-runs/${ids.regression}/cases/REF-001`)
    ).json() as Record<string, unknown>;

    expect(asReviewer.expected).toMatchObject({
      decision: 'propose_action',
      proposedAction: 'request_refund_review',
    });
    expect(asViewer).not.toHaveProperty('expected');
    expect(local).not.toHaveProperty('expected');
  });

  it('enqueues runs into the token workspace, never one named in the body', async () => {
    const response = await secured.inject({
      method: 'POST',
      url: '/api/v1/evaluation-runs',
      headers: await bearer('ws_other', 'reviewer'),
      payload: { datasetVersion: 'v1', agentVersion: 'reference-v1', runMode: 'offline' },
    });
    const { runId } = response.json() as { runId: string };
    const run = await getRun(testDb.handle.db, runId);
    expect(response.statusCode).toBe(202);
    expect(run?.workspaceId).toBe('ws_other');
  });
});

describe('errors and correlation', () => {
  it('uses one error shape, echoes safe correlation IDs, and replaces unsafe ones', async () => {
    const unknown = await app.inject({
      url: '/api/v1/nope',
      headers: { 'x-correlation-id': 'req-123' },
    });
    expect(unknown.statusCode).toBe(404);
    expect(errorBody(unknown)).toEqual({
      code: 'NOT_FOUND',
      message: 'Resource not found.',
      correlationId: 'req-123',
    });
    expect(unknown.headers['x-correlation-id']).toBe('req-123');

    const unsafe = await app.inject({
      url: '/api/v1/nope',
      headers: { 'x-correlation-id': 'bad value <script>' },
    });
    expect(errorBody(unsafe).correlationId).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('returns 500 without internal details when the database fails mid-request', async () => {
    const unreachable = connect('postgresql://app:secretpw@127.0.0.1:1/nowhere');
    const broken = buildApp(config, { logger: false, database: unreachable });
    try {
      const response = await broken.inject('/api/v1/datasets');
      expect(response.statusCode).toBe(500);
      expect(errorBody(response)).toMatchObject({ code: 'INTERNAL', message: 'Internal error.' });
      expect(response.body).not.toMatch(/secretpw|ECONNREFUSED|stack|at /u);
    } finally {
      await broken.close();
      await unreachable.close();
    }
  });
});
