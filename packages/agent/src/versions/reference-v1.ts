import { createAgent } from '../build-agent.ts';
import { REFERENCE_COPY } from '../copy/reference.ts';

/** Baseline: SYN-POLICY-1 precedence with truthful proposal copy. */
export const referenceV1 = createAgent({
  version: 'reference-v1',
  copy: REFERENCE_COPY,
  guardCopy: false,
});
