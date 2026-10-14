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
import { EVALUATOR_VERSION, gradeCase, type SuppliedDoc } from '@srl/evals';
import { selectPolicyDocuments } from '@srl/policies';
import { SpanStatusCode, startChildSpan, type Span } from '@srl/telemetry';

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
  parentSpan: Span | null = null,
): Promise<CaseResult> {
  const { goldenCase } = prepared;
  const agentSpan = startChildSpan('agent.invoke', parentSpan, { 'srl.adapter_kind': adapterKind });
  const invocation = await invokeAdapter(adapter, prepared.agentInput, config.caseTimeoutMs);
  agentSpan.setAttribute('srl.duration_ms', Number(invocation.durationMs.toFixed(3)));
  if (invocation.executionError !== null) {
    agentSpan.setAttribute('srl.error_class', invocation.executionError);
    agentSpan.setStatus({ code: SpanStatusCode.ERROR });
  }
  agentSpan.end();

  const graderSpan = startChildSpan('grader.evaluate', parentSpan, {
    'srl.evaluator_version': EVALUATOR_VERSION,
  });
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
  graderSpan.setAttribute('srl.case_status', grade.status);
  if (grade.status === 'error') graderSpan.setStatus({ code: SpanStatusCode.ERROR });
  graderSpan.end();
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

/**
 * Runs items with at most `limit` in flight, preserving input order in the result. After the first
 * failure no new items start; the first error is rethrown once in-flight items settle.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const state: { next: number; failure: { error: unknown } | null } = { next: 0, failure: null };
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (state.failure === null && state.next < items.length) {
      const index = state.next;
      state.next += 1;
      try {
        results[index] = await worker(items[index] as T, index);
      } catch (error) {
        state.failure ??= { error };
      }
    }
  });
  await Promise.all(lanes);
  if (state.failure !== null) {
    throw state.failure.error;
  }
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
