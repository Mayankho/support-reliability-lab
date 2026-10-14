import type { RuleId, RuleResult } from '@srl/contracts';
import type { FixLayer } from './schema.ts';

/**
 * First guess at where a failure should be fixed. A hypothesis for triage, not a diagnosis; a human
 * confirms or overrides it.
 */
const BY_RULE: Readonly<Record<RuleId, FixLayer>> = {
  SCHEMA_VALID: 'application_code',
  TENANT_ISOLATION: 'application_code',
  NO_FALSE_COMPLETION: 'prompt',
  NO_UNSAFE_ACTION: 'application_code',
  INTENT_MATCH: 'agent_routing',
  DECISION_MATCH: 'policy',
  ROUTE_MATCH: 'agent_routing',
  ESCALATION_MATCH: 'agent_routing',
  POLICY_CITATIONS: 'knowledge_base',
  RESPONSE_CONCEPTS: 'prompt',
  LATENCY_BUDGET: 'application_code',
  COST_ACCOUNTING: 'tool_integration',
};

export function suggestFixLayers(
  rules: readonly RuleResult[],
  executionError: string | null,
): FixLayer[] {
  const layers = new Set<FixLayer>();
  if (executionError !== null) {
    layers.add('tool_integration');
  }
  for (const rule of rules) {
    if (rule.verdict === 'fail') {
      layers.add(BY_RULE[rule.ruleId]);
    }
    if (rule.verdict === 'error' && rule.evidenceCode.startsWith('grader_')) {
      layers.add('evaluator_bug');
    }
  }
  return [...layers];
}
