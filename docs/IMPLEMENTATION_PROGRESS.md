# Implementation progress

A running log of what has been verified, what remains, and the next concrete step. Status per milestone is also in [`ROADMAP.md`](./ROADMAP.md); reasoning is in [`DECISIONS.md`](./DECISIONS.md).

## Current position

- **Last completed milestone:** 05, persistence and worker.
- **Next action:** milestone 06. Pure gate and comparison logic over run reports, `gate.json`, `run-report.json`, `run-report.html`, `pnpm eval:run`, `pnpm eval:gate`, and `pnpm demo` asserting PASS, BLOCK, PASS on the same fixture.

## Log

### Milestone 05: persistence and worker

- Added `@srl/db`: Drizzle schema for the spec's nine tables, a generated table migration, and a hand-written migration with the `case_inputs` label-free view, append-only and immutability triggers, a run lifecycle guard, and a self-referencing baseline foreign key.
- Added the leased worker and run service to `@srl/runner`, plus `pnpm db:migrate` and `pnpm seed` (both idempotent; verified twice against a clean database).
- 8 schema and 11 worker integration tests on Postgres 16: migrations, idempotent import and same-version conflict, label-free view, immutable rows, lifecycle and single-gate rules, full run (80 results, 960 rule results), mid-batch interruption and resume, stale-lease recovery, duplicate delivery, attempt budget, code-changed and dataset-changed refusals, distinct-case denominators, no writes after completion, and no message text or connection details in audit, trace, or config records.
- Running the seed under plain Node exposed a TypeScript parameter property, which Node's type stripper rejects. Fixed, and added a test that loads the runner's module graph under plain Node.
- CI gained an integration job with a Postgres 16 service that migrates, seeds, and runs the integration suites.

### Milestone 04: independent grading

- Added `@srl/evals` with graders for all twelve rule IDs and a fail-closed `gradeCase` pipeline (`packages/evals/README.md`). 75 tests: pass, fail, and not-applicable paths per rule; a completion-language matrix covering negation, quotes, conditionals, questions, and vague wording; grader exception, timeout, missing, and duplicate graders; schema-invalid output and adapter failure.
- Added the in-memory part of `@srl/runner`. On the v1 suite: reference-v1 and repaired-v1 have zero critical failures and all 80 cases pass; regression-demo-v1 fails `NO_FALSE_COMPLETION` (critical) on exactly REF-001, REF-002, REF-003, REF-010, and REF-011, with `claimsActionCompleted` still false. A spy adapter confirms no gold-label fields reach the agent.
- Found and fixed a grader false positive: "I won't" matched the verb "won". Regression tests added.

### Milestone 03: agent versions

- Added `@srl/agent` with `reference-v1`, `regression-demo-v1`, and `repaired-v1` (`packages/agent/README.md`).
- The regression is one copy entry: the refund-review reply claims the refund happened while structured fields stay correct. The repair restores the copy and enables a build-time and runtime completion-wording guard.
- 76 agent tests: behavior on newly written inputs, identity and isolation (no protected action for unauthenticated or cross-workspace callers), prompt injection, citations limited to supplied documents, determinism, malformed input, version differences, and a package-boundary scan.
- Local check against the v1 labels (outside the test suite, since agents must not read labels): all three versions agree on intent, decision, route, action, and required citations for 80/80 cases. The difference between versions is only in reply text, which is what milestone 04 must catch.

### Milestone 02: dataset integrity

- Added `@srl/dataset` and `pnpm eval:validate-data`. The validator hashes the raw fixture bytes, validates the manifest and every record against the existing Zod contract, checks IDs, counts, coverage targets, policy references, and sensitive-looking values, and reports stable issue codes without echoing fixture text.
- Verified locally: the committed fixture passes (80 cases, 44 critical, SHA-256 `e02ae60e…cf1d`); a one-byte change, duplicate IDs, unknown policy IDs, unsupplied required citations, count mismatches, malformed JSON, schema violations, CRLF, blank lines, unreadable files, invalid manifests, and contact details all fail.
- Recorded a single-reviewer label pass in `fixtures/annotations/review.v1.json`: 55 consistent, 24 with notes, 1 disputed (GEN-012), 0 unscored. No labels changed.
- Root `typecheck` and `test` now run recursively across every workspace package, so new packages are included automatically.
- CI runs the validator. The workflow moved to the Node 24 versions of the GitHub actions.

### Milestones 00 and 01

- Workspace, configuration validation, liveness endpoint, Compose Postgres, CI; Zod agent and golden-case contracts, `SYN-POLICY-1` registry with SHA-256 hashes, structural no-execution guard.

## Environment notes

- Node 24.21.0 and pnpm 10.34.7. Docker is required from milestone 05.
- If another Postgres already listens on 5432, start the project database with `POSTGRES_PORT=5433 docker compose up -d db` and point `DATABASE_URL` at 5433.
