import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, loadRunResults, type TestDatabase } from '@srl/db';
import { initTelemetry, type Telemetry } from '@srl/telemetry';
import { DEFAULT_RUN_CONFIG } from './execute.ts';
import { evaluateAndGate } from './report.ts';
import { enqueueRun } from './service.ts';
import { workOnce } from './worker.ts';

let testDb: TestDatabase;
let telemetry: Telemetry;

beforeAll(async () => {
  testDb = await createTestDatabase();
  telemetry = initTelemetry('memory', 'runner-test');
});

afterAll(async () => {
  await telemetry.shutdown();
  await testDb.drop();
});

describe('run tracing', () => {
  it('emits one trace per run with case, agent, grader, persist, and gate spans and no customer text', async () => {
    const runId = await enqueueRun(testDb.handle.db, {
      datasetVersion: 'v1',
      agentVersion: 'regression-demo-v1',
      baselineRunId: null,
      workspaceId: 'ws_demo',
      config: { ...DEFAULT_RUN_CONFIG, maxConcurrency: 2 },
      actor: 'test',
      correlationId: 'c',
    });
    await workOnce({ db: testDb.handle.db, workerId: 'otel-worker', leaseMs: 30_000 });
    await evaluateAndGate(testDb.handle.db, runId, await mkdtemp(join(tmpdir(), 'srl-otel-')));
    await telemetry.flush();

    const spans = telemetry.spans?.getFinishedSpans() ?? [];
    const byName = (name: string) => spans.filter((span) => span.name === name);
    const [runSpan] = byName('eval.run');
    expect(runSpan?.attributes).toMatchObject({
      'srl.run_id': runId,
      'srl.outcome': 'completed',
      'srl.agent_version': 'regression-demo-v1',
    });
    expect(byName('eval.case')).toHaveLength(80);
    expect(byName('agent.invoke')).toHaveLength(80);
    expect(byName('grader.evaluate')).toHaveLength(80);
    expect(byName('db.persist')).toHaveLength(80);
    expect(byName('gate.compute')[0]?.attributes['srl.gate_status']).toBe('BLOCK');

    const traceIds = new Set(byName('eval.case').map((span) => span.spanContext().traceId));
    expect(traceIds).toEqual(new Set([runSpan?.spanContext().traceId]));

    const stored = await loadRunResults(testDb.handle.db, runId);
    expect(new Set(stored.map((result) => result.traceId))).toEqual(traceIds);

    const serialized = JSON.stringify(spans.map((span) => span.attributes));
    expect(serialized).not.toMatch(/refund|credits|purchase|REF-0/iu);
  });
});
