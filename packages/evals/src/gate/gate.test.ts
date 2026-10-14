import { describe, expect, it } from 'vitest';
import { RULE_IDS, type RuleResult } from '@srl/contracts';
import { buildRunReport, type ReportCaseInput } from '../report/build.ts';
import type { RunReport } from '../report/schema.ts';
import { ACCOUNT, EXPECTED, OUTPUT } from '../test-helpers.ts';
import { computeGate } from './gate.ts';

const SHA = (char: string) => char.repeat(64);
const NOW = new Date('2026-10-13T12:00:00.000Z');

function rules(overrides: Partial<Record<string, Partial<RuleResult>>> = {}): RuleResult[] {
  return RULE_IDS.map((ruleId) => ({
    ruleId,
    verdict: ruleId === 'RESPONSE_CONCEPTS' ? 'not_applicable' : 'pass',
    severity: 'critical',
    evidenceCode: 'ok',
    evidence: 'ok',
    evaluatorVersion: '1.0.0',
    ...overrides[ruleId],
  }));
}

function reportCase(caseId: string, overrides: Partial<ReportCaseInput> = {}): ReportCaseInput {
  return {
    caseId,
    category: 'refund_guidance',
    risk: 'critical',
    status: 'pass',
    executionError: null,
    durationMs: 1,
    costUsd: 0,
    costSource: 'offline_zero',
    traceId: 'trace',
    message: 'Synthetic message.',
    account: ACCOUNT,
    expected: EXPECTED,
    output: OUTPUT,
    rules: rules(),
    ...overrides,
  };
}

function report(cases: ReportCaseInput[], overrides: Partial<RunReport> = {}): RunReport {
  const built = buildRunReport({
    run: {
      id: 'run-candidate',
      status: 'completed',
      errorCode: null,
      startedAt: null,
      finishedAt: null,
    },
    agent: {
      version: 'reference-v1',
      sourceHash: SHA('a'),
      adapterKind: 'offline_deterministic',
      sourceCommit: null,
    },
    dataset: { version: 'v1', sha256: SHA('b'), caseCount: cases.length, reviewStatus: 'starter' },
    policy: { id: 'SYN-POLICY-1', sha256: SHA('c') },
    evaluatorVersion: '1.0.0',
    config: { caseTimeoutMs: 5000 },
    cases,
    now: NOW,
  });
  return { ...built, ...overrides };
}

const passing = () =>
  report(Array.from({ length: 20 }, (_, i) => reportCase(`TST-${String(i + 100)}`)));

describe('computeGate', () => {
  it('passes complete evidence with no failures', () => {
    const result = computeGate({ candidate: passing(), now: NOW });

    expect(result.status).toBe('PASS');
    expect(result.artifact).toMatchObject({
      status: 'PASS',
      blockers: [],
      caseCount: 20,
      denominators: { caseCount: 20, resultCount: 20, decisionScoredCases: 20 },
      metrics: { decisionAccuracy: 1, routeAccuracy: 1 },
    });
  });

  it('blocks on a single critical rule failure and names the case', () => {
    const candidate = passing();
    const failing = report([
      ...candidate.cases.slice(1).map((c) => reportCase(c.caseId)),
      reportCase('TST-100', {
        status: 'fail',
        rules: rules({
          NO_FALSE_COMPLETION: { verdict: 'fail', evidenceCode: 'affirmative_completion_language' },
        }),
      }),
    ]);
    const result = computeGate({ candidate: failing, now: NOW });

    expect(result.status).toBe('BLOCK');
    expect(result.artifact?.blockers).toEqual(['critical:NO_FALSE_COMPLETION:TST-100']);
  });

  it('errors, never passes, when any rule errored', () => {
    const cases = passing().cases.map((c) => reportCase(c.caseId));
    cases[3] = reportCase('TST-103', {
      status: 'error',
      rules: rules({ ROUTE_MATCH: { verdict: 'error', evidenceCode: 'grader_timeout' } }),
    });
    const result = computeGate({ candidate: report(cases), now: NOW });

    expect(result.status).toBe('ERROR');
    expect(result.errors).toContain('error:grader_timeout:ROUTE_MATCH:TST-103');
  });

  it('errors when results are missing for some cases', () => {
    const candidate = passing();
    const result = computeGate({
      candidate: { ...candidate, cases: candidate.cases.slice(0, 19) },
      now: NOW,
    });

    expect(result.status).toBe('ERROR');
    expect(result.errors).toContain('error:missing_results:19/20');
  });

  it('errors when a case is missing a mandatory rule result', () => {
    const candidate = passing();
    const [first, ...rest] = candidate.cases;
    const broken = {
      ...candidate,
      cases: [
        { ...first!, rules: first!.rules.filter((r) => r.ruleId !== 'TENANT_ISOLATION') },
        ...rest,
      ],
    };
    const result = computeGate({ candidate: broken, now: NOW });

    expect(result.status).toBe('ERROR');
    expect(result.errors).toContain('error:missing_rule:TENANT_ISOLATION:TST-100');
  });

  it('errors on a run that did not complete', () => {
    const result = computeGate({
      candidate: { ...passing(), run: { ...passing().run, status: 'errored' } },
      now: NOW,
    });

    expect(result.status).toBe('ERROR');
    expect(result.errors).toContain('error:run_status:errored');
  });

  it('errors on a tampered or invalid report instead of trusting it', () => {
    const tampered = JSON.parse(JSON.stringify(passing())) as {
      cases: Array<{ rules: Array<{ verdict: string }> }>;
    };
    tampered.cases[0]!.rules[0]!.verdict = 'probably_fine';

    expect(computeGate({ candidate: tampered, now: NOW })).toMatchObject({
      status: 'ERROR',
      artifact: null,
      errors: ['error:report_invalid'],
    });
    expect(computeGate({ candidate: { not: 'a report' } }).status).toBe('ERROR');
  });

  it('errors when the report was produced on a different dataset than the fixture', () => {
    const result = computeGate({
      candidate: passing(),
      expectedDataset: { version: 'v1', sha256: SHA('f') },
      now: NOW,
    });

    expect(result.status).toBe('ERROR');
    expect(result.errors).toContain('integrity:dataset_sha_mismatch');
  });

  it('blocks when decision accuracy falls below 95% even without critical failures', () => {
    const cases = passing().cases.map((c, index) =>
      reportCase(
        c.caseId,
        index < 2
          ? { rules: rules({ DECISION_MATCH: { verdict: 'fail', severity: 'high' } }) }
          : {},
      ),
    );
    const result = computeGate({ candidate: report(cases), now: NOW });

    expect(result.status).toBe('BLOCK');
    expect(result.blockers).toEqual(['threshold:decision_accuracy:18/20']);
  });

  it('blocks when a critical must-escalate case is missed', () => {
    const cases = passing().cases.map((c, index) =>
      reportCase(c.caseId, {
        expected: { ...EXPECTED, mustEscalate: index < 4 },
        ...(index === 0
          ? {
              status: 'fail',
              rules: rules({
                ESCALATION_MATCH: { verdict: 'fail', evidenceCode: 'escalation_missed' },
              }),
            }
          : {}),
      }),
    );
    const result = computeGate({ candidate: report(cases), now: NOW });

    expect(result.blockers).toContain('threshold:must_escalate_recall:3/4');
    expect(result.blockers).toContain('critical:ESCALATION_MATCH:TST-100');
  });
});

describe('computeGate with a baseline', () => {
  it('errors instead of reporting a delta when baseline and candidate used different datasets', () => {
    const baseline = {
      ...passing(),
      run: { ...passing().run, id: 'run-baseline' },
      dataset: { ...passing().dataset, sha256: SHA('d') },
    };
    const result = computeGate({ candidate: passing(), baseline, now: NOW });

    expect(result.status).toBe('ERROR');
    expect(result.errors).toContain('incompatible_baseline:dataset_sha');
    expect(result.comparison?.compatible).toBe(false);
  });

  it('flags a critical failure that the baseline did not have as a regression', () => {
    const baseline = { ...passing(), run: { ...passing().run, id: 'run-baseline' } };
    const cases = passing().cases.map((c, index) =>
      reportCase(
        c.caseId,
        index === 5
          ? { status: 'fail', rules: rules({ NO_FALSE_COMPLETION: { verdict: 'fail' } }) }
          : {},
      ),
    );
    const result = computeGate({ candidate: report(cases), baseline, now: NOW });

    expect(result.status).toBe('BLOCK');
    expect(result.blockers).toEqual([
      'critical:NO_FALSE_COMPLETION:TST-105',
      'regression:new_critical:NO_FALSE_COMPLETION:TST-105',
    ]);
    expect(result.artifact?.baselineRunId).toBe('run-baseline');
  });

  it('lists a case the candidate fixed relative to a failing baseline', () => {
    const failingBaseline = report(
      passing().cases.map((c, index) =>
        reportCase(
          c.caseId,
          index === 5
            ? { status: 'fail', rules: rules({ NO_FALSE_COMPLETION: { verdict: 'fail' } }) }
            : {},
        ),
      ),
      { run: { ...passing().run, id: 'run-baseline' } },
    );
    const result = computeGate({ candidate: passing(), baseline: failingBaseline, now: NOW });

    expect(result.status).toBe('PASS');
    expect(result.comparison?.fixedCases).toEqual(['TST-105']);
  });

  it('errors when the baseline itself has incomplete evidence', () => {
    const incomplete = {
      ...passing(),
      run: { ...passing().run, id: 'run-baseline', status: 'errored' as const },
    };
    const result = computeGate({ candidate: passing(), baseline: incomplete, now: NOW });

    expect(result.status).toBe('ERROR');
    expect(result.errors).toContain('incompatible_baseline:baseline_incomplete');
  });

  it('passes a repaired candidate against a clean baseline and records the comparison', () => {
    const baseline = { ...passing(), run: { ...passing().run, id: 'run-baseline' } };
    const result = computeGate({ candidate: passing(), baseline, now: NOW });

    expect(result.status).toBe('PASS');
    expect(result.warnings).toContain('latency_not_comparable_below_floor');
    expect(result.comparison).toMatchObject({
      compatible: true,
      newCriticalFailures: [],
      fixedCases: [],
    });
  });

  it('blocks a p95 latency regression when timings are above the noise floor', () => {
    const slowBaseline = report(
      passing().cases.map((c) => reportCase(c.caseId, { durationMs: 20 })),
      {
        run: { ...passing().run, id: 'run-baseline' },
      },
    );
    const slower = report(passing().cases.map((c) => reportCase(c.caseId, { durationMs: 40 })));
    const result = computeGate({ candidate: slower, baseline: slowBaseline, now: NOW });

    expect(result.blockers).toEqual(['regression:p95_latency:2.00x']);
  });
});
