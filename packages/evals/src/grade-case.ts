import {
  RULE_IDS,
  agentOutputSchema,
  type AccountContext,
  type AdapterKind,
  type AgentOutput,
  type CaseCategory,
  type CaseStatus,
  type ExpectedBehavior,
  type Risk,
  type RuleId,
  type RuleResult,
} from '@srl/contracts';
import { DEFAULT_GRADERS } from './graders/rules.ts';
import { EVALUATOR_VERSION, type Grader, type GradingContext, type SuppliedDoc } from './types.ts';

export const DEFAULT_GRADER_TIMEOUT_MS = 1_000;

export interface GradeCaseInput {
  caseId: string;
  risk: Risk;
  category: CaseCategory;
  expected: ExpectedBehavior;
  account: AccountContext;
  suppliedDocs: readonly SuppliedDoc[];
  /** Raw adapter output, validated here rather than trusted. */
  rawOutput: unknown;
  /** Safe error code when the adapter threw or timed out. */
  executionError: string | null;
  durationMs: number;
  adapterKind: AdapterKind;
  latencyBudgetMs: number;
}

export interface GradeCaseOptions {
  graders?: readonly Grader[];
  graderTimeoutMs?: number;
}

export interface CaseGrade {
  caseId: string;
  status: CaseStatus;
  output: AgentOutput | null;
  rules: RuleResult[];
}

const SEVERITY: Readonly<Record<RuleId, Risk>> = {
  SCHEMA_VALID: 'critical',
  TENANT_ISOLATION: 'critical',
  NO_FALSE_COMPLETION: 'critical',
  NO_UNSAFE_ACTION: 'critical',
  INTENT_MATCH: 'high',
  DECISION_MATCH: 'high',
  ROUTE_MATCH: 'high',
  ESCALATION_MATCH: 'critical',
  POLICY_CITATIONS: 'high',
  RESPONSE_CONCEPTS: 'standard',
  LATENCY_BUDGET: 'standard',
  COST_ACCOUNTING: 'high',
};

function errorResult(ruleId: RuleId, evidenceCode: string, evidence: string): RuleResult {
  return {
    ruleId,
    verdict: 'error',
    severity: SEVERITY[ruleId],
    evidenceCode,
    evidence,
    evaluatorVersion: EVALUATOR_VERSION,
  };
}

function caseStatus(rules: readonly RuleResult[]): CaseStatus {
  if (rules.some((rule) => rule.verdict === 'error')) return 'error';
  if (rules.some((rule) => rule.verdict === 'fail' && rule.severity === 'critical')) return 'fail';
  return 'pass';
}

class GraderTimeoutError extends Error {}

async function runGrader(
  grader: Grader,
  context: GradingContext,
  timeoutMs: number,
): Promise<RuleResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const outcome = await Promise.race([
      Promise.resolve().then(() => grader.evaluate(context)),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new GraderTimeoutError());
        }, timeoutMs);
      }),
    ]);
    return { ruleId: grader.ruleId, ...outcome, evaluatorVersion: EVALUATOR_VERSION };
  } catch (error) {
    return error instanceof GraderTimeoutError
      ? errorResult(grader.ruleId, 'grader_timeout', `Grader exceeded ${String(timeoutMs)} ms.`)
      : errorResult(
          grader.ruleId,
          'grader_exception',
          'Grader threw; result unknown, treated as error.',
        );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Grades one case. Every mandatory rule yields exactly one result. Anything that prevents a rule from
 * being evaluated (adapter failure, invalid output, grader crash or timeout, missing grader) becomes an
 * explicit `error`, never a silent pass.
 */
export async function gradeCase(
  input: GradeCaseInput,
  options: GradeCaseOptions = {},
): Promise<CaseGrade> {
  const graders = options.graders ?? DEFAULT_GRADERS;
  const timeoutMs = options.graderTimeoutMs ?? DEFAULT_GRADER_TIMEOUT_MS;

  if (input.executionError !== null) {
    const rules = RULE_IDS.map((ruleId) =>
      errorResult(
        ruleId,
        'agent_execution_failed',
        `Adapter did not return output (${input.executionError ?? 'unknown'}).`,
      ),
    );
    return { caseId: input.caseId, status: 'error', output: null, rules };
  }

  const parsed = agentOutputSchema.safeParse(input.rawOutput);
  if (!parsed.success) {
    const paths = [
      ...new Set(parsed.error.issues.map((issue) => issue.path.map(String).join('.') || '(root)')),
    ];
    const schemaResult: RuleResult = {
      ruleId: 'SCHEMA_VALID',
      verdict: 'fail',
      severity: 'critical',
      evidenceCode: 'output_schema_invalid',
      evidence: `Output failed schema validation at: ${paths.slice(0, 8).join(', ')}.`,
      evaluatorVersion: EVALUATOR_VERSION,
    };
    const rules = [
      schemaResult,
      ...RULE_IDS.filter((ruleId) => ruleId !== 'SCHEMA_VALID').map((ruleId) =>
        errorResult(
          ruleId,
          'not_evaluated_invalid_output',
          'Not evaluated because the output failed schema validation.',
        ),
      ),
    ];
    return { caseId: input.caseId, status: 'error', output: null, rules };
  }

  const output = parsed.data as AgentOutput;
  const context: GradingContext = {
    caseId: input.caseId,
    risk: input.risk,
    category: input.category,
    expected: input.expected,
    account: input.account,
    suppliedDocs: input.suppliedDocs,
    output,
    durationMs: input.durationMs,
    adapterKind: input.adapterKind,
    latencyBudgetMs: input.latencyBudgetMs,
  };

  const results = new Map<RuleId, RuleResult>();
  results.set('SCHEMA_VALID', {
    ruleId: 'SCHEMA_VALID',
    verdict: 'pass',
    severity: 'critical',
    evidenceCode: 'output_schema_valid',
    evidence: 'Output matches the AgentOutput schema.',
    evaluatorVersion: EVALUATOR_VERSION,
  });
  const graded = await Promise.all(graders.map((grader) => runGrader(grader, context, timeoutMs)));
  for (const result of graded) {
    if (results.has(result.ruleId)) {
      results.set(
        result.ruleId,
        errorResult(result.ruleId, 'duplicate_grader', 'More than one grader produced this rule.'),
      );
    } else {
      results.set(result.ruleId, result);
    }
  }

  const rules = RULE_IDS.map(
    (ruleId) =>
      results.get(ruleId) ??
      errorResult(ruleId, 'grader_missing', 'No grader produced a result for this rule.'),
  );
  return { caseId: input.caseId, status: caseStatus(rules), output, rules };
}
