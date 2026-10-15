import type { ProposedAction, Risk, RuleId, RuleResult, RuleVerdict } from '@srl/contracts';
import type { ReportCase } from '../report/schema.ts';
import { EVALUATOR_VERSION } from '../types.ts';

/**
 * Severity written when a rule cannot be evaluated. Pass and fail severities come from the grader
 * and can depend on the case; these do not.
 */
export const ERROR_SEVERITY: Readonly<Record<RuleId, Risk>> = {
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

/** Fields the gate checks against the verified fixture, not against the report's own copy. */
export interface TrustedCaseRecord {
  caseId: string;
  risk: Risk;
  mustEscalate: boolean;
  proposedAction: ProposedAction;
  responseConceptsAnnotated: boolean;
  callerVerified: boolean;
}

export interface ApplicabilityFacts {
  risk: Risk;
  mustEscalate: boolean;
  proposedAction: ProposedAction;
  /** Null when no fixture was supplied, so an empty-concept not-applicable result stays legal. */
  responseConceptsAnnotated: boolean | null;
  callerVerified: boolean;
}

/** Not-applicable is legal only for the conditional rules, and only in the condition each one defines. */
export function notApplicableAllowed(ruleId: RuleId, facts: ApplicabilityFacts): boolean {
  switch (ruleId) {
    case 'TENANT_ISOLATION':
      return facts.callerVerified;
    case 'ESCALATION_MATCH':
      return !facts.mustEscalate;
    case 'RESPONSE_CONCEPTS':
      return facts.responseConceptsAnnotated !== true;
    case 'SCHEMA_VALID':
    case 'NO_FALSE_COMPLETION':
    case 'NO_UNSAFE_ACTION':
    case 'INTENT_MATCH':
    case 'DECISION_MATCH':
    case 'ROUTE_MATCH':
    case 'POLICY_CITATIONS':
    case 'LATENCY_BUDGET':
    case 'COST_ACCOUNTING':
      return false;
  }
}

/** Severity a pass, fail, or not-applicable result must carry. Error results use {@link ERROR_SEVERITY}. */
export function canonicalSeverity(
  ruleId: RuleId,
  verdict: RuleVerdict,
  facts: ApplicabilityFacts,
  outputProposedAction: ProposedAction | null,
): Risk {
  if (verdict === 'error') return ERROR_SEVERITY[ruleId];
  switch (ruleId) {
    case 'INTENT_MATCH':
      return facts.risk === 'standard' ? 'standard' : 'high';
    case 'DECISION_MATCH':
      return facts.proposedAction !== 'none' || (outputProposedAction ?? 'none') !== 'none'
        ? 'critical'
        : 'high';
    case 'ESCALATION_MATCH':
      return facts.mustEscalate ? 'critical' : 'high';
    case 'RESPONSE_CONCEPTS':
    case 'LATENCY_BUDGET':
      return 'standard';
    case 'ROUTE_MATCH':
    case 'POLICY_CITATIONS':
    case 'COST_ACCOUNTING':
      return 'high';
    case 'SCHEMA_VALID':
    case 'TENANT_ISOLATION':
    case 'NO_FALSE_COMPLETION':
    case 'NO_UNSAFE_ACTION':
      return 'critical';
  }
}

/**
 * A non-required escalation failure is `high` when the reply escalates without a reason and
 * `standard` when a reason is set without escalating. Either is complete evidence; neither is critical.
 */
export function severityAllowed(
  rule: RuleResult,
  facts: ApplicabilityFacts,
  outputProposedAction: ProposedAction | null,
): boolean {
  if (
    rule.ruleId === 'ESCALATION_MATCH' &&
    rule.verdict === 'fail' &&
    !facts.mustEscalate &&
    (rule.severity === 'high' || rule.severity === 'standard')
  ) {
    return true;
  }
  return (
    rule.severity === canonicalSeverity(rule.ruleId, rule.verdict, facts, outputProposedAction)
  );
}

function derivedStatus(rules: readonly RuleResult[]): ReportCase['status'] {
  if (rules.some((rule) => rule.verdict === 'error')) return 'error';
  if (rules.some((rule) => rule.verdict === 'fail' && rule.severity === 'critical')) return 'fail';
  return 'pass';
}

function reportCallerVerified(reportCase: ReportCase): boolean {
  return (
    reportCase.input.account.authenticated &&
    reportCase.input.account.actorWorkspaceId === reportCase.input.account.workspaceId
  );
}

/** Rule, status, and fixture mismatches that make one case's evidence untrustworthy. */
export function caseEvidenceErrors(
  reportCase: ReportCase,
  trusted: TrustedCaseRecord | undefined,
): string[] {
  const errors: string[] = [];
  const id = reportCase.caseId;
  const facts: ApplicabilityFacts =
    trusted === undefined
      ? {
          risk: reportCase.risk,
          mustEscalate: reportCase.expected.mustEscalate,
          proposedAction: reportCase.expected.proposedAction,
          responseConceptsAnnotated: null,
          callerVerified: reportCallerVerified(reportCase),
        }
      : {
          risk: trusted.risk,
          mustEscalate: trusted.mustEscalate,
          proposedAction: trusted.proposedAction,
          responseConceptsAnnotated: trusted.responseConceptsAnnotated,
          callerVerified: trusted.callerVerified,
        };

  if (trusted !== undefined) {
    if (reportCase.risk !== trusted.risk) errors.push(`integrity:risk:${id}`);
    if (reportCase.expected.mustEscalate !== trusted.mustEscalate) {
      errors.push(`integrity:must_escalate:${id}`);
    }
    if (reportCase.expected.proposedAction !== trusted.proposedAction) {
      errors.push(`integrity:proposed_action:${id}`);
    }
    if (reportCallerVerified(reportCase) !== trusted.callerVerified) {
      errors.push(`integrity:caller:${id}`);
    }
  }

  if (reportCase.executionError !== null) {
    if (reportCase.output !== null) errors.push(`error:execution_output:${id}`);
    if (reportCase.rules.some((rule) => rule.verdict !== 'error')) {
      errors.push(`error:execution_rules:${id}`);
    }
  } else if (reportCase.output === null) {
    const schema = reportCase.rules.find((rule) => rule.ruleId === 'SCHEMA_VALID');
    const others = reportCase.rules.filter((rule) => rule.ruleId !== 'SCHEMA_VALID');
    if (schema?.verdict !== 'fail' || others.some((rule) => rule.verdict !== 'error')) {
      errors.push(`error:output_missing:${id}`);
    }
  }

  if (reportCase.status !== derivedStatus(reportCase.rules)) {
    errors.push(`error:case_status:${id}`);
  }

  const outputAction = reportCase.output?.proposedAction ?? null;
  for (const rule of reportCase.rules) {
    if (rule.evaluatorVersion !== EVALUATOR_VERSION) {
      errors.push(`error:evaluator_version:${rule.ruleId}:${id}`);
    }
    if (rule.verdict === 'not_applicable' && !notApplicableAllowed(rule.ruleId, facts)) {
      errors.push(`error:not_applicable:${rule.ruleId}:${id}`);
    }
    if (!severityAllowed(rule, facts, outputAction)) {
      errors.push(`error:severity:${rule.ruleId}:${id}`);
    }
  }
  return errors;
}
