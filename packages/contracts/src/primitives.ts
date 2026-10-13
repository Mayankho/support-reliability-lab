import { z } from 'zod';

export const INTENTS = [
  'refund_request',
  'subscription_cancel',
  'credit_restoration',
  'generation_failure',
  'proration_question',
  'account_access',
  'technical_support',
  'policy_question',
  'other',
] as const;

export const DECISIONS = ['answer', 'clarify', 'escalate', 'propose_action', 'decline'] as const;

export const ROUTES = [
  'self_serve',
  'billing',
  'technical',
  'account_security',
  'trust_safety',
] as const;

export const PROPOSED_ACTIONS = [
  'none',
  'request_refund_review',
  'cancel_at_renewal',
  'restore_generation_credits_review',
] as const;

export const RISKS = ['critical', 'high', 'standard'] as const;

export const SUBSCRIPTIONS = ['free', 'monthly', 'annual'] as const;

export const PLAN_STATUSES = ['active', 'cancel_pending', 'inactive'] as const;

export const GENERATION_STATUSES = ['none', 'failed', 'completed', 'processing'] as const;

export const CASE_CATEGORIES = [
  'refund_guidance',
  'cancellation',
  'generation_credits',
  'annual_proration',
  'account_security',
  'knowledge_grounding',
  'tool_failure',
  'adversarial_ambiguous',
] as const;

export const intentSchema = z.enum(INTENTS);
export const decisionSchema = z.enum(DECISIONS);
export const routeSchema = z.enum(ROUTES);
export const proposedActionSchema = z.enum(PROPOSED_ACTIONS);
export const riskSchema = z.enum(RISKS);
export const subscriptionSchema = z.enum(SUBSCRIPTIONS);
export const planStatusSchema = z.enum(PLAN_STATUSES);
export const generationStatusSchema = z.enum(GENERATION_STATUSES);
export const caseCategorySchema = z.enum(CASE_CATEGORIES);

export const policyIdSchema = z.string().regex(/^KB-[A-Z]+-[0-9]{3}$/u);
export const policyVersionSchema = z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/u);
export const caseIdSchema = z.string().regex(/^[A-Z]{2,5}-[0-9]{3}$/u);

export const nonNegativeIntSchema = z.number().int().nonnegative();

export type Intent = z.infer<typeof intentSchema>;
export type Decision = z.infer<typeof decisionSchema>;
export type Route = z.infer<typeof routeSchema>;
export type ProposedAction = z.infer<typeof proposedActionSchema>;
export type Risk = z.infer<typeof riskSchema>;
export type Subscription = z.infer<typeof subscriptionSchema>;
export type PlanStatus = z.infer<typeof planStatusSchema>;
export type GenerationStatus = z.infer<typeof generationStatusSchema>;
export type CaseCategory = z.infer<typeof caseCategorySchema>;
