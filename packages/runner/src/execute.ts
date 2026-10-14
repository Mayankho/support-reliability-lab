import { performance } from 'node:perf_hooks';
import {
  toAgentVisibleInput,
  type AdapterKind,
  type AgentAdapter,
  type AgentInput,
  type CaseStatus,
  type GoldenCase,
  type AgentOutput,
  type RuleResult,
} from '@srl/contracts';
import { gradeCase, type SuppliedDoc } from '@srl/evals';
import { selectPolicyDocuments } from '@srl/policies';

export interface RunConfig {
  caseTimeoutMs: number;
  latencyBudgetMs: number;
  graderTimeoutMs: number;
  maxConcurrency: number;
}

export const DEFAULT_RUN_CONFIG: RunConfig = {
  caseTimeoutMs: 5_000,
  latencyBudgetMs: 250,
  graderTimeoutMs: 1_000,
  maxConcurrency: 4,
};

export interface PreparedCase {
  goldenCase: GoldenCase;
  agentInput: AgentInput;
  suppliedDocs: SuppliedDoc[];
}

export interface CaseResult {
  caseId: string;
  category: GoldenCase['category'];
  risk: GoldenCase['risk'];
  status: CaseStatus;
  output: AgentOutput | null;
  rules: RuleResult[];
  durationMs: number;
  executionError: string | null;
}

/** Builds the agent-visible input. Gold labels stay on the case and go only to grading. */
export function prepareCase(goldenCase: GoldenCase, correlationId: string): PreparedCase {
  const selection = selectPolicyDocuments(goldenCase.availablePolicyIds);
  if (selection.status !== 'ok') {
    throw new Error(`case ${goldenCase.id} references unavailable policy documents`);
  }
  return {
    goldenCase,
    agentInput: toAgentVisibleInput(goldenCase, selection.documents, correlationId),
    suppliedDocs: selection.documents.map(({ id, version }) => ({ id, version })),
  };
}

class AdapterTimeoutError extends Error {}

export async function invokeAdapter(
  adapter: AgentAdapter,
  input: AgentInput,
  timeoutMs: number,
): Promise<{ rawOutput: unknown; executionError: string | null; durationMs: number }> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    const rawOutput: unknown = await Promise.race([
      Promise.resolve().then(() => adapter.invoke(structuredClone(input))),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new AdapterTimeoutError());
        }, timeoutMs);
      }),
    ]);
    return { rawOutput, executionError: null, durationMs: performance.now() - started };
  } catch (error) {
    return {
      rawOutput: null,
      executionError:
        error instanceof AdapterTimeoutError ? 'adapter_timeout' : 'adapter_exception',
      durationMs: performance.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function executeCase(
  prepared: PreparedCase,
  adapter: AgentAdapter,
  adapterKind: AdapterKind,
  config: RunConfig,
): Promise<CaseResult> {
  const { goldenCase } = prepared;
  const invocation = await invokeAdapter(adapter, prepared.agentInput, config.caseTimeoutMs);
  const grade = await gradeCase(
    {
      caseId: goldenCase.id,
      risk: goldenCase.risk,
      category: goldenCase.category,
      expected: goldenCase.expected,
      account: goldenCase.input.account,
      suppliedDocs: prepared.suppliedDocs,
      rawOutput: invocation.rawOutput,
      executionError: invocation.executionError,
      durationMs: invocation.durationMs,
      adapterKind,
      latencyBudgetMs: config.latencyBudgetMs,
    },
    { graderTimeoutMs: config.graderTimeoutMs },
  );
  return {
    caseId: goldenCase.id,
    category: goldenCase.category,
    risk: goldenCase.risk,
    status: grade.status,
    output: grade.output,
    rules: grade.rules,
    durationMs: invocation.durationMs,
    executionError: invocation.executionError,
  };
}

/** Runs items with at most `limit` in flight, preserving input order in the result. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index] as T, index);
    }
  });
  await Promise.all(lanes);
  return results;
}

export async function runCasesInMemory(
  cases: readonly GoldenCase[],
  adapter: AgentAdapter,
  adapterKind: AdapterKind,
  config: RunConfig = DEFAULT_RUN_CONFIG,
  correlationPrefix = 'mem',
): Promise<CaseResult[]> {
  return mapWithConcurrency(cases, config.maxConcurrency, (goldenCase) =>
    executeCase(
      prepareCase(goldenCase, `${correlationPrefix}-${goldenCase.id}`),
      adapter,
      adapterKind,
      config,
    ),
  );
}
