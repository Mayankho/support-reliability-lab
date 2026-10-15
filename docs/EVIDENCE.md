# Evidence index

Each claim the project makes, where it is implemented, the test or command that proves it, and the commit that introduced it. Commit links point to [github.com/Mayankho/support-reliability-lab](https://github.com/Mayankho/support-reliability-lab). The last section records the observed results of a clean-environment run.

All data is synthetic. Results describe behavior on 80 invented cases and are not measurements of any production system.

[4facb37]: https://github.com/Mayankho/support-reliability-lab/commit/4facb37
[9ab5d5a]: https://github.com/Mayankho/support-reliability-lab/commit/9ab5d5a
[417d5af]: https://github.com/Mayankho/support-reliability-lab/commit/417d5af
[f4e9b66]: https://github.com/Mayankho/support-reliability-lab/commit/f4e9b66
[90414f3]: https://github.com/Mayankho/support-reliability-lab/commit/90414f3
[5104a6e]: https://github.com/Mayankho/support-reliability-lab/commit/5104a6e
[fd4b2d5]: https://github.com/Mayankho/support-reliability-lab/commit/fd4b2d5
[c4e81ff]: https://github.com/Mayankho/support-reliability-lab/commit/c4e81ff
[67297ea]: https://github.com/Mayankho/support-reliability-lab/commit/67297ea
[7cdcd55]: https://github.com/Mayankho/support-reliability-lab/commit/7cdcd55
[41e790b]: https://github.com/Mayankho/support-reliability-lab/commit/41e790b
[b74e76b]: https://github.com/Mayankho/support-reliability-lab/commit/b74e76b
[5b89a68]: https://github.com/Mayankho/support-reliability-lab/commit/5b89a68
[84c6325]: https://github.com/Mayankho/support-reliability-lab/commit/84c6325
[edad02e]: https://github.com/Mayankho/support-reliability-lab/commit/edad02e
[b316608]: https://github.com/Mayankho/support-reliability-lab/commit/b316608

## Agent behavior: routing, escalation, and billing guardrails

The reference agent is deterministic and rule-based on purpose. The point is the evaluation harness around it, and a deterministic agent makes every regression reproducible.

| Claim                                                                                        | Implementation                                                             | Proof                                                                                        | Commit      |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------- |
| Agents propose protected actions and never execute them                                      | `packages/policies/src/no-execution.ts`, `packages/contracts/src/agent.ts` | `packages/policies/src/no-execution.test.ts`                                                 | [417d5af][] |
| Synthetic policy precedence is explicit and pinned by hash                                   | `packages/policies/src/precedence.ts`, `registry.ts`                       | `precedence.test.ts`, `registry.test.ts` (hashes locked to file bytes)                       | [417d5af][] |
| Unauthenticated or cross-workspace callers never get a protected action                      | `packages/agent/src/plan.ts`, `signals.ts`                                 | `packages/agent/src/agent.test.ts` (identity, isolation, prompt injection)                   | [90414f3][] |
| Agent code cannot import network modules or call `fetch`                                     | `packages/agent/src/`                                                      | `packages/agent/src/boundary.test.ts` ("has no network access")                              | [5b89a68][] |
| Citations are limited to documents the agent was given                                       | `packages/agent/src/citations.ts`                                          | `agent.test.ts`; `POLICY_CITATIONS` grader                                                   | [90414f3][] |
| Critical must-escalate cases are escalated                                                   | `packages/agent/src/plan.ts`                                               | `pnpm demo`: must-escalate recall 23/23 for all three builds                                 | [90414f3][] |
| The intentional regression is one copy entry, and the repair adds a completion-wording guard | `copy/regression-demo.ts`, `versions/repaired-v1.ts`, `copy/guard.ts`      | `packages/agent/src/versions.test.ts` (repaired-v1 refuses to build with the defective copy) | [90414f3][] |

## Evaluation design

| Claim                                                                                | Implementation                            | Proof                                                                                                              | Commit                   |
| ------------------------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| Twelve rules, each with pass, fail, and not-applicable paths                         | `packages/evals/src/graders/rules.ts`     | `rules.test.ts`                                                                                                    | [5104a6e][]              |
| Completion claims are detected in reply text, including negation and quotes          | `graders/completion-language.ts`          | `completion-language.test.ts` (negation, quotes, conditionals, questions; "won't" regression)                      | [5104a6e][]              |
| A grader error, timeout, missing grader, or duplicate grader is an error, not a pass | `packages/evals/src/grade-case.ts`        | `grade-case.test.ts`                                                                                               | [5104a6e][]              |
| Graders cannot import the agent or the policy implementation                         | package boundaries                        | `packages/evals/src/boundary.test.ts`, `packages/agent/src/boundary.test.ts`                                       | [5104a6e][]              |
| Gold labels never reach the agent                                                    | `toAgentVisibleInput`, `case_inputs` view | `packages/runner/src/suite.test.ts` (spy adapter), `packages/db/src/schema.int.test.ts` (view has no label column) | [5104a6e][], [fd4b2d5][] |
| Metric denominators are distinct cases, not rule rows                                | `packages/evals/src/report/metrics.ts`    | `worker.int.test.ts` ("counts a case with several failing rules once")                                             | [fd4b2d5][]              |

## Release gating

| Claim                                                                                            | Implementation                                   | Proof                                                                                                                                                         | Commit                   |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `ERROR` for incomplete or incompatible evidence; `BLOCK` for complete evidence showing a problem | `packages/evals/src/gate/gate.ts`                | `gate.test.ts` (missing results, unknown case ids, lowered case count, illegal not-applicable, severity downgrade, dataset mismatch, thresholds, regressions) | [c4e81ff][]              |
| Baseline comparison refuses mismatched datasets, policies, or evaluator versions                 | `gate/compare.ts`, `apps/api/src/routes/runs.ts` | `gate.test.ts`; `api.int.test.ts` (`409 INCOMPATIBLE_RUNS`)                                                                                                   | [c4e81ff][], [67297ea][] |
| `pnpm demo` exits 0 only on PASS, BLOCK, PASS over one dataset hash                              | `packages/runner/src/demo.ts`                    | `demo.int.test.ts`; main CI step                                                                                                                              | [c4e81ff][]              |
| Main CI fails if the reference build regresses or the gate stops catching the regression         | `.github/workflows/ci.yml`                       | CI steps `eval:run --agent reference-v1` and `pnpm demo`                                                                                                      | [7cdcd55][]              |
| The intentionally red build is reproducible on demand                                            | `.github/workflows/regression-demo.yml`          | manual workflow; rehearsed locally (gate step exit 1)                                                                                                         | [7cdcd55][]              |

## Persistence and concurrency

| Claim                                                                                   | Implementation                                                    | Proof                                                                                      | Commit      |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------- |
| Stored cases, results, rule results, traces, and audit rows cannot be edited or deleted | `packages/db/migrations/0001_evidence_guards.sql`                 | `schema.int.test.ts`                                                                       | [fd4b2d5][] |
| A finished run accepts exactly one gate record and no new results                       | same migration (`evaluation_runs_guard`, `case_results_run_open`) | `schema.int.test.ts`, `worker.int.test.ts` ("rejects results added after a run completed") | [fd4b2d5][] |
| Workers lease jobs without blocking each other and recover crashed leases               | `packages/db/src/queries/jobs.ts` (`FOR UPDATE SKIP LOCKED`)      | `worker.int.test.ts` (stale lease, attempt budget)                                         | [fd4b2d5][] |
| Duplicate delivery and resumed runs never double-count a case                           | `queries/results.ts` (`ON CONFLICT (run_id, case_id)`)            | `worker.int.test.ts` (interrupted run, two workers, same job)                              | [fd4b2d5][] |
| A run refuses to execute if agent code or dataset bytes changed after enqueue           | `packages/runner/src/worker.ts`                                   | `worker.int.test.ts`                                                                       | [fd4b2d5][] |

## API and access control

| Claim                                                                                                   | Implementation                            | Proof                                                                 | Commit                   |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------- | ------------------------ |
| Every body, query, and path parameter is validated; errors name fields, never values                    | `apps/api/src/routes/*.ts`, `errors.ts`   | `api.int.test.ts` (400, 404, 409, 413, 415, 422, 429, 500, 503 paths) | [67297ea][]              |
| Another workspace's run, cases, gate, or comparison returns `404`                                       | `apps/api/src/context.ts`                 | `api.int.test.ts` (local and JWT modes)                               | [67297ea][], [41e790b][] |
| Tokens are ES256, verified against local keys, with issuer, audience, and expiry required               | `apps/api/src/auth.ts`                    | `auth.test.ts` (13 cases, including unsigned and HMAC tokens)         | [41e790b][]              |
| Expected values are visible only to an authenticated reviewer                                           | `apps/api/src/routes/cases.ts`, `auth.ts` | `api.int.test.ts`; Playwright `review.spec.ts`                        | [41e790b][], [b74e76b][] |
| Configuration refuses external models, external calls, non-synthetic data, and local auth in production | `apps/api/src/config.ts`                  | `config.test.ts`                                                      | [9ab5d5a][], [41e790b][] |

## Observability and incident response

| Claim                                                                                           | Implementation                                             | Proof                                       | Commit      |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------- | ----------- |
| One trace per run with case, agent, grader, persist, and gate spans; no customer text           | `packages/telemetry/src/otel.ts`, `runner/src/worker.ts`   | `telemetry.int.test.ts`                     | [7cdcd55][] |
| Metric labels come from closed sets                                                             | `packages/telemetry/src/instruments.ts`                    | `telemetry.test.ts`                         | [7cdcd55][] |
| Logs redact tokens, connection strings, and message bodies                                      | `packages/telemetry/src/logger.ts`                         | `telemetry.test.ts`                         | [7cdcd55][] |
| Alerts fire on the blocked run with case and trace evidence, then resolve on the repair         | `packages/telemetry/src/alerts.ts`, `runner/src/alerts.ts` | `alerts.int.test.ts`; `pnpm alerts:check`   | [7cdcd55][] |
| Tracked files and generated artifacts contain no keys, tokens, contact details, or card numbers | `packages/dataset/src/scan.ts`                             | `scan.test.ts`; `pnpm scan:sensitive` in CI | [7cdcd55][] |

## Data integrity and labeling honesty

| Claim                                                                         | Implementation                        | Proof                                                                                      | Commit      |
| ----------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------ | ----------- |
| The fixture is byte-pinned: a one-byte change fails without a new manifest    | `packages/dataset/src/validate.ts`    | `validate.test.ts`; `pnpm eval:validate-data`                                              | [f4e9b66][] |
| Validation never echoes fixture text in errors                                | `packages/dataset/src/issues.ts`      | `validate.test.ts`                                                                         | [f4e9b66][] |
| Labels are disclosed as a single-reviewer pass, not independent adjudication  | `fixtures/annotations/review.v1.json` | `validate.test.ts` ("refuses to mark a single-reviewer pass as independently adjudicated") | [f4e9b66][] |
| The disputed GEN-012 label is recorded, still scored, and not silently edited | `docs/dataset/ANNOTATION_REVIEW.md`   | `validate.test.ts` ("records GEN-012 as disputed but still scored")                        | [f4e9b66][] |

## Review tooling

| Claim                                                                     | Implementation                                    | Proof                                                                        | Commit      |
| ------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------- | ----------- |
| Four views: run overview, comparison, case detail, release decision       | `apps/web/src/views/*.tsx`                        | `apps/web/e2e/review.spec.ts`                                                | [b74e76b][] |
| A reviewer can go from a blocked run to the failing case and its evidence | same                                              | Playwright: "drills from a blocked run to the failing case and its evidence" | [b74e76b][] |
| The UI shows recorded gates and never computes one                        | `apps/web/src/api.ts` (Zod-parsed responses only) | code review; ADR-018                                                         | [b74e76b][] |

## Ticket triage (additive, outside the gate)

| Claim                                                                                                         | Implementation                                        | Proof                                                                                        | Commit      |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------- |
| The taxonomy is byte-pinned, and its counts and references are recomputed, not trusted                        | `packages/ticket-analysis/src/taxonomy/validate.ts`   | `taxonomy.test.ts`; `pnpm tickets:validate-taxonomy` in CI                                   | [84c6325][] |
| Each golden case maps to candidate issue types and the boundary it tests, as a draft that cannot claim review | `data/crosswalk.v1.json`, `src/crosswalk/validate.ts` | `crosswalk.test.ts` ("rejects a reviewed record in a single-author draft"); doc kept in sync | [84c6325][] |
| The module never feeds the gate, and stays offline                                                            | package boundaries                                    | `packages/ticket-analysis/src/boundary.test.ts` (both directions)                            | [84c6325][] |
| Names and emails are dropped at parse time; bad records are rejected without echoing values                   | `src/thread/parse.ts`                                 | `thread.test.ts`                                                                             | [edad02e][] |
| The same facts give opposite primary issues depending on the requested remedy                                 | `src/classify/triage.ts`                              | `triage.test.ts` ("makes PRC-01 primary for the same facts…")                                | [edad02e][] |
| Flags are independent of the issue type; `F-OUT` never comes from one report                                  | `src/classify/flags.ts`, `incident.ts`                | `triage.test.ts` ("sets F-SEC even when the primary issue is benign"), `incident.test.ts`    | [edad02e][] |
| A root cause is confirmed only by trusted synthetic state, and contradictions are recorded                    | `src/classify/state.ts`                               | `triage.test.ts` ("never confirms a cause from what the customer says")                      | [edad02e][] |
| Unsupported content and languages abstain instead of guessing                                                 | `src/classify/triage.ts`                              | `triage.test.ts` ("abstention and languages")                                                | [edad02e][] |
| The demo fails if any secret, name, email, or message text reaches its output                                 | `src/demo.ts`                                         | `demo.test.ts`; `pnpm tickets:demo` in CI before the scan                                    | [b316608][] |
| The private import cannot run by accident or write inside the repository                                      | `src/private/local-import.ts`                         | `local-import.test.ts` (permission flag, symlink escape, suppression, file modes, no wiring) | [b316608][] |

## Observed results

### Clean-environment run

Commit [`b316608`][b316608] was cloned from a git bundle into a new `node:24.21.0` container (Linux, aarch64), next to a new `postgres:16` container. The clone had no `.env`, no `node_modules`, no local keys, and no untracked files. Every command below ran there, in this order.

| Command                                               | Exit | Observed                                         |
| ----------------------------------------------------- | ---- | ------------------------------------------------ |
| `pnpm install --frozen-lockfile`                      | 0    |                                                  |
| `pnpm lint`                                           | 0    |                                                  |
| `pnpm format:check`                                   | 0    |                                                  |
| `pnpm typecheck`                                      | 0    | all packages                                     |
| `pnpm test`                                           | 0    | 447 unit tests                                   |
| `pnpm eval:validate-data`                             | 0    | 80 cases, 44 critical, sha256 `e02ae60e…cf1d`    |
| `pnpm tickets:validate-taxonomy`                      | 0    | 15 / 67 / 80 / 9, sha256 `3dd4e05a…9608`         |
| `pnpm tickets:coverage -- --check`                    | 0    | crosswalk document current                       |
| `pnpm db:migrate`, `pnpm seed`                        | 0    |                                                  |
| `pnpm test:integration`                               | 0    | 58 tests (db 8, runner 19, api 31)               |
| `pnpm eval:run -- --agent reference-v1`               | 0    | PASS                                             |
| `pnpm demo`                                           | 0    | PASS, BLOCK, PASS; agent source hashes unchanged |
| `pnpm alerts:check`                                   | 0    | 1 firing then resolved, 0 open                   |
| `pnpm tickets:demo`                                   | 0    | leak self-check clean                            |
| `pnpm scan:sensitive`                                 | 0    | 0 findings                                       |
| `playwright install --with-deps chromium`, `test:e2e` | 0    | 4 browser tests                                  |

The screenshots in `docs/images/` and the sample reports in [`docs/demo/`](demo/) come from the same check on commit [`5b89a68`][5b89a68], where `pnpm --filter @srl/web screenshots` also exited 0. Nothing in the UI, agents, graders, or gate has changed since, and the agent source hashes match.

An earlier run of this check, on the milestone 09 commit, caught a real problem: two Markdown files committed without Prettier formatting, which would have failed CI's format step. The fix was folded into that commit before anything was pushed.

### Pinned hashes

| Item                        | Value                                                              |
| --------------------------- | ------------------------------------------------------------------ |
| Dataset `v1` (80 cases)     | `e02ae60e86b80da3866098c0d731630d4e199cb11ebf40d78caa508f58e4cf1d` |
| Policy `SYN-POLICY-1`       | `ff92f6522d75dc500798a993d3f2a4b0ff96e02f06bb791c47a9227628838f6a` |
| Evaluator                   | `1.0.0`                                                            |
| `reference-v1` source       | `8fd5db7d3f767c2ba3acf6682392b082a814dc430e0765c460aa39c4dfe72a76` |
| `regression-demo-v1` source | `5050eb4fe893a13abfd96d078f4b6fc2bb2ce7d6fcfc2a1eae6951c3dd8dfa63` |
| `repaired-v1` source        | `40b49171ebec84e5d9cd1d23eb35cb6031485a1244b4afc44b02e9f6c57e00ea` |

Each agent source hash is a SHA-256 over the source files listed for that version in `packages/agent/src/registry.ts`, so a change to any of them produces a new hash and a new `agent_versions` row.

### Demo outcome

| Build                | Gate  | Cases (pass / fail / error) | Decision | Route | Must-escalate recall | Blockers                                                                                                      |
| -------------------- | ----- | --------------------------- | -------- | ----- | -------------------- | ------------------------------------------------------------------------------------------------------------- |
| `reference-v1`       | PASS  | 80 / 0 / 0                  | 80/80    | 80/80 | 23/23                | none                                                                                                          |
| `regression-demo-v1` | BLOCK | 75 / 5 / 0                  | 80/80    | 80/80 | 23/23                | `NO_FALSE_COMPLETION` on REF-001, -002, -003, -010, -011, each also a new regression versus the reference run |
| `repaired-v1`        | PASS  | 80 / 0 / 0                  | 80/80    | 80/80 | 23/23                | none                                                                                                          |

Latency is below the 10 ms comparison floor for every build, so the gate records `latency_not_comparable_below_floor` instead of a ratio. Cost is `$0.000000` with source `offline_zero`, because no model is called. A sample of the generated reports is in [`docs/demo/`](demo/).
