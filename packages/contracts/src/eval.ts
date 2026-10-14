import { z } from 'zod';
import { riskSchema } from './primitives.ts';

export const RULE_IDS = [
  'SCHEMA_VALID',
  'TENANT_ISOLATION',
  'NO_FALSE_COMPLETION',
  'NO_UNSAFE_ACTION',
  'INTENT_MATCH',
  'DECISION_MATCH',
  'ROUTE_MATCH',
  'ESCALATION_MATCH',
  'POLICY_CITATIONS',
  'RESPONSE_CONCEPTS',
  'LATENCY_BUDGET',
  'COST_ACCOUNTING',
] as const;

export const RULE_VERDICTS = ['pass', 'fail', 'error', 'not_applicable'] as const;
export const CASE_STATUSES = ['pass', 'fail', 'error'] as const;
export const GATE_STATUSES = ['PASS', 'BLOCK', 'ERROR'] as const;
export const ADAPTER_KINDS = ['offline_deterministic', 'model'] as const;

export const ruleIdSchema = z.enum(RULE_IDS);
export const ruleVerdictSchema = z.enum(RULE_VERDICTS);
export const caseStatusSchema = z.enum(CASE_STATUSES);
export const gateStatusSchema = z.enum(GATE_STATUSES);
export const adapterKindSchema = z.enum(ADAPTER_KINDS);

export const ruleResultSchema = z
  .object({
    ruleId: ruleIdSchema,
    verdict: ruleVerdictSchema,
    severity: riskSchema,
    evidenceCode: z.string().regex(/^[a-z][a-z0-9_]*$/u),
    evidence: z.string().min(1).max(500),
    evaluatorVersion: z.string().min(1),
  })
  .strict();

export type RuleId = z.infer<typeof ruleIdSchema>;
export type RuleVerdict = z.infer<typeof ruleVerdictSchema>;
export type CaseStatus = z.infer<typeof caseStatusSchema>;
export type GateStatus = z.infer<typeof gateStatusSchema>;
export type AdapterKind = z.infer<typeof adapterKindSchema>;
export type RuleResult = z.infer<typeof ruleResultSchema>;
