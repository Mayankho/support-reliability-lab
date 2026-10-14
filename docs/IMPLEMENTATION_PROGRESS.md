# Implementation progress

A running log of what has been verified, what remains, and the next concrete step. Status per milestone is also in [`ROADMAP.md`](./ROADMAP.md); reasoning is in [`DECISIONS.md`](./DECISIONS.md).

## Current position

- **Last completed milestone:** 09, review UI and authenticated API.
- **Next action:** milestone 10. A five-minute walkthrough with screenshots, an evidence index that maps claims to files, tests, and commits, an example trace, and a fresh-clone check that the documented commands work without keys.

## Log

### Milestone 09: review UI and authenticated API

- Added `AUTH_MODE=jwt`: bearer tokens verified with `jose` against a local JWKS file (ES256 only, issuer, audience, expiry, subject), claims validated with Zod, one generic `401` with a `Bearer` challenge. Workspace comes only from the token; `viewer` reads, `reviewer` also enqueues and sees expected values. Local mode is refused in production and never shows gold labels. `pnpm auth:init` and `pnpm auth:token` provide a local test issuer.
- Added `apps/web`: React 19 and Vite 8 views for run overview, comparison, case detail, and release decision, with Zod-validated responses, hash routes, a token field, and keyboard and screen-reader support. Case detail now lists trace spans in execution order.
- Tests: 13 JWT unit tests (missing, valid, expired, wrong issuer or audience, unknown key, unsigned, HMAC, missing or malformed workspace, unknown role, viewer enqueue `403`), 4 JWT integration tests on real data (workspace scoping, cross-tenant `404` on run, cases, case, gate, and compare, reviewer-only labels, enqueue into the token workspace), UI formatting unit tests, and 4 Playwright tests run against a database filled by `pnpm demo`. All passed locally, and CI gained an `e2e` job.
- Fixed while testing: a lint finding that account values could render as `[object Object]`, now formatted explicitly with a test.

### Milestone 08: CI and telemetry

- Main CI now gates `reference-v1`, runs `pnpm demo` and `pnpm alerts:check`, scans tracked files and artifacts, and uploads `artifacts/`. A manual `regression-demo.yml` workflow produces the intentionally red BLOCK build.
- Added `@srl/telemetry`: Pino logger with shared redaction, OpenTelemetry tracing and metrics (off by default), bounded-label counters, and source-controlled alert rules. The worker emits `eval.run`, `eval.case`, `agent.invoke`, `grader.evaluate`, `db.persist`, and `gate.compute` spans, stores the run's trace ID on each case result, and logs structured JSON.
- Added `pnpm alerts:check` (fires on the blocked regression with case and trace evidence, resolves on the repair, writes an incident report) and `pnpm scan:sensitive` (0 findings across 190 tracked and generated files).
- Rehearsed the CI sequence locally on a fresh database: migrate, seed, reference gate (PASS), demo, alerts (0 open), and scan all exited 0; the regression workflow's gate exited 1 as intended.
- Tests: 7 telemetry unit tests (redaction, no-op mode, parent and child spans, bounded labels, alert firing and resolution, staleness, error spike, latency), a tracing integration test (one trace per run with 80 spans of each kind, no customer text), an alert integration test over the demo timeline, scanner unit tests, and a plain-Node load test for the API.

### Milestone 07: validated HTTP API

- Implemented every spec endpoint in `apps/api` with strict Zod validation, opaque IDs, keyset and case-key cursors, a single error body, correlation IDs, a JSON-only 16 KiB body limit, and a per-workspace rate limit on run creation. `contracts/openapi.yaml` now describes the implemented API.
- Added `pnpm worker`, which processes queued runs and records each gate (using the run's baseline when set).
- 27 API integration tests through Fastify inject on Postgres, covering each route and the 400, 404, 409, 413, 415, 422, 429, 500, and 503 paths, workspace masking, pagination, filters, and the absence of gold labels in case detail. One more runner integration test covers gating against a baseline and failing closed on an unfinished one.
- Verified by hand against the running server: readiness, enqueue (202), gate before processing (409 `RUN_NOT_FINISHED`), `pnpm worker -- --once` (completed, gate PASS), then the gate and case detail over HTTP.

### Milestone 06: comparisons, gate, and reports

- Added report building, metrics, comparison, the fail-closed gate, and HTML rendering to `@srl/evals`; report building from Postgres, `pnpm eval:run`, `pnpm eval:gate`, and `pnpm demo` to `@srl/runner`.
- Observed locally: `pnpm demo` exited 0 with reference-v1 PASS (80/80), regression-demo-v1 BLOCK (`critical:NO_FALSE_COMPLETION` on REF-001, -002, -003, -010, -011 plus matching `regression:new_critical` blockers), repaired-v1 PASS, all on dataset sha256 `e02ae60e…cf1d`. `eval:run` exits 0 on PASS and 1 on BLOCK; `eval:gate` returned ERROR (exit 1) for a report with one rule result removed.
- 17 gate unit tests (missing results or rules, errored rules, invalid or tampered reports, dataset mismatch, thresholds, must-escalate recall, incompatible and incomplete baselines, new regressions, fixed cases, latency above and below the noise floor) and 5 demo integration tests (pattern, blockers, artifact validity, single gate record, HTML escaping).

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
