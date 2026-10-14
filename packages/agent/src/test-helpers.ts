import type { AccountContext, AgentInput } from '@srl/contracts';
import { selectPolicyDocuments } from '@srl/policies';

export const BASE_ACCOUNT: AccountContext = {
  workspaceId: 'ws_test',
  actorWorkspaceId: 'ws_test',
  authenticated: true,
  subscription: 'monthly',
  planStatus: 'active',
  purchasedCreditsRemaining: 250,
  lastPurchaseCreditsGranted: 250,
  lastPurchaseCreditsUsed: 0,
  lastPurchaseAgeDays: 3,
  paymentSettled: true,
  disputed: false,
  generationStatus: 'none',
  generationChargedCredits: 0,
};

export function makeInput(
  message: string,
  docIds: readonly string[],
  account: Partial<AccountContext> = {},
): AgentInput {
  const selection = selectPolicyDocuments(docIds);
  if (selection.status !== 'ok') {
    throw new Error(`unknown policy ids in test input: ${docIds.join(', ')}`);
  }
  return {
    message,
    account: { ...BASE_ACCOUNT, ...account },
    availablePolicyDocs: selection.documents,
    correlationId: 'test-correlation',
  };
}
