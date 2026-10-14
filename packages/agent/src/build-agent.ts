import {
  parseAgentInput,
  parseAgentOutput,
  type AccountContext,
  type AgentAdapter,
  type AgentInput,
  type AgentOutput,
} from '@srl/contracts';
import { selectCitations } from './citations.ts';
import { findCompletionClaims, UntruthfulCopyError } from './copy/guard.ts';
import { ESCALATION_REASONS } from './copy/reference.ts';
import type { EscalationReasonCode, ReplyCopy } from './copy/types.ts';
import { planResponse, REASONS, type Plan, type ReasonCode } from './plan.ts';

export interface AgentDefinition {
  version: string;
  copy: ReplyCopy;
  /** Reject copy that affirmatively claims a protected action completed. */
  guardCopy: boolean;
}

const SAMPLE_ACCOUNT: AccountContext = {
  workspaceId: 'ws_sample',
  actorWorkspaceId: 'ws_sample',
  authenticated: true,
  subscription: 'monthly',
  planStatus: 'active',
  purchasedCreditsRemaining: 10,
  lastPurchaseCreditsGranted: 10,
  lastPurchaseCreditsUsed: 0,
  lastPurchaseAgeDays: 2,
  paymentSettled: true,
  disputed: false,
  generationStatus: 'failed',
  generationChargedCredits: 3,
};

function isEscalation(reason: ReasonCode): reason is EscalationReasonCode {
  return REASONS[reason] === 'escalate';
}

/** Renders every copy entry once against a sample account and rejects untruthful wording. */
export function verifyCopy(copy: ReplyCopy): void {
  for (const reason of Object.keys(REASONS) as ReasonCode[]) {
    const plan: Plan = {
      intent: 'other',
      reason,
      decision: REASONS[reason],
      route: 'self_serve',
      proposedAction: 'none',
      policyTopic: null,
    };
    const reply = copy[reason]({ plan, account: SAMPLE_ACCOUNT, citedDocIds: [] });
    if (findCompletionClaims(reply).length > 0) {
      throw new UntruthfulCopyError(reason);
    }
  }
}

export function createAgent(definition: AgentDefinition): AgentAdapter {
  if (definition.guardCopy) {
    verifyCopy(definition.copy);
  }

  return {
    version: definition.version,
    invoke(rawInput: AgentInput): AgentOutput {
      const input = parseAgentInput(rawInput);
      const plan = planResponse(input);
      const policyCitations = selectCitations(plan, input.availablePolicyDocs);
      const customerReply = definition.copy[plan.reason]({
        plan,
        account: input.account,
        citedDocIds: policyCitations.map((citation) => citation.id),
      });

      if (definition.guardCopy && findCompletionClaims(customerReply).length > 0) {
        throw new UntruthfulCopyError(plan.reason);
      }

      return parseAgentOutput({
        intent: plan.intent,
        decision: plan.decision,
        route: plan.route,
        customerReply,
        escalationReason: isEscalation(plan.reason) ? ESCALATION_REASONS[plan.reason] : null,
        policyCitations,
        proposedAction: plan.proposedAction,
        requiresExplicitConfirmation: plan.proposedAction !== 'none',
        claimsActionCompleted: false,
      });
    },
  };
}
