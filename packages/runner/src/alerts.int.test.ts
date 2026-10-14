import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@srl/db';
import { evaluateAlerts } from '@srl/telemetry';
import { loadGatedRunTimeline, openAlerts, renderIncidentReport } from './alerts.ts';
import { runDemo } from './demo.ts';

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await runDemo(testDb.handle.db, await mkdtemp(join(tmpdir(), 'srl-alerts-')), 'alerts-test');
});

afterAll(async () => {
  await testDb.drop();
});

describe('alerts over the demo timeline', () => {
  it('fires on the blocked regression with trace evidence and resolves on the repair', async () => {
    const timeline = await loadGatedRunTimeline(testDb.handle.db, 'ws_demo');
    const events = evaluateAlerts(timeline, new Date());

    expect(events.map((event) => [event.rule, event.state, event.agentVersion])).toEqual([
      ['CRITICAL_RULE_FAILURE', 'firing', 'regression-demo-v1'],
      ['CRITICAL_RULE_FAILURE', 'resolved', 'repaired-v1'],
    ]);
    expect(events[0]?.evidence).toMatchObject({ caseId: 'REF-001', ruleId: 'NO_FALSE_COMPLETION' });
    expect(events[0]?.evidence?.traceId).toMatch(/^[0-9a-f]{32}$/u);
    expect(openAlerts(events)).toEqual([]);

    const report = renderIncidentReport(events, timeline, new Date());
    expect(report).toContain('**FIRING** CRITICAL_RULE_FAILURE');
    expect(report).toContain('**RESOLVED** CRITICAL_RULE_FAILURE');
    expect(report).toContain('Open alerts: 0');
  });
});
