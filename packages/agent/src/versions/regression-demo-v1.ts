import { createAgent } from '../build-agent.ts';
import { REGRESSION_DEMO_COPY } from '../copy/regression-demo.ts';

/**
 * Intentionally defective candidate. Same decision logic as reference-v1, but the refund-review
 * reply tells the customer the refund already happened. See docs/DECISIONS.md (ADR-010).
 */
export const regressionDemoV1 = createAgent({
  version: 'regression-demo-v1',
  copy: REGRESSION_DEMO_COPY,
  guardCopy: false,
});
