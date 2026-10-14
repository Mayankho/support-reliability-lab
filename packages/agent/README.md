# @srl/agent

Deterministic, offline support agents. Each version is a real code path selected by ID, not a label on the same behavior.

| Version              | What it is                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `reference-v1`       | Baseline. Classifies the request, applies `SYN-POLICY-1` precedence, and writes truthful copy.    |
| `regression-demo-v1` | Intentional defect. Same decisions, but the refund-review reply says the refund already happened. |
| `repaired-v1`        | The fix. Restores the truthful copy and turns on a guard that rejects completion wording.         |

## What the agent sees

`invoke(input: AgentInput)` receives the customer message, the trusted account context, the policy documents supplied for the case, and a correlation ID. That is the output of `toAgentVisibleInput`; gold labels never reach it. A test in `boundary.test.ts` fails if any source file imports datasets, graders, or fixtures, or mentions golden case IDs, `expected`, or grader rule names.

## How a reply is built

1. `signals.ts` extracts language features from the message: what the customer is asking for, and whether the message tries to bypass identity, override policy, or claim authority. The message is untrusted, so these features never stand in for account facts.
2. `plan.ts` picks the intent, then walks the policy precedence: identity and isolation, instruction overrides, account-security handling, disputes and outages, distinct intents and missing context, knowledge provenance, and finally the request-specific rule (the 14-day refund window, failed-versus-completed generations, cancellation state). The result is a single reason code; the decision, route, and proposed action are derived from it, so they cannot disagree.
3. `citations.ts` cites only documents that were supplied, at their supplied versions.
4. `copy/` renders the reply for the reason code. Proposals say what would be requested and that nothing has happened yet. There is no executor behind any reply.

## The regression and its repair

The whole defect is one entry in `copy/regression-demo.ts`:

```ts
refund_review_eligible: () =>
  "Done! I've refunded your credit purchase to your original payment method. ...",
```

Everything structured stays correct: `proposedAction` is still `request_refund_review`, `requiresExplicitConfirmation` is still `true`, and `claimsActionCompleted` is still `false`. A check that trusts those fields would pass it. Only a grader that reads the reply text catches it, which is the point of the demonstration.

`repaired-v1` goes back to the truthful copy in `copy/reference.ts` and sets `guardCopy: true`. The guard (`copy/guard.ts`) renders every copy entry when the agent is built and checks every reply at runtime, throwing `UntruthfulCopyError` on affirmative completion wording. `versions.test.ts` proves the guard refuses to build an agent from the defective copy.

## Limits

The rules were written against `SYN-POLICY-1` with the public v1 cases in view, so agreement with those labels is not evidence of accuracy on unseen conversations. The unit tests use newly written phrasings to show the rules are not keyed to fixture wording, but a keyword classifier will still misread messages it has no pattern for. When it does, it falls back to a clarifying question rather than a protected action.
