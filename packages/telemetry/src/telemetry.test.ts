import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { evaluateAlerts, type GatedRun } from './alerts.ts';
import { recordCaseResult, recordGateOutcome, recordRunFinished } from './instruments.ts';
import { createLogger } from './logger.ts';
import { initTelemetry, recordingTraceId, startChildSpan, type Telemetry } from './otel.ts';

describe('logger redaction', () => {
  it('censors credentials, connection strings, and customer text but keeps IDs', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const logger = createLogger('test', 'info', sink);
    logger.info(
      {
        runId: 'run-1',
        config: { databaseUrl: 'postgresql://app:s3cret@db/x' },
        case: { input: { message: 'My card ends 4242' }, customerReply: 'secret reply' },
        req: { headers: { authorization: 'Bearer abc' } },
      },
      'case stored',
    );
    const output = lines.join('');

    expect(output).toContain('run-1');
    expect(output).not.toMatch(/s3cret|4242|secret reply|Bearer abc/u);
    expect(output).toContain('[redacted]');
  });
});

describe('OpenTelemetry wiring', () => {
  let telemetry: Telemetry | null = null;

  afterEach(async () => {
    await telemetry?.shutdown();
    telemetry = null;
  });

  it('is a no-op when disabled', () => {
    telemetry = initTelemetry('none', 'test');
    const span = startChildSpan('eval.run', null);
    span.end();

    expect(recordingTraceId(span)).toBeNull();
    expect(telemetry.spans).toBeNull();
  });

  it('records parent and child spans with bounded attributes', async () => {
    telemetry = initTelemetry('memory', 'test');
    const run = startChildSpan('eval.run', null, { 'srl.run_id': 'run-1' });
    const evalCase = startChildSpan('eval.case', run, { 'srl.case_hash': 'abc' });
    evalCase.end();
    run.end();
    await telemetry.flush();

    const spans = telemetry.spans?.getFinishedSpans() ?? [];
    expect(spans.map((span) => span.name)).toEqual(['eval.case', 'eval.run']);
    expect(spans[0]?.parentSpanContext?.spanId).toBe(run.spanContext().spanId);
    expect(recordingTraceId(run)).toMatch(/^[0-9a-f]{32}$/u);
  });

  it('exports counters with closed label sets', async () => {
    telemetry = initTelemetry('memory', 'test');
    recordRunFinished('completed');
    recordRunFinished('weird-status');
    recordCaseResult({
      status: 'fail',
      risk: 'critical',
      durationMs: 1.2,
      failedRules: [{ ruleId: 'NO_FALSE_COMPLETION', severity: 'critical' }],
      costUsd: 0,
      costKnown: false,
    });
    recordGateOutcome('BLOCK', [
      'critical:NO_FALSE_COMPLETION:REF-001',
      'regression:new_critical:X:Y',
    ]);
    await telemetry.flush();

    const exported = telemetry.metricExporter?.getMetrics() ?? [];
    const points = exported.flatMap((resource) =>
      resource.scopeMetrics.flatMap((scope) =>
        scope.metrics.flatMap((metric) =>
          metric.dataPoints.map((point) => ({
            name: metric.descriptor.name,
            attributes: point.attributes,
          })),
        ),
      ),
    );
    const runs = points
      .filter((point) => point.name === 'eval_runs_total')
      .map((point) => point.attributes.status);
    expect(runs.sort()).toEqual(['completed', 'other']);
    expect(points.find((point) => point.name === 'eval_rule_failures_total')?.attributes).toEqual({
      rule_id: 'NO_FALSE_COMPLETION',
      severity: 'critical',
    });
    expect(
      points
        .filter((point) => point.name === 'eval_gate_blocked_total')
        .map((p) => p.attributes.reason_category)
        .sort(),
    ).toEqual(['critical', 'regression']);
    expect(points.some((point) => point.name === 'agent_estimated_cost_usd')).toBe(false);
  });
});

describe('evaluateAlerts', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 13, 12, minute));
  const run = (overrides: Partial<GatedRun>): GatedRun => ({
    runId: 'r',
    agentVersion: 'reference-v1',
    status: 'completed',
    gateStatus: 'PASS',
    createdAt: at(0),
    baselineRunId: null,
    criticalFailureCases: 0,
    blockers: [],
    latencyRatio: null,
    firstFailingCase: null,
    ...overrides,
  });

  it('fires on a blocked candidate and resolves when the repair passes', () => {
    const events = evaluateAlerts(
      [
        run({ runId: 'ref', createdAt: at(0) }),
        run({
          runId: 'bad',
          agentVersion: 'regression-demo-v1',
          gateStatus: 'BLOCK',
          createdAt: at(1),
          baselineRunId: 'ref',
          criticalFailureCases: 5,
          blockers: ['critical:NO_FALSE_COMPLETION:REF-001'],
          firstFailingCase: { caseId: 'REF-001', traceId: 'abc', ruleId: 'NO_FALSE_COMPLETION' },
        }),
        run({
          runId: 'fixed',
          agentVersion: 'repaired-v1',
          createdAt: at(2),
          baselineRunId: 'ref',
        }),
      ],
      at(5),
    );

    expect(events.map((event) => [event.rule, event.state, event.runId])).toEqual([
      ['CRITICAL_RULE_FAILURE', 'firing', 'bad'],
      ['CRITICAL_RULE_FAILURE', 'resolved', 'fixed'],
    ]);
    expect(events[0]?.evidence).toEqual({
      caseId: 'REF-001',
      traceId: 'abc',
      ruleId: 'NO_FALSE_COMPLETION',
    });
  });

  it('flags a missing or stale reference evaluation', () => {
    expect(evaluateAlerts([], at(0)).map((event) => event.rule)).toEqual(['EVAL_STALE_OR_MISSING']);
    const stale = evaluateAlerts(
      [run({ createdAt: at(0) })],
      new Date(at(0).getTime() + 25 * 3_600_000),
    );
    expect(stale.map((event) => event.rule)).toEqual(['EVAL_STALE_OR_MISSING']);
  });

  it('fires on an error spike and on a comparable latency regression', () => {
    const errored = [1, 2, 3].map((minute) =>
      run({
        runId: `e${String(minute)}`,
        status: 'errored',
        gateStatus: 'ERROR',
        createdAt: at(minute),
      }),
    );
    expect(evaluateAlerts([run({}), ...errored], at(10)).map((event) => event.rule)).toContain(
      'RUN_ERROR_SPIKE',
    );

    const slow = run({ runId: 'slow', baselineRunId: 'ref', latencyRatio: 1.8, createdAt: at(1) });
    expect(evaluateAlerts([run({}), slow], at(5)).map((event) => event.rule)).toContain(
      'LATENCY_REGRESSION',
    );
  });
});
