# Implementation progress

A running log of what has been verified, what remains, and the next concrete step. Status per milestone is also in [`ROADMAP.md`](./ROADMAP.md); reasoning is in [`DECISIONS.md`](./DECISIONS.md).

## Current position

- **Last completed milestone:** 04, independent grading.
- **Next action:** milestone 05. Add `@srl/db` (Drizzle schema and migrations on Compose Postgres) and a leased worker in `@srl/runner` with idempotent `(run_id, case_id)` results, interruption and duplicate-delivery tests.

## Log

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
