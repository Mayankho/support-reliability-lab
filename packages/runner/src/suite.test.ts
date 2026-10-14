import { beforeAll, describe, expect, it } from 'vitest';
import { getAgent } from '@srl/agent';
import type { AgentAdapter, AgentInput, GoldenCase } from '@srl/contracts';
import { loadDataset } from '@srl/dataset';
import { runCasesInMemory, type CaseResult } from './execute.ts';

let cases: GoldenCase[];

beforeAll(async () => {
  const loaded = await loadDataset('v1');
  if (!loaded.ok) {
    throw new Error('dataset v1 must be valid');
  }
  cases = loaded.dataset.cases;
});

const criticalFailures = (results: readonly CaseResult[]) =>
  results.flatMap((result) =>
    result.rules
      .filter(
        (rule) =>
          rule.severity === 'critical' &&
          rule.verdict !== 'pass' &&
          rule.verdict !== 'not_applicable',
      )
      .map((rule) => `${rule.ruleId}:${result.caseId}`),
  );

describe('grading the v1 suite through real agent versions', () => {
  it('finds no critical failures or errors for reference-v1', async () => {
    const results = await runCasesInMemory(
      cases,
      getAgent('reference-v1'),
      'offline_deterministic',
    );

    expect(results).toHaveLength(80);
    expect(criticalFailures(results)).toEqual([]);
    expect(results.filter((result) => result.status !== 'pass')).toEqual([]);
  });

  it('catches regression-demo-v1 on every eligible refund case with NO_FALSE_COMPLETION', async () => {
    const results = await runCasesInMemory(
      cases,
      getAgent('regression-demo-v1'),
      'offline_deterministic',
    );

    expect(criticalFailures(results)).toEqual([
      'NO_FALSE_COMPLETION:REF-001',
      'NO_FALSE_COMPLETION:REF-002',
      'NO_FALSE_COMPLETION:REF-003',
      'NO_FALSE_COMPLETION:REF-010',
      'NO_FALSE_COMPLETION:REF-011',
    ]);
    const ref001 = results.find((result) => result.caseId === 'REF-001');
    expect(ref001?.output).toMatchObject({
      claimsActionCompleted: false,
      proposedAction: 'request_refund_review',
    });
    expect(ref001?.rules.find((rule) => rule.ruleId === 'NO_FALSE_COMPLETION')).toMatchObject({
      verdict: 'fail',
      severity: 'critical',
      evidenceCode: 'affirmative_completion_language',
    });
  });

  it('passes repaired-v1 on the same cases the regression failed', async () => {
    const results = await runCasesInMemory(cases, getAgent('repaired-v1'), 'offline_deterministic');

    expect(criticalFailures(results)).toEqual([]);
    for (const id of ['REF-001', 'REF-002', 'REF-003', 'REF-010', 'REF-011']) {
      expect(results.find((result) => result.caseId === id)?.status).toBe('pass');
    }
  });
});

describe('agent input isolation', () => {
  it('never passes gold labels, rationale, or forbidden-claim lists to the adapter', async () => {
    const seen: AgentInput[] = [];
    const reference = getAgent('reference-v1');
    const spy: AgentAdapter = {
      version: 'spy',
      invoke(input) {
        seen.push(input);
        return reference.invoke(input);
      },
    };
    await runCasesInMemory(cases, spy, 'offline_deterministic');

    expect(seen).toHaveLength(80);
    for (const input of seen) {
      expect(Object.keys(input).sort()).toEqual([
        'account',
        'availablePolicyDocs',
        'correlationId',
        'message',
      ]);
      const serialized = JSON.stringify(input);
      expect(serialized).not.toMatch(
        /expected|rationale|forbiddenClaims|mustEscalate|requiredPolicyIds/u,
      );
      expect(serialized).not.toContain(
        'Apply fictional policy and keep completion claims separate',
      );
    }
  });

  it('gives the adapter a copy, so mutating its input cannot alter what graders see', async () => {
    const mutating: AgentAdapter = {
      version: 'mutating',
      invoke(input) {
        (input.account as { authenticated: boolean }).authenticated = true;
        (input.account as { actorWorkspaceId: string }).actorWorkspaceId =
          input.account.workspaceId;
        return getAgent('reference-v1').invoke(input);
      },
    };
    const security = cases.filter((goldenCase) => goldenCase.id === 'SEC-002');
    const [result] = await runCasesInMemory(security, mutating, 'offline_deterministic');

    expect(security[0]?.input.account.actorWorkspaceId).not.toBe(
      security[0]?.input.account.workspaceId,
    );
    expect(result?.rules.find((rule) => rule.ruleId === 'TENANT_ISOLATION')?.verdict).not.toBe(
      'not_applicable',
    );
  });
});

describe('adapter failures', () => {
  it('records a thrown adapter as an execution error on every rule', async () => {
    const throwing: AgentAdapter = {
      version: 'throwing',
      invoke() {
        throw new Error('boom with sensitive detail');
      },
    };
    const [result] = await runCasesInMemory(cases.slice(0, 1), throwing, 'offline_deterministic');

    expect(result).toMatchObject({
      status: 'error',
      executionError: 'adapter_exception',
      output: null,
    });
    expect(JSON.stringify(result)).not.toContain('sensitive detail');
  });

  it('times out a hung adapter and records it as an error', async () => {
    const hung: AgentAdapter = { version: 'hung', invoke: () => new Promise(() => undefined) };
    const [result] = await runCasesInMemory(cases.slice(0, 1), hung, 'offline_deterministic', {
      caseTimeoutMs: 20,
      latencyBudgetMs: 250,
      graderTimeoutMs: 1_000,
      maxConcurrency: 1,
    });

    expect(result).toMatchObject({ status: 'error', executionError: 'adapter_timeout' });
  });

  it('flags malformed adapter output through SCHEMA_VALID', async () => {
    const malformed: AgentAdapter = {
      version: 'malformed',
      invoke: () => ({ intent: 'refund_request' }) as never,
    };
    const [result] = await runCasesInMemory(cases.slice(0, 1), malformed, 'offline_deterministic');

    expect(result?.status).toBe('error');
    expect(result?.rules[0]).toMatchObject({ ruleId: 'SCHEMA_VALID', verdict: 'fail' });
  });
});
