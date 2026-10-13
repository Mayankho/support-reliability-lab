# Contributing

These are the working standards for this repository. Requirements live in [`docs/TECHNICAL_SPEC.md`](docs/TECHNICAL_SPEC.md), milestone status in [`docs/ROADMAP.md`](docs/ROADMAP.md), and the reasoning behind design choices in [`docs/DECISIONS.md`](docs/DECISIONS.md). Setup is in the [README](README.md).

## Non-negotiables

1. **Offline and free by default.** Tests, the demo, and CI make no paid API calls and use no real accounts. A model-backed adapter is an optional, separately approved stage with an explicit budget.
2. **Proposed is not executed.** There is no refund, cancellation, credit-restoration, or account-change executor. Code and copy never claim one of those actions completed.
3. **Gold labels stay with the evaluator.** `expected` fields never reach the agent adapter, a model prompt, a client-visible endpoint, or an untrusted trace.
4. **Graders are independent.** A grader compares agent output to human-authored labels. It never scores by calling the same policy logic that produced the answer.
5. **Datasets are immutable.** Each dataset version has a manifest and a SHA-256 digest. Changing cases means a new version. Gold labels are never edited to make an agent pass.
6. **The gate fails closed.** A grader error, timeout, missing result, or unevaluated mandatory case yields `ERROR` or `BLOCK`, never `PASS`. A `PASS` under those conditions is a severity-one defect.
7. **Synthetic data only.** No real PII. Logs and traces are redacted. Tenant isolation is enforced in the API and covered by tests.
8. **The synthetic policy is authoritative.** Behavior changes go through the policy and a versioned decision, never through quiet test edits.

## Workflow

- One roadmap milestone per pull request, kept as small as it can be while still standing on its own.
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).
- Before opening a PR, run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, and `pnpm test`. Fix real failures; don't skip or weaken tests.
- Pin dependencies exactly and check engine and peer ranges before adding one.
- Update `docs/ROADMAP.md` status when a milestone closes, and add an entry to `docs/DECISIONS.md` for any choice a reviewer would otherwise have to guess at.

### Pull request description

- What changed, by file or area
- Dependencies added and why
- Commands run, with their actual exit codes and results
- Which acceptance criteria are met and which are not
- Security and gold-label isolation checks
- Assumptions, tradeoffs, and open questions

## Code standards

- Validate every network, fixture, and persisted JSON boundary with a runtime schema (Zod).
- Prefer discriminated unions with exhaustive `never` checks.
- SQL uses bound parameters and explicit transactions. Concurrent run-status transitions are protected by row locks or leases plus unique constraints.
- Every bug fix includes a regression test. Every rule has pass, fail, and error-path tests.
- Metrics state their denominators and are labeled synthetic. They are never presented as production measurements.
- Comments explain constraints the code cannot show, not what the next line does.
