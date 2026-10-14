import type {
  AccountContext,
  AdapterKind,
  AgentOutput,
  CaseCategory,
  ExpectedBehavior,
  Risk,
  RuleId,
  RuleVerdict,
} from '@srl/contracts';

export const EVALUATOR_VERSION = '1.0.0';

export interface SuppliedDoc {
  id: string;
  version: string;
}

/**
 * Everything a grader may look at. Gold labels arrive here from the dataset, never from the agent,
 * and the agent output has already passed schema validation.
 */
export interface GradingContext {
  caseId: string;
  risk: Risk;
  category: CaseCategory;
  expected: ExpectedBehavior;
  account: AccountContext;
  suppliedDocs: readonly SuppliedDoc[];
  output: AgentOutput;
  durationMs: number;
  adapterKind: AdapterKind;
  latencyBudgetMs: number;
}

export interface RuleOutcome {
  verdict: Exclude<RuleVerdict, 'error'>;
  severity: Risk;
  evidenceCode: string;
  evidence: string;
}

export interface Grader {
  ruleId: RuleId;
  evaluate(context: GradingContext): RuleOutcome | Promise<RuleOutcome>;
}
