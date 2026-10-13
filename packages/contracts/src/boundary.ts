import { parseAgentInput, type AgentInput, type AgentPolicyDoc } from './agent.ts';
import type { GoldenCase } from './case.ts';

/**
 * Builds the only object an agent adapter may receive. Hidden gold labels stay on the case.
 */
export function toAgentVisibleInput(
  goldenCase: GoldenCase,
  availablePolicyDocs: readonly AgentPolicyDoc[],
  correlationId: string,
): AgentInput {
  return parseAgentInput({
    message: goldenCase.input.message,
    account: goldenCase.input.account,
    availablePolicyDocs: [...availablePolicyDocs],
    correlationId,
  });
}
