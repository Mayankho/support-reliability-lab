# Gold-label review for dataset v1

**Status:** starter labels, one single-reviewer pass by the maintainer. Not independently annotated, not adjudicated. No label in `fixtures/golden_cases.v1.jsonl` has been changed.

The machine-readable record is [`fixtures/annotations/review.v1.json`](../../fixtures/annotations/review.v1.json). `pnpm eval:validate-data` checks that it covers every case exactly once, refers to the exact fixture bytes by SHA-256, gives a note for every non-`consistent` entry, and does not claim independent adjudication unless the manifest says so.

## What the pass found

All 80 records parse, validate against the contract, and match the manifest counts (80 cases, 44 critical). Every policy reference exists in `SYN-POLICY-1`, and every required citation is among the documents the agent is given.

| Outcome                                 | Cases         |
| --------------------------------------- | ------------- |
| Consistent with `SYN-POLICY-1`          | 55            |
| Consistent, with a note worth recording | 24            |
| Disputed but still scored               | 1 (`GEN-012`) |
| Unscored                                | 0             |

Points that apply to the whole file:

- Every case uses the same `rationale` string and the same four `forbiddenClaims`. The rationale does not explain the individual label. Graders must therefore detect completion claims from general language patterns, not only these four phrases.
- `requiredResponseConcepts` is empty in every case, so `RESPONSE_CONCEPTS` is not applicable on v1.
- Every `PRO-*` account has `subscription: "monthly"` while the messages describe annual plans. The expected behavior (escalate proration to billing) does not change, so the labels stand.

Individual notes worth reading first:

- **GEN-012 (disputed):** the required citation is `KB-GEN-001`, but `KB-CREDIT-001` is the document stating that credits are not cash. I think the label meant `KB-CREDIT-001`. The case stays scored because an agent that cites both supplied documents satisfies it.
- **GEN-004 vs GEN-011:** both generations are still processing. GEN-004 is answered and GEN-011 escalates. The distinction is the reported duration (a prolonged stall is a technical incident under `KB-TECH-001`).
- **GEN-003 vs GEN-007:** both are completed generations the customer dislikes. The intent differs by whether the customer asks for credits back.
- **CAN-004:** the plan is already `cancel_pending`, but the label escalates. Confirming the cancellation would assert an execution state the agent cannot verify.
- **KB-003 vs KB-009:** a real refund-eligibility question with the refund document missing escalates; a hypothetical question about missing policy is answered from `KB-KNOW-001`.

## Review checklist

Applied to each case:

1. The record parses and passes the contract (the validator enforces this).
2. Intent matches what the customer is asking for, not the account state alone.
3. Decision follows `SYN-POLICY-1` precedence: identity and isolation, then no execution, then escalation, then distinct intents, then refund and failure-credit rules, then missing context, then knowledge provenance.
4. Route matches the team that would own the decision.
5. A proposed action appears only when the policy permits a human-review proposal, and never as an executed action.
6. `mustEscalate` agrees with the decision.
7. Required citations are supplied to the agent and relevant to the decision.
8. No real names, contact details, or credentials appear (the validator scans for these).

## Decision log

| Date       | Decision                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| 2026-10-13 | Keep v1 byte-for-byte. Record notes and the GEN-012 dispute in `review.v1.json` instead of editing labels.   |
| 2026-10-13 | Keep GEN-012 scored. Revisit in a future dataset version that also aligns the `PRO-*` account subscriptions. |

## What would change the status

`humanReviewStatus` moves past `starter_labels_not_independently_adjudicated` only after at least two people label at least 20 cases independently, disagreements are adjudicated, and raw agreement plus a confusion table are published. Agreement between annotators is not evaluator accuracy, and the public v1 cases are not a holdout set.
