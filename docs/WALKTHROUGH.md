# Five-minute walkthrough

A guided path through the project, for a reviewer with a terminal open or for a live screen share. Each step names the command to run, the file to open, and what to notice. Everything shown is synthetic: the customers, accounts, policy, and outcomes are invented, and nothing reflects production data.

Setup, if you want to follow along (about two minutes on a warm machine; see the [README quick start](../README.md#quick-start)):

```bash
pnpm install --frozen-lockfile
cp .env.example .env && docker compose up -d db
pnpm db:migrate && pnpm seed
```

## 0:00 – The problem (30 seconds)

A support agent can produce a reply that reads well and still breaks a rule that matters. The case in this repo is a refund. The agent is allowed to _propose_ a refund review. It must never tell the customer the refund already happened, because nothing in the system can issue one.

The question the project answers: **would a release process catch that before customers saw it?**

## 0:30 – Watch the gate catch it (90 seconds)

```bash
pnpm demo
```

Three agent builds run against the same 80 frozen cases (dataset sha256 `e02ae60e…cf1d`):

| Build                | Gate  | What to notice                                                    |
| -------------------- | ----- | ----------------------------------------------------------------- |
| `reference-v1`       | PASS  | 80/80 cases pass; must-escalate recall 23/23                      |
| `regression-demo-v1` | BLOCK | `NO_FALSE_COMPLETION` (critical) fails on 5 refund cases          |
| `repaired-v1`        | PASS  | the same 5 cases pass; no new failures versus the reference build |

The command exits 0 only if it observes that exact pattern on one dataset hash, so it fails if the gate ever stops catching the regression. Main CI runs it on every push.

Now open the defect, [`packages/agent/src/copy/regression-demo.ts`](../packages/agent/src/copy/regression-demo.ts). It is one copy entry:

```text
reference:  "...I can send it to our billing team for that review. Nothing has been refunded yet..."
regression: "Done! I've refunded your credit purchase to your original payment method..."
```

Every structured field stays correct (`proposedAction: request_refund_review`, `claimsActionCompleted: false`). Intent, decision, route, and citation accuracy are all still 100%. A dashboard of those metrics would show a healthy release. Only a grader that reads the reply text catches it.

The repair, [`packages/agent/src/versions/repaired-v1.ts`](../packages/agent/src/versions/repaired-v1.ts), restores the copy and turns on a guard ([`copy/guard.ts`](../packages/agent/src/copy/guard.ts)) that rejects completion wording at build time and on every reply.

## 2:00 – Drill into the evidence (60 seconds)

```bash
pnpm dev                     # API on 127.0.0.1:3000
pnpm --filter @srl/web dev   # UI on 127.0.0.1:5173
```

1. **Runs**: the blocked run shows 5 cases with critical failures and the blocker list.
2. **Release decision**: BLOCK, with the agent source hash, source commit, dataset and policy hashes, evaluator version, and every blocker linked to its case.
3. **REF-001**: the customer message, the account context, and the reply. The failed rule carries the evidence code `affirmative_completion_language` with the offending phrase. The trace lists `eval.case`, `agent.invoke`, and `grader.evaluate` under one trace ID.
4. **Compare**: 5 new failures versus the reference build, 0 fixed, 0 execution errors.

Screenshots of each view are in the [README](../README.md#what-the-demo-shows).

## 3:00 – Why the result can be trusted (60 seconds)

These are the properties that matter, each with the file or test that enforces it:

- **The agent never sees the answers.** Agent input is built from the message, account context, and supplied policy documents only. The database serves it from a view with no label columns. A spy adapter test asserts that no gold label, rationale, or forbidden-claim list reaches the agent (`packages/runner/src/suite.test.ts`).
- **Graders are independent of the agent.** `packages/evals` cannot import the agent or the policy implementation. A boundary test fails the build if it does (`packages/evals/src/boundary.test.ts`).
- **The gate fails closed.** A grader exception, timeout, missing rule, missing case, unfinished run, tampered report, or mismatched dataset produces `ERROR`, never `PASS` (`packages/evals/src/gate/gate.test.ts`). `BLOCK` means the evidence is complete and shows a problem.
- **Evidence cannot be edited after the fact.** Postgres triggers reject updates and deletes on stored cases, results, rule results, traces, and audit rows, and allow a single gate record per finished run (`packages/db/migrations/0001_evidence_guards.sql`, tested in `packages/db/src/schema.int.test.ts`).
- **Concurrent workers count each case once.** Jobs are leased with `FOR UPDATE SKIP LOCKED`, results are unique on `(run_id, case_id)`, and tests cover interruption, stale leases, duplicate delivery, and code changed after enqueue (`packages/runner/src/worker.int.test.ts`).

## 4:00 – Operating it (40 seconds)

- **CI** (`.github/workflows/ci.yml`) gates `reference-v1`, runs the demo, checks alerts, scans for secrets, and runs the browser tests. The deliberately red build is a separate manual workflow (`regression-demo.yml`), so main stays green without hiding the failure.
- **Alerts**: `pnpm alerts:check` fires `CRITICAL_RULE_FAILURE` on the blocked run with the first failing case and its trace ID, resolves it when the repaired run passes, and writes an incident report.
- **Access**: with `AUTH_MODE=jwt`, the workspace comes only from a verified ES256 token. Other workspaces' runs return `404`, and expected values are shown only to an authenticated reviewer.

## 4:40 – What this does not prove (20 seconds)

The suite is 80 synthetic cases with single-reviewer starter labels, and one label (GEN-012) is disputed. The agents are rule-based, so latency and cost are not meaningful. Thresholds are illustrative. A green gate here says the candidate behaves like the reference on these cases. It says nothing about production accuracy, customer satisfaction, or deflection. More in the [README limitations](../README.md#limitations).
