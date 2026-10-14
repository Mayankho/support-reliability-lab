# Roadmap

The build is split into ten milestones, each small enough to review as one pull request. Each milestone lists what it delivers and the check that closes it. Requirements behind each milestone are in [`TECHNICAL_SPEC.md`](./TECHNICAL_SPEC.md). Design choices are recorded in [`DECISIONS.md`](./DECISIONS.md).

| #   | Milestone                               | Status |
| --- | --------------------------------------- | ------ |
| 00  | Scaffold, local environment, and health | Done   |
| 01  | Domain and policy contracts             | Done   |
| 02  | Dataset integrity and 80-case fixtures  | Done   |
| 03  | Deterministic reference agent           | Done   |
| 04  | Independent grading                     | Done   |
| 05  | Persistence and worker                  | Done   |
| 06  | Comparisons, gates, and reports         | Done   |
| 07  | Validated HTTP API                      | Done   |
| 08  | CI and telemetry                        | Done   |
| 09  | Review UI and authenticated API (P1)    | Done   |
| 10  | Documentation and walkthrough           | Done   |

## 00 — Scaffold, local environment, and health

pnpm workspace with Node 24 constraints, a Fastify app exposing `GET /health/live`, Vitest, lint, format and typecheck scripts, Docker Compose for PostgreSQL, `.env.example`, and a GitHub Actions workflow. TypeScript runs in strict mode. There is no model or payment integration.

**Closed by:** a fresh `pnpm install`, `pnpm typecheck`, and `pnpm test` pass; liveness responds locally; `docker compose up -d db` starts a healthy database.

## 01 — Domain and policy contracts

Zod schemas for agent input and output, a typed agent interface, the fictional `SYN-POLICY-1` registry, structural no-execution guards, and KB document IDs, versions, and SHA-256 hashes.

**Closed by:** contract tests for invalid values, missing context, and policy hashes, plus a policy README that explains precedence.

## 02 — Dataset integrity and 80-case fixtures

Load `fixtures/golden_cases.v1.jsonl`, validate schema and IDs, assert category and critical-case coverage, and verify the manifest SHA-256. Validation never regenerates gold labels. Starter labels are reviewed, and any disagreement with the synthetic policy is resolved through a versioned decision rather than an edit to make a test pass.

**Closed by:** `pnpm eval:validate-data` passes, and changing one byte of the fixture without a new manifest fails.

## 03 — Deterministic reference agent

An `AgentAdapter` that receives only the message, account context, and supplied policy documents. `reference-v1`, `regression-demo-v1`, and `repaired-v1` are separate code versions. The regression version contains a genuine defect, not a hard-coded result.

**Closed by:** behavioral tests, including explicit unauthorized-action tests.

## 04 — Independent grading

Critical, workflow, and grounding graders in a package separate from the agent. Graders compare outputs to gold labels and never call the agent's policy logic. Failures carry evidence and severity rather than a bare 0 or 1.

**Closed by:** tests for schema failures, missing KB documents, grader exceptions, and lexical false-completion detection; the regression version is blocked on a case where the reference version is not.

## 05 — Persistence and worker

Migrations, dataset import, a run worker using `FOR UPDATE SKIP LOCKED`, bounded concurrency, leases, idempotent result inserts, and trace and audit events. A completed run does not imply a passing gate.

**Closed by:** simulated worker interruption and duplicate delivery produce no duplicate case results or counts.

## 06 — Comparisons, gates, and reports

Baseline and candidate compatibility checks, a paired case diff, gate rules and thresholds, and `gate.json`, `run-report.json`, and `run-report.html`. Any unknown rule outcome blocks.

**Closed by:** `pnpm demo` runs pass, block, and pass on the frozen dataset and writes real artifacts.

## 07 — Validated HTTP API

Documented endpoints with request validation, pagination, stable error bodies, and read-only case details. The P0 server binds to localhost. Run and case IDs are opaque, and errors never include secrets.

**Closed by:** a Fastify inject suite covering every route and error class.

## 08 — CI and telemetry

GitHub Actions for tests, dataset integrity, and the evaluation gate; log redaction; trace and latency counters; a scripted alert example. No external model calls.

**Closed by:** green CI on `main`, plus a separate job showing the intentional regression blocked.

## 09 — Review UI and authenticated API (P1)

React and Vite screens for run overview, paired comparison, failure inspection, and the release decision. A local JWT issuer with signature, issuer, audience, and expiry validation via `jose`, scoped reads, and cross-tenant negative tests.

**Closed by:** a Playwright test of the failure drilldown, and unauthorized access rejected.

## 10 — Documentation and walkthrough

README with architecture, setup commands, an example trace, screenshots, a five-minute walkthrough, design tradeoffs, limitations, run hashes, and source commit links.

**Closed by:** a clean-container clone works without keys, and every statement is verifiable and labeled synthetic.

## Additive: ticket analysis

A separate package, `packages/ticket-analysis`, for triaging synthetic support conversations against a versioned issue taxonomy and for mapping what the 80 golden cases cover. It is not part of the release gate. No core package imports it, and the v1 dataset, labels, contracts, and gate are unchanged. Design notes are in ADR-019 onward.

| #   | Step                                               | Status  |
| --- | -------------------------------------------------- | ------- |
| T01 | Taxonomy registry and coverage crosswalk           | Done    |
| T02 | Thread parsing on synthetic conversations          | Next    |
| T03 | Conservative classification and independent flags  | Planned |
| T04 | Gap-driven synthetic case pack (only if warranted) | Planned |
| T05 | Demonstration and an optional local-only import    | Planned |

**T01:** a byte-pinned registry (15 domains, 67 issue types, 80 diagnostic options, 9 risk flags) with recomputed counts and referential checks, and a draft crosswalk from each golden case to candidate issue types, flags, and the safety boundary it exercises. _Closed by:_ registry and crosswalk validation tests, and a generated crosswalk document that a test keeps in sync.

**T02:** group message records into threads with deterministic ordering, report anomalies instead of hiding them, separate customer turns from agent replies, and strip quoted history. _Closed by:_ tests for ordering, duplicates, missing customers, agent-only threads, and malformed records rejected without echoing values.

**T03:** classify the customer's central current need with one optional secondary issue, detect risk flags independently, confirm a diagnostic option only from trusted synthetic state, and abstain when the rules do not apply. _Closed by:_ tests for opposite primary issues on the same facts, body-versus-subject conflicts, flags under a benign primary, ambiguous refunds, unsupported languages, and prompt injection.

**T04:** author new cases only for gaps the crosswalk shows, in a separately versioned dataset with independently reviewed labels. _Closed by:_ a reviewed pack that runs separately from the v1 gate, or a documented decision not to author one yet.

**T05:** `pnpm tickets:demo` on invented conversations, showing grouping, classification, flags, unconfirmed root causes, redaction, and the difference between what a customer reports and what synthetic state confirms. _Closed by:_ the demo in CI with a self-check that no secret appears in its output.

## Open questions

- The starter gold labels had one single-reviewer pass in milestone 02 (`docs/dataset/ANNOTATION_REVIEW.md`). Independent double annotation and adjudication have not happened, so `humanReviewStatus` stays `starter_labels_not_independently_adjudicated`. GEN-012's required citation is disputed and should be corrected in a future dataset version.

## Invariants

These hold for every milestone:

- Real model APIs and network integrations stay off unless explicitly approved as a separate, budgeted stage.
- No real money, production data, or external user accounts are touched.
- Fixture labels that disagree with the synthetic policy are corrected through a reviewed, versioned change.
- A gate that reports `PASS` with missing results or grader errors is a severity-one defect.
