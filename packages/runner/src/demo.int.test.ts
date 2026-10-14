import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, getRun, recordGate, type TestDatabase } from '@srl/db';
import { gateArtifactSchema, runReportSchema } from '@srl/evals';
import { runDemo, type DemoResult } from './demo.ts';

let testDb: TestDatabase;
let outDir: string;
let result: DemoResult;

beforeAll(async () => {
  testDb = await createTestDatabase();
  outDir = await mkdtemp(join(tmpdir(), 'srl-demo-'));
  result = await runDemo(testDb.handle.db, outDir, 'demo-test');
});

afterAll(async () => {
  await testDb.drop();
});

describe('demo', () => {
  it('observes PASS, BLOCK, PASS on one dataset hash', () => {
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.steps.map((step) => [step.version, step.outcome.status])).toEqual([
      ['reference-v1', 'PASS'],
      ['regression-demo-v1', 'BLOCK'],
      ['repaired-v1', 'PASS'],
    ]);
  });

  it('blocks the regression on critical completion claims and flags them as new versus the baseline', () => {
    const regression = result.steps[1]?.outcome.gate;
    expect(regression?.blockers.filter((b) => b.startsWith('critical:'))).toEqual([
      'critical:NO_FALSE_COMPLETION:REF-001',
      'critical:NO_FALSE_COMPLETION:REF-002',
      'critical:NO_FALSE_COMPLETION:REF-003',
      'critical:NO_FALSE_COMPLETION:REF-010',
      'critical:NO_FALSE_COMPLETION:REF-011',
    ]);
    expect(
      regression?.blockers.filter((b) => b.startsWith('regression:new_critical:')),
    ).toHaveLength(5);
    expect(regression?.baselineRunId).toBe(result.steps[0]?.outcome.report.run.id);
  });

  it('writes valid gate.json, run-report.json, and HTML for every run', async () => {
    for (const step of result.steps) {
      const gate = gateArtifactSchema.parse(
        JSON.parse(await readFile(step.outcome.paths.gateJson, 'utf8')),
      );
      const report = runReportSchema.parse(
        JSON.parse(await readFile(step.outcome.paths.reportJson, 'utf8')),
      );
      const html = await readFile(step.outcome.paths.reportHtml, 'utf8');

      expect(gate.status).toBe(step.expected);
      expect(report.cases).toHaveLength(80);
      expect(html).toContain(`Run report: ${step.version}`);
      expect(html).not.toMatch(/<script/iu);
    }
    const index = await readFile(result.indexPath, 'utf8');
    expect(index).toContain('Observed PASS, BLOCK, PASS on the same frozen dataset.');
  });

  it('stores the gate on each run exactly once', async () => {
    for (const step of result.steps) {
      const run = await getRun(testDb.handle.db, step.outcome.report.run.id);
      expect(run).toMatchObject({ status: 'completed', gateStatus: step.expected });
    }
    const firstRunId = result.steps[0]?.outcome.report.run.id ?? '';
    await expect(
      recordGate(testDb.handle.db, firstRunId, 'PASS', {}, 'retry'),
    ).rejects.toMatchObject({
      code: 'GATE_ALREADY_RECORDED',
    });
  });

  it('escapes customer text in the HTML report', async () => {
    const html = await readFile(join(outDir, 'reference-v1', 'run-report.html'), 'utf8');
    expect(html).not.toContain('<script>send(customerData)</script>');
  });
});
