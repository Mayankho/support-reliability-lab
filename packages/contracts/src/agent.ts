import { z } from 'zod';
import {
  decisionSchema,
  generationStatusSchema,
  intentSchema,
  nonNegativeIntSchema,
  planStatusSchema,
  policyIdSchema,
  policyVersionSchema,
  proposedActionSchema,
  routeSchema,
  subscriptionSchema,
} from './primitives.ts';

export const accountContextSchema = z
  .object({
    workspaceId: z.string().min(1),
    authenticated: z.boolean(),
    subscription: subscriptionSchema,
    planStatus: planStatusSchema,
    purchasedCreditsRemaining: nonNegativeIntSchema,
    lastPurchaseCreditsGranted: nonNegativeIntSchema,
    lastPurchaseCreditsUsed: nonNegativeIntSchema,
    lastPurchaseAgeDays: nonNegativeIntSchema.nullable(),
    paymentSettled: z.boolean().nullable(),
    disputed: z.boolean(),
    generationStatus: generationStatusSchema,
    generationChargedCredits: nonNegativeIntSchema,
    actorWorkspaceId: z.string().min(1),
  })
  .strict();

export const agentPolicyDocSchema = z
  .object({
    id: policyIdSchema,
    version: policyVersionSchema,
    text: z.string().min(1),
  })
  .strict();

export const modelUsageSchema = z
  .object({
    provider: z.string().min(1),
    name: z.string().min(1),
    inputTokens: nonNegativeIntSchema,
    outputTokens: nonNegativeIntSchema,
    estimatedCostUsd: z.number().nonnegative(),
  })
  .strict();

export const agentInputSchema = z
  .object({
    message: z.string().min(4).max(5000),
    account: accountContextSchema,
    availablePolicyDocs: z.array(agentPolicyDocSchema),
    correlationId: z.string().min(1).max(200),
  })
  .strict();

export const policyCitationSchema = z
  .object({
    id: policyIdSchema,
    version: policyVersionSchema,
  })
  .strict();

export const agentOutputSchema = z
  .object({
    intent: intentSchema,
    decision: decisionSchema,
    route: routeSchema,
    customerReply: z.string().min(1).max(8000),
    escalationReason: z.string().min(1).nullable(),
    policyCitations: z.array(policyCitationSchema),
    proposedAction: proposedActionSchema,
    requiresExplicitConfirmation: z.boolean(),
    claimsActionCompleted: z.boolean(),
    model: modelUsageSchema.optional(),
  })
  .strict();

export const actionProposalSchema = z
  .object({
    proposedAction: proposedActionSchema,
    requiresExplicitConfirmation: z.boolean(),
    claimsActionCompleted: z.boolean(),
  })
  .strict();

export type AccountContext = z.infer<typeof accountContextSchema>;
export type AgentPolicyDoc = z.infer<typeof agentPolicyDocSchema>;
export type ModelUsage = z.infer<typeof modelUsageSchema>;
export type AgentInput = z.infer<typeof agentInputSchema>;
export type PolicyCitation = z.infer<typeof policyCitationSchema>;
export type ActionProposal = z.infer<typeof actionProposalSchema>;

export interface AgentOutput {
  intent: z.infer<typeof intentSchema>;
  decision: z.infer<typeof decisionSchema>;
  route: z.infer<typeof routeSchema>;
  customerReply: string;
  escalationReason: string | null;
  policyCitations: PolicyCitation[];
  proposedAction: z.infer<typeof proposedActionSchema>;
  requiresExplicitConfirmation: boolean;
  claimsActionCompleted: boolean;
  model?: ModelUsage;
}

export interface AgentAdapter {
  readonly version: string;
  invoke(input: AgentInput): AgentOutput | Promise<AgentOutput>;
}

export type AgentInputHasNoExpected = 'expected' extends keyof AgentInput ? never : true;

export function parseAgentInput(value: unknown): AgentInput {
  return agentInputSchema.parse(value);
}

export function parseAgentOutput(value: unknown): AgentOutput {
  const parsed = agentOutputSchema.parse(value);
  const output: AgentOutput = {
    intent: parsed.intent,
    decision: parsed.decision,
    route: parsed.route,
    customerReply: parsed.customerReply,
    escalationReason: parsed.escalationReason,
    policyCitations: parsed.policyCitations,
    proposedAction: parsed.proposedAction,
    requiresExplicitConfirmation: parsed.requiresExplicitConfirmation,
    claimsActionCompleted: parsed.claimsActionCompleted,
  };
  if (parsed.model !== undefined) {
    output.model = parsed.model;
  }
  return output;
}
