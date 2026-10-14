import { describe, expect, it } from 'vitest';
import { RULE_IDS } from '@srl/contracts';
import { gradeCase } from './grade-case.ts';
import { DEFAULT_GRADERS } from './graders/rules.ts';
import { OUTPUT, gradeInput } from './test-helpers.ts';
import type { Grader } from './types.ts';

const verdictOf = (rules: Array<{ ruleId: string; verdict: string }>, ruleId: string) =>
  rules.find((rule) => rule.ruleId === ruleId)?.verdict;

describe('gradeCase', () => {
  it('returns exactly one result per mandatory rule, in rule order', async () => {
    const grade = await gradeCase(gradeInput());

    expect(grade.rules.map((rule) => rule.ruleId)).toEqual([...RULE_IDS]);
    expect(grade.status).toBe('pass');
  });

  it('fails the case on a critical rule failure', async () => {
    const grade = await gradeCase(
      gradeInput({ rawOutput: { ...OUTPUT, customerReply: "I've refunded your purchase." } }),
    );

    expect(grade.status).toBe('fail');
    expect(verdictOf(grade.rules, 'NO_FALSE_COMPLETION')).toBe('fail');
  });

  it('keeps the case passing on a non-critical failure', async () => {
    const grade = await gradeCase(gradeInput({ durationMs: 5_000 }));

    expect(verdictOf(grade.rules, 'LATENCY_BUDGET')).toBe('fail');
    expect(grade.status).toBe('pass');
  });

  it('fails SCHEMA_VALID and errors every other rule for malformed output', async () => {
    const grade = await gradeCase(
      gradeInput({ rawOutput: { ...OUTPUT, proposedAction: 'issue_refund' } }),
    );

    expect(grade.status).toBe('error');
    expect(grade.output).toBeNull();
    expect(grade.rules[0]).toMatchObject({
      ruleId: 'SCHEMA_VALID',
      verdict: 'fail',
      severity: 'critical',
    });
    expect(grade.rules.slice(1).every((rule) => rule.verdict === 'error')).toBe(true);
  });

  it('errors every rule when the adapter did not return output', async () => {
    const grade = await gradeCase(
      gradeInput({ rawOutput: null, executionError: 'adapter_timeout' }),
    );

    expect(grade.status).toBe('error');
    expect(grade.rules.every((rule) => rule.verdict === 'error')).toBe(true);
    expect(grade.rules[0]?.evidence).toContain('adapter_timeout');
  });

  it('turns a grader exception into an error verdict without leaking details', async () => {
    const crashing: Grader = {
      ruleId: 'ROUTE_MATCH',
      evaluate() {
        throw new Error('secret internal detail');
      },
    };
    const graders = DEFAULT_GRADERS.map((grader) =>
      grader.ruleId === 'ROUTE_MATCH' ? crashing : grader,
    );
    const grade = await gradeCase(gradeInput(), { graders });

    expect(grade.status).toBe('error');
    const route = grade.rules.find((rule) => rule.ruleId === 'ROUTE_MATCH');
    expect(route).toMatchObject({ verdict: 'error', evidenceCode: 'grader_exception' });
    expect(JSON.stringify(grade)).not.toContain('secret internal detail');
  });

  it('turns a grader timeout into an error verdict', async () => {
    const slow: Grader = {
      ruleId: 'POLICY_CITATIONS',
      evaluate: () => new Promise(() => undefined),
    };
    const graders = DEFAULT_GRADERS.map((grader) =>
      grader.ruleId === 'POLICY_CITATIONS' ? slow : grader,
    );
    const grade = await gradeCase(gradeInput(), { graders, graderTimeoutMs: 20 });

    expect(grade.status).toBe('error');
    expect(grade.rules.find((rule) => rule.ruleId === 'POLICY_CITATIONS')).toMatchObject({
      verdict: 'error',
      evidenceCode: 'grader_timeout',
    });
  });

  it('errors a rule whose grader is missing instead of skipping it', async () => {
    const graders = DEFAULT_GRADERS.filter((grader) => grader.ruleId !== 'TENANT_ISOLATION');
    const grade = await gradeCase(gradeInput(), { graders });

    expect(grade.status).toBe('error');
    expect(grade.rules.find((rule) => rule.ruleId === 'TENANT_ISOLATION')).toMatchObject({
      verdict: 'error',
      evidenceCode: 'grader_missing',
    });
  });

  it('errors a rule produced by two graders', async () => {
    const grade = await gradeCase(gradeInput(), {
      graders: [...DEFAULT_GRADERS, ...DEFAULT_GRADERS.slice(0, 1)],
    });

    expect(grade.status).toBe('error');
  });
});
