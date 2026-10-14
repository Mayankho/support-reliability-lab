# Architecture decision records

## ADR-001: pnpm workspace without a monorepo orchestrator

The repository is a pnpm workspace. Nx and Turborepo are out of scope for this size. The first milestone contains one package, `@srl/api`. Later milestones add `packages/*` only when they have code.

## ADR-002: Node 24.21.0 and TypeScript 5.9.3

`.nvmrc` pins Node 24.21.0, the Node 24 LTS patch verified while scaffolding. `engines.node` is `>=24 <25`.

TypeScript is 5.9.3, not 7.x. `typescript-eslint` 8.71.2 declares a peer range of `typescript >=4.8.4 <6.1.0`, so TypeScript 7 cannot be linted with the current toolchain. Compiler options stay strict, including `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, and `erasableSyntaxOnly`.

The API runs TypeScript directly with Node's type stripper (`node src/main.ts`). Imports use `.ts` extensions and `noEmit` is set, so there is no separate compile step.

## ADR-003: Fastify 5.12.5 and Zod 4.6.7

HTTP and environment parsing use Fastify 5 and Zod 4, matching the spec. Patch versions were taken from the registry on 2026-10-12 and checked against published engine ranges: Fastify 5.12.5 and Vitest 5.0.4 both require Node `^22.12.0 || ^24.0.0 || >=26`. The local default Node 23.11.0 is outside that range, so commands for this repo must run on Node 24.

## ADR-004: External models and network calls fail closed

`loadConfig` accepts only `MODEL_ENABLED=false` and `ALLOW_EXTERNAL_CALLS=false`. `USE_SYNTHETIC_FIXTURES` must be `true`. There is no model client, payment client, or outbound HTTP integration. Invalid configuration throws `ConfigError` and the process exits before `listen`. Error text names the field and does not repeat raw URL values, so a rejected database URL does not echo its password.

## ADR-005: PostgreSQL 16 is local-only and unused by the API

`compose.yaml` runs `postgres:16` bound to `127.0.0.1` with the synthetic credentials from `.env.example`. The host port defaults to 5432 and can be overridden with `POSTGRES_PORT` when that port is already taken. The API does not open a database connection yet. Readiness (`GET /health/ready`) waits until a database client exists. Liveness is `GET /health/live` and does not touch Postgres.

## ADR-006: The process binds to loopback

`start` listens on `127.0.0.1` only. P0 is a local demo and must not publish an unauthenticated API on a public interface.

## ADR-007: CI skeleton covers the checks that exist

`.github/workflows/ci.yml` runs install, lint, format check, typecheck, and unit tests on Node 24. Dataset validation, the evaluation gate, and the Postgres integration job arrive with later milestones. Those steps are omitted so main stays green instead of failing on commands that do not exist yet.

## ADR-008: Policy text stays in the fixture, contracts stay free of gold labels

`fixtures/synthetic_policy.v1.md` is the source for `SYN-POLICY-1`. `@srl/policies` parses that file and computes SHA-256 for the file bytes, each KB paragraph, and the global hard-rules sentence. Titles for `KB-TECH-001` and `KB-KNOW-001` are registry labels; those documents are in the fixture even though the spec's summary table names six of the eight.

`@srl/contracts` defines the agent input, agent output, and golden-case schemas. `toAgentVisibleInput` copies message, account, supplied policy docs, and a correlation id. It does not copy `expected`. The JSON Schema files remain in the top-level `contracts/` directory. The TypeScript package is `packages/contracts`.

`guardProposedAction` checks structured action fields only. It rejects a completion flag and a protected proposal without explicit confirmation. It does not execute an action, and it does not grade customer-reply wording. Reply checks stay with the independent graders.

## ADR-009: Dataset validation reads bytes, never rewrites them

`pnpm eval:validate-data` (`@srl/dataset`) hashes the exact fixture bytes before parsing, so line endings and whitespace count. It reports every problem it finds rather than stopping at the first, with stable codes sorted by line. Issue text carries schema paths, counts, and policy IDs only; it never echoes a fixture line, so a malformed record containing something sensitive does not end up in CI logs.

Beyond the manifest checks, two rules are stricter than the spec states. A required citation must be among the documents supplied to the agent, otherwise no agent could pass the case. A case may still have an empty document list, because that deliberately tests behavior when retrieval fails (KB-010). The validator also rejects lines containing email addresses, phone numbers, card-number-shaped digit runs, and common token formats. The fake `TEST_TOKEN_EXAMPLE` in SEC-006 is intentionally not token-shaped.

Gold-label review is recorded beside the data in `fixtures/annotations/review.v1.json` and summarized in `docs/dataset/ANNOTATION_REVIEW.md`. The validator refuses a review file that describes different bytes, misses a case, or claims independent adjudication the manifest does not. Labels I disagree with are logged as disputes, not edited. A correction requires a new dataset version and manifest.

CI now runs the validator, and the workflow pins `ubuntu-24.04` and the Node 24 major versions of the GitHub actions instead of the deprecated Node 20 ones.

## ADR-010: A rule-based agent, and a regression only reply-text grading can see

The agent under test (`@srl/agent`) is deterministic: keyword features from the message, then `SYN-POLICY-1` precedence over trusted account state. Every path ends in one reason code, and the decision, route, and proposed action are derived from that code. That makes inconsistent outputs (an escalation reason on a proposal, a proposal without confirmation) impossible by construction rather than something to test for.

The intentional regression is a copy change. In `regression-demo-v1`, the refund-review confirmation tells the customer the refund already happened, while every structured field stays correct. I chose this over a logic bug, such as dropping a security escalation, because it isolates the most important grader behavior: `NO_FALSE_COMPLETION` must read `customerReply` and not trust `claimsActionCompleted`. A logic regression would also be caught by `DECISION_MATCH`, which proves less. The repair restores the copy and adds a guard that refuses untruthful copy at build time and on every reply. That guard is the agent's own check; graders keep an independent implementation.

The agent's rules were written with the public v1 cases in view, and it agrees with all 80 labels on intent, decision, route, action, and required citations. That is agreement with a public development set, not accuracy. The agent's unit tests use newly written phrasings for every behavior, and the package boundary test keeps case IDs, gold-label fields, and grader rule names out of agent source.

## ADR-011: Graders are lexical, conservative, and fail closed

`@srl/evals` holds one grader per rule ID, depending only on `@srl/contracts`. A boundary test fails if it imports the agent or the policy package. Graders see the gold label, the trusted account state, the documents actually supplied, and the validated output. Nothing else.

Severity follows the spec's table, with two decisions made explicit. `DECISION_MATCH` is critical whenever either the label or the output involves a protected action, and high otherwise. `INTENT_MATCH` is high except on standard-risk cases. A case fails only on a critical failure; high-severity mismatches feed the 95% decision and route thresholds in the gate.

The false-completion detector is a deterministic pattern matcher, not a language model. It reads the reply sentence by sentence and clause by clause, so a negation only cancels a claim when it comes before the verb ("nothing has been refunded" passes, "I've refunded you and nothing else is needed" fails). Attributed quotes, questions, and conditionals are not claims. Vague completion wording ("done!", "went through") is treated as a claim, because an uncertain lexical result must not become a pass. The first version matched "I won't" as the verb "won"; the fix excludes contractions, and both sentences that exposed it are now regression tests.

Every way a rule can go unevaluated becomes an explicit `error`: adapter exception or timeout, schema-invalid output, grader exception or timeout, missing or duplicate grader. Grader exception messages are dropped so internal details cannot leak into evidence.

A small in-memory runner (`@srl/runner`) runs a real agent version over the dataset (persistence arrives in ADR-012). It builds agent input only through `toAgentVisibleInput`, passes the adapter a structured clone so it cannot alter what graders see, and enforces a per-case timeout. A spy-adapter test confirms no label, rationale, or forbidden-claim list ever reaches the adapter.

## ADR-012: Postgres holds the evidence, and the database enforces immutability

Persistence uses Drizzle ORM 0.45.4 with node-postgres 8.23.1 against Postgres 16, as the spec proposed. `drizzle-kit` generates the table migration from `packages/db/src/schema.ts`. A second, hand-written migration adds what the ORM cannot express:

- `case_inputs`, a view over `cases` without the gold-label column. The worker builds agent input from this view and loads labels with a separate query for grading.
- Triggers that reject `UPDATE` and `DELETE` on datasets, cases, agent versions, case results, rule results, trace events, and audit events.
- A run guard enforcing `queued → running → completed | errored | cancelled`. Once a run finishes it is frozen, except that its gate may be recorded exactly once. Results cannot be inserted unless the run is `running`.

Immutability is checked in the database, not only in application code, so a bug or an ad-hoc query cannot rewrite evidence.

`agent_versions` is unique on `(version, source_hash)`, not on the version label. If the code behind `reference-v1` changes, it gets a new row, and every run points at the exact source hash it executed. The worker refuses to start a run if the resolved agent's source hash differs from the one recorded at enqueue time (`agent_source_changed`), or if the stored dataset hash differs from the run's manifest hash.

The worker leases jobs with `FOR UPDATE SKIP LOCKED`. A job is claimable when queued, or when its lease has expired, which is how a crashed worker's job is recovered. The worker renews its lease after every case and stops as soon as renewal fails. Results are inserted with `ON CONFLICT (run_id, case_id) DO NOTHING` inside one transaction per case, together with that case's rule results and trace spans, so a retry or a duplicate delivery can never double-count. A job that exceeds its attempt budget (3) is failed and its run marked `errored`. `completed` means every case has a result. The gate is a separate field and stays empty until milestone 06 computes it.

Summary queries count `DISTINCT` cases; a case failing three rules is one failing case. A test sabotages a single case so it fails several critical rules and checks that the denominator counts it once.

Integration tests each create a fresh database (`srl_test_<random>`), migrate it, and drop it afterwards, so they never touch existing data. They run with `pnpm test:integration`, separate from the unit tests, and CI runs them in a job with a Postgres 16 service.

A plain-Node runtime test loads the runner's whole module graph with Node's type stripper, because Vitest's transformer accepts TypeScript syntax that the CLIs cannot run.

## ADR-013: The gate distinguishes ERROR from BLOCK and trusts nothing it did not compute

`computeGate` (`@srl/evals`) takes a run report as untrusted input and validates it with Zod first. A report that fails validation, including one with an unknown verdict, can only produce `ERROR`. The gate then recomputes every metric from case-level rule results; the report carries no precomputed numbers for it to trust.

- **ERROR** means the evidence is incomplete or cannot be compared: the run did not complete, results or rule rows are missing or duplicated, any rule errored, the report's dataset hash differs from the current fixture, or the baseline is incomplete or incompatible (different dataset, policy, evaluator version, or case set). An incompatible baseline yields ERROR, never a delta.
- **BLOCK** means the evidence is complete and shows a problem: any critical rule failure; decision or route accuracy below 95%; must-escalate recall below 100% on critical cases; and, against a compatible baseline, any new critical failure, an accuracy drop of more than 2 percentage points, or a p95 latency more than 1.3x the baseline.
- **PASS** requires complete evidence and none of the above.

Thresholds live in `packages/evals/src/gate/thresholds.ts` and are labeled as illustrative criteria for an 80-case synthetic suite. Two judgment calls are explicit. Latency is compared only when both p95 values are at least 10 ms; below that, sub-millisecond scheduler noise would make the 1.3x rule fire at random, so the gate records a warning instead. Cost is compared only when both runs have usable cost; the offline adapter's cost is a real $0, and a missing value is never treated as zero.

Every blocker names its rule and case (`critical:NO_FALSE_COMPLETION:REF-001`), and the HTML report links each blocker to that case's evidence: the synthetic message and account state, expected and actual fields, failing rules with severity and evidence, the trace ID, and a fix-layer hypothesis marked for human review. All text is HTML-escaped, and message text passes through a defensive redactor before it is written.

`pnpm demo` runs reference, regression, and repaired versions against one stored dataset, with the reference run as baseline for the other two. It records each gate on its run (once) and writes `gate.json`, `run-report.json`, and `run-report.html` per run, plus an index page. It exits 0 only if it observes PASS, BLOCK, PASS, the BLOCK includes a critical `NO_FALSE_COMPLETION` failure, and all three runs share one dataset hash. Nothing in the gate knows which agent version it is evaluating.

I did not commit a frozen baseline report. The gate already requires the dataset, policy, and evaluator version to match, so a committed baseline would go stale on any evaluator change and could not prove more than running the reference version fresh. `pnpm eval:gate --report … --baseline …` accepts any two report files for offline comparison.
