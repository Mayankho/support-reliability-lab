# Implementation progress

A running log of what has been verified, what remains, and the next concrete step. Status per milestone is also in [`ROADMAP.md`](./ROADMAP.md); reasoning is in [`DECISIONS.md`](./DECISIONS.md).

## Current position

- **Last completed milestone:** 03, deterministic agent versions.
- **Next action:** milestone 04. Build `@srl/evals` graders for the twelve rule IDs, independent of `@srl/agent`, with pass, fail, and error tests for each.

## Log

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
