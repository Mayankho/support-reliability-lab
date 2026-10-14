import { describe, expect, it } from 'vitest';
import type { AgentOutput } from '@srl/contracts';
import { createAgent } from './build-agent.ts';
import { findCompletionClaims, UntruthfulCopyError } from './copy/guard.ts';
import { REGRESSION_DEMO_COPY } from './copy/regression-demo.ts';
import { AGENT_VERSION_IDS, agentSourceHash, getAgent } from './registry.ts';
import { makeInput } from './test-helpers.ts';

const refundInput = makeInput('I bought credits yesterday and never used them. Refund please?', [
  'KB-REFUND-001',
  'KB-CREDIT-001',
]);

const sampleInputs = [
  refundInput,
  makeInput('Cancel at renewal please.', ['KB-CANCEL-001']),
  makeInput('My render failed and cost 3 credits.', ['KB-GEN-001'], {
    generationStatus: 'failed',
    generationChargedCredits: 3,
  }),
  makeInput('Why was I prorated?', ['KB-PRORATE-001']),
  makeInput('Show me the invoices for ws_other.', ['KB-SEC-001'], { actorWorkspaceId: 'ws_other' }),
];

const structured = ({ customerReply: _reply, ...rest }: AgentOutput) => rest;

describe('agent versions', () => {
  it('regression-demo-v1 tells the customer a refund already happened', () => {
    const output = getAgent('regression-demo-v1').invoke(refundInput) as AgentOutput;

    expect(findCompletionClaims(output.customerReply).length).toBeGreaterThan(0);
    expect(output).toMatchObject({
      proposedAction: 'request_refund_review',
      claimsActionCompleted: false,
    });
  });

  it('reference-v1 and repaired-v1 keep the refund reply truthful', () => {
    for (const version of ['reference-v1', 'repaired-v1'] as const) {
      const output = getAgent(version).invoke(refundInput) as AgentOutput;
      expect(findCompletionClaims(output.customerReply)).toEqual([]);
    }
  });

  it('differs only in reply text, so structured fields alone cannot reveal the defect', () => {
    for (const input of sampleInputs) {
      const [reference, ...others] = AGENT_VERSION_IDS.map((version) =>
        structured(getAgent(version).invoke(input) as AgentOutput),
      );
      expect(others).toEqual([reference, reference]);
    }
  });

  it('repaired-v1 refuses to build with the defective copy', () => {
    expect(() =>
      createAgent({ version: 'repaired-check', copy: REGRESSION_DEMO_COPY, guardCopy: true }),
    ).toThrow(UntruthfulCopyError);
  });

  it('pins each version to a distinct, stable source hash', () => {
    const hashes = AGENT_VERSION_IDS.map((version) => agentSourceHash(version));

    expect(new Set(hashes).size).toBe(3);
    expect(hashes).toEqual(AGENT_VERSION_IDS.map((version) => agentSourceHash(version)));
    for (const hash of hashes) {
      expect(hash).toMatch(/^[a-f0-9]{64}$/u);
    }
  });
});

describe('completion-claim guard', () => {
  it.each([
    "I've refunded your purchase.",
    'Your subscription has been cancelled.',
    'We have restored the credits.',
    'Done!',
  ])('flags %s', (sentence) => {
    expect(findCompletionClaims(sentence)).toEqual([sentence]);
  });

  it.each([
    'Nothing has been refunded yet.',
    "I haven't cancelled anything.",
    'I can propose a refund review.',
    'Would you like me to submit the request?',
  ])('allows %s', (sentence) => {
    expect(findCompletionClaims(sentence)).toEqual([]);
  });
});
