import { createAgent } from '../build-agent.ts';
import { REFERENCE_COPY } from '../copy/reference.ts';

/**
 * Fix for regression-demo-v1: restores the truthful refund-review copy and turns on the copy guard,
 * which rejects completion wording both when the agent is built and on every reply.
 */
export const repairedV1 = createAgent({
  version: 'repaired-v1',
  copy: REFERENCE_COPY,
  guardCopy: true,
});
