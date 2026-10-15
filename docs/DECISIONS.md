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

- **ERROR** means the evidence is incomplete or cannot be compared: the run did not complete, results or rule rows are missing or duplicated, any rule errored, a mandatory rule is marked not applicable, a rule severity or evaluator version is not the one that rule produces, case status disagrees with its rule results, the report's dataset hash differs from the current fixture, the report's case ids or scoring labels differ from that fixture, or the baseline is incomplete or incompatible (different dataset, policy, evaluator version, or case set). An incompatible baseline yields ERROR, never a delta. When a fixture is supplied, its case count and case ids are the membership that counts; the report's own `caseCount` is not. See ADR-023.
- **BLOCK** means the evidence is complete and shows a problem: any critical rule failure; decision or route accuracy below 95%; must-escalate recall below 100% on critical cases; and, against a compatible baseline, any new critical failure, an accuracy drop of more than 2 percentage points, or a p95 latency more than 1.3x the baseline.
- **PASS** requires complete evidence and none of the above.

Thresholds live in `packages/evals/src/gate/thresholds.ts` and are labeled as illustrative criteria for an 80-case synthetic suite. Two judgment calls are explicit. Latency is compared only when both p95 values are at least 10 ms; below that, sub-millisecond scheduler noise would make the 1.3x rule fire at random, so the gate records a warning instead. Cost is compared only when both runs have usable cost; the offline adapter's cost is a real $0, and a missing value is never treated as zero.

Every blocker names its rule and case (`critical:NO_FALSE_COMPLETION:REF-001`), and the HTML report links each blocker to that case's evidence: the synthetic message and account state, expected and actual fields, failing rules with severity and evidence, the trace ID, and a fix-layer hypothesis marked for human review. All text is HTML-escaped, and message text passes through a defensive redactor before it is written.

`pnpm demo` runs reference, regression, and repaired versions against one stored dataset, with the reference run as baseline for the other two. It records each gate on its run (once) and writes `gate.json`, `run-report.json`, and `run-report.html` per run, plus an index page. It exits 0 only if it observes PASS, BLOCK, PASS, the BLOCK includes a critical `NO_FALSE_COMPLETION` failure, and all three runs share one dataset hash. Nothing in the gate knows which agent version it is evaluating.

I did not commit a frozen baseline report (the CI decision is in ADR-015). The gate already requires the dataset, policy, and evaluator version to match, so a committed baseline would go stale on any evaluator change and could not prove more than running the reference version fresh. `pnpm eval:gate --report … --baseline …` accepts any two report files for offline comparison.

## ADR-014: The API enqueues and reads; it never runs agents or decides gates inline

The Fastify API (`apps/api`) exposes the endpoints from the spec: liveness and readiness, datasets, run enqueue, list, and detail, case results and case detail, paired comparison, the recorded gate, and workspace metrics. `contracts/openapi.yaml` documents the implemented behavior.

`POST /api/v1/evaluation-runs` validates and enqueues, then returns `202` with a `Location` header. A separate process, `pnpm worker`, leases the job, executes it, and records the gate when the run finishes, using the run's baseline when it has one. If that baseline is unfinished, the gate is ERROR. Keeping execution out of the request path means a slow or hung agent cannot hold an HTTP connection, and every result goes through the same leased, idempotent path as the CLI.

Request rules:

- Every body, query, and path parameter is parsed with a strict Zod schema. Unknown fields are rejected. Validation errors return `422` and name fields, never values.
- Bodies are JSON only, capped at 16 KiB. The default `text/plain` parser is removed, so other content types get `415` rather than reaching validation.
- Run IDs are opaque UUIDs. A malformed ID, a missing run, and another workspace's run all return the same `404`, so IDs cannot be probed.
- Every response carries `x-correlation-id`. A safe incoming value is echoed; anything else is replaced with a generated UUID.
- Unexpected failures return `500` with a fixed message. Only the error name and code are logged, so connection strings and stack traces never reach the client.
- Run creation is rate-limited per workspace with a fixed window, returning `429`.

Workspace scoping goes through one request hook. In local mode it resolves every request to `ws_demo`; milestone 09 replaces the resolver with verified JWT claims, without touching the routes. Case detail omits gold labels: expected values belong behind authenticated, reviewer-scoped access, which also arrives in milestone 09.

Compare refuses to report a delta for runs on different datasets, policies, or evaluator versions (`409 INCOMPATIBLE_RUNS`) and requires both runs to be completed.

The server binds to `127.0.0.1`. Unauthenticated local mode is not safe to expose on a network, and the docs say so.

## ADR-015: CI proves the gate on every push; the red build is a separate, manual workflow

The main workflow has two jobs. `check` runs lint, format, typecheck, unit tests, and dataset validation. `integration` starts Postgres 16, then migrates, seeds, and runs every integration suite, followed by:

1. `pnpm eval:run -- --agent reference-v1`, which exits 1 on BLOCK or ERROR, so a regression in the reference agent or the evaluator turns main red;
2. `pnpm demo`, which exits 0 only when it observes PASS, BLOCK, PASS, so main CI also fails if the gate ever stops catching the intentional regression;
3. `pnpm alerts:check`, which fails while any alert is open;
4. `pnpm scan:sensitive` over tracked files and the artifacts just generated;
5. uploading `artifacts/` only after `pnpm scan:sensitive` has completed successfully (ADR-023). A failed or skipped scan does not publish that directory.

The intentionally failing build lives in `regression-demo.yml`, triggered manually. It gates `regression-demo-v1` against a fresh reference baseline and is expected to end red with the BLOCK evidence uploaded. Main CI stays green without hiding anything, because the demo step already asserts that same block.

The full sequence was rehearsed locally on a fresh database before committing: the main-path commands all exited 0, and the regression workflow's gate step exited 1.

## ADR-016: Telemetry is OpenTelemetry for traces and counters, Pino for logs, and alerts come from recorded gates

`@srl/telemetry` wires the OpenTelemetry API and SDK (traces and metrics 2.12.0) and Pino 10. Telemetry is off unless enabled: with the `none` exporter nothing is registered and the API is a no-op, so tests and the demo pay nothing. The API honors `OTEL_EXPORTER=console`, and so does the worker. The demo and `eval:run` keep the console quiet.

- **Traces** follow the spec's chain within a worker attempt: `eval.run`, then per case `eval.case`, `agent.invoke`, `grader.evaluate`, `db.persist`, and finally `gate.compute`. When tracing is on, the trace ID stored on each case result is the OpenTelemetry trace ID, so a case in the API or a report links to its spans. Span attributes carry IDs, a hashed case key, statuses, codes, and durations. A test asserts that no customer text appears. API requests get an `http.request` span carrying the route and status.
- **Metrics** are the spec's counters and histogram: `eval_runs_total`, `eval_case_results_total`, `eval_rule_failures_total`, `eval_duration_ms`, `eval_gate_blocked_total`, `eval_worker_lease_recovery_total`, and `eval_dataset_integrity_errors_total`. Every label comes from a closed set (run status, case status, risk, rule ID, blocker category); anything else is bucketed as `other`. No run IDs are used as labels. `agent_estimated_cost_usd` records only reported usage, never an invented zero.
- **Logs**: the worker logs structured JSON. The shared redaction list censors authorization headers, cookies, tokens, passwords, connection strings, message bodies, and customer replies.

Alerts are evaluated from recorded gates (`pnpm alerts:check`) against rules in `packages/telemetry/src/alerts.ts`: `CRITICAL_RULE_FAILURE`, `RUN_ERROR_SPIKE`, `EVAL_STALE_OR_MISSING`, and `LATENCY_REGRESSION`. Runs that have a baseline form one candidate track, so a blocked candidate followed by a passing one reads as firing then resolved. The firing event links to the first failing case, rule, and trace ID. The command writes a Markdown incident report and exits 1 while any alert is open. Nothing is sent to Slack, email, or a webhook.

`pnpm scan:sensitive` scans tracked files and generated artifacts for private keys, common token formats, non-example email addresses, phone numbers, Luhn-valid card numbers, and connection strings with non-local passwords. It reports file, line, and kind, never the value. Four test files intentionally contain fake connection passwords to prove redaction; each is listed with the exact kind allowed, so any other finding in those files still fails.

## ADR-017: Tokens are verified locally with `jose`; local mode stays unauthenticated and says so

`AUTH_MODE` selects one of two principal resolvers behind the request hook from ADR-014, so no route changed.

- **`local`** (the default) resolves every request to `ws_demo` and marks the principal as unauthenticated. Configuration refuses it when `NODE_ENV=production`.
- **`jwt`** requires a `Bearer` token and verifies it with `jose` against a JWKS file named in configuration. Keys are never fetched from a URL, and nothing in the token header can choose the key source. Only ES256 is accepted, so unsigned (`alg: none`) and HMAC tokens fail even with valid-looking claims. Issuer, audience, expiry, and subject are required, with five seconds of clock tolerance. After signature checks, the claims are parsed with Zod: `workspace_id` must match `^ws_[a-z0-9_]{1,40}$` and `role` must be `viewer` or `reviewer`.

Every failure returns the same `401 UNAUTHENTICATED` with a `www-authenticate: Bearer` header. The response never says which check failed. Health endpoints stay open for probes.

Authorization is deliberately small:

- The workspace always comes from the verified token. Request bodies cannot name one, and another workspace's run, cases, gate, or comparison returns `404`, as in ADR-014.
- `viewer` can read; enqueueing a run requires `reviewer` and returns `403` before the body is read.
- Gold labels in case detail are diagnostic data, shown only to an authenticated `reviewer`. Local mode never shows them, because nobody in local mode has proven who they are.

`pnpm auth:init` writes a local ES256 key pair to the git-ignored `.local-auth/` (private key mode `0600`), and `pnpm auth:token` signs short-lived development tokens. This is a test issuer, not an identity provider. A real deployment would point `JWT_JWKS_FILE` at keys managed by its identity provider and add rotation, revocation, and a session layer, none of which exist here.

Covered by unit tests for missing, expired, wrong-issuer, wrong-audience, unknown-key, unsigned, HMAC, missing-workspace, malformed-workspace, and unknown-role tokens, and by integration tests on real data for workspace scoping, cross-tenant `404`s, reviewer-only labels, and enqueue into the token's workspace.

## ADR-018: The review UI is a thin, read-only client of the API

`apps/web` is React 19 and Vite 8 with four views: run overview (status, gate, metrics with denominators, a filterable case table), paired comparison, case detail (input, expected versus actual, rule results, trace, suggested fix layer), and release decision (gate status, blockers linked to their cases, thresholds, pinned hashes, source commit).

- **No logic of its own.** The UI shows the gate that the worker recorded; it never computes or reinterprets a verdict. Every response is parsed with Zod, so a contract drift shows as an error instead of a wrong number.
- **No router or state library.** Hash routes cover four views, and IDs are validated with the same patterns the API uses before any request is made. A small fetch hook handles loading, error, and `401` states.
- **Tokens stay in the tab.** In `jwt` mode the reviewer pastes a token, which is kept in `sessionStorage` and sent as a bearer header. The UI holds no keys and has no login flow, matching the scope in ADR-017.
- **Accessible by default.** Gate states carry words as well as color, tables use real headers, there is a skip link, focus moves to the main region on navigation, and the case filter works from the keyboard.

The Playwright suite builds the UI and creates a dedicated database. It fills that database with `pnpm demo`'s real three-run sequence rather than mocked responses. Then it starts the API in both auth modes and checks:

- the failure drilldown from a blocked run to `REF-001` and its `NO_FALSE_COMPLETION` evidence;
- the release decision and comparison;
- keyboard filtering;
- unauthenticated rejection (API `401` with a challenge, and a sign-in notice in the UI), a cross-tenant `404`, and expected values appearing only after a reviewer token is entered.

CI runs it as a separate job and uploads the Playwright report.

## ADR-019: The issue taxonomy lives in its own package and never feeds the gate

The ticket-analysis work answers different questions from the evaluator: what a customer currently needs, which risk flags apply, and which existing cases test the matching safety boundary. It lives in `packages/ticket-analysis`, and a boundary test enforces the separation in both directions. The package cannot import the agent, graders, database, runner, or telemetry, and none of those, nor the API or UI, may import it. The v1 dataset, its labels, the `GoldenCase` contract, and the gate denominators are unchanged.

Taxonomy issue types are not the agent's `Intent` enum. An issue type describes what a customer reported. An intent describes how the agent should behave under `SYN-POLICY-1`. The two are mapped only in the crosswalk, never in agent input.

**Registry.** `data/taxonomy.v1.1.json` holds definitions only: 15 domains, 67 issue types, 80 optional diagnostic options, and 9 risk flags, with no customer text, identifiers, contact details, or volumes. It is pinned by SHA-256 in a manifest, like the golden dataset. Validation recomputes every count rather than trusting the manifest. It checks that:

- every issue type has exactly one existing domain and a matching code prefix;
- every diagnostic option has an existing parent;
- every flag is defined, and every domain has exactly one tie-break rank;
- `Human only` scopes sit on human-led tiers, and route-out scopes on route-out tiers.

Owner, fix home, tier, priority, and automation scope are kept as provisional triage metadata. None of them is a permission, and the lab has no executor for any issue type.

**Crosswalk.** `data/crosswalk.v1.json` maps each of the 80 golden cases to a candidate primary issue type, an optional secondary, acceptable alternates, candidate flags, and the safety boundaries the case exercises (for example `no_false_completion` or `tenant_isolation`). One author wrote it, so the file is `draft_single_author`, and validation rejects any record marked reviewed. Coverage statuses are judgments about boundaries, not prevalence. Mappings the author is unsure of are `needs_review`, with alternatives listed, and one case (ADV-006) has no defensible issue type at all.

The gap list is chosen by boundary, not frequency. Of the ten gaps, two are better handled by ticket-analysis unit tests (multi-turn context and outage volume, which a single-message case cannot express), and eight are proposals for new cases that have not been written. `docs/TAXONOMY_COVERAGE_CROSSWALK.md` is rendered from the data, and a test fails if it is stale.

## ADR-020: Thread parsing reports problems instead of repairing them

`parseMessages` accepts a bounded array of records shaped like a helpdesk export (`ticket_id`, `thread_id`, `created_at`, author type, plan, language, channel, subject, body). It rejects each bad record individually by position and field: missing fields, wrong types, oversized bodies, unknown author roles, and timestamps that are not ISO 8601 or not real dates. Values are never echoed. Author names and email addresses are accepted so real-format input parses, then dropped immediately, so nothing downstream ever holds them.

`groupThreads` orders each thread by timestamp, then ticket ID, then input position, so the result does not depend on input order. It reports `input_out_of_order`, `timestamp_tie`, `duplicate_ticket_id` (the first record is kept), `missing_customer_message`, `starts_with_agent_message`, `inconsistent_metadata`, and `thread_too_long` rather than silently fixing them.

`stripQuotedHistory` separates what the customer wrote now from quoted lines, reply headers in four languages and everything after them, and signatures. `detectSecrets` finds key-shaped values, bearer and JWT-shaped tokens, stated passwords, and checksum-valid card numbers, and returns only their kinds. `redactForDisplay` replaces them, and email addresses, with typed placeholders.

## ADR-021: Classification is conservative, explainable, and abstains

`triageThread` follows the v1.1 taxonomy semantics. Each is a test, not just a comment:

- **Central current need.** The latest customer turn decides the primary issue type. An issue raised in a sentence that asks for something outranks one only mentioned. For a failed or stuck job that cost credits, the requested remedy decides: credits back makes `CRD-01` primary with `PRC-01` secondary, and finishing the job reverses them. The taxonomy's tie-break order is used only when both remedies are requested, and the triage is then marked for review.
- **Body before subject.** The subject fills in a body with no supported issue. When both match different issues, the body wins and `subject_body_conflict` is recorded.
- **Context.** Agent replies never define the customer's need, and an agent saying "I've refunded" is recorded as an unverified claim. A follow-up inherits the earlier need. A new need in the latest turn becomes primary, and the earlier one becomes secondary. Thanks for a fix is `FBK-03`; thanks followed by a new problem is that problem.
- **Independent flags.** `F-SEC`, `F-LEG`, `F-MON`, `F-CHB`, `F-REG`, `F-CHURN`, and `F-ENT` are decided separately from the issue type, so a secret pasted into a "thanks, it works now" message is still flagged. `F-LEG` needs a stated legal basis or deadline. `F-REG` needs a stated tax requirement and is never inferred from language. `F-ABUSE` needs account history and is never set. `F-OUT` comes only from five or more distinct threads with the same issue within an hour, so one complaint can never set it.
- **Evidence levels.** Every triage lists evidence by origin: `customer_reported`, `agent_claimed`, `verified_synthetic_state`, or `inferred_pattern`. Only caller-supplied synthetic state is verified. A diagnostic option (L3) is confirmed only by that state, never by what a customer asserts. When a report contradicts the state, the contradiction is recorded.
- **Abstention.** The rules cover a representative subset of issue types, not all 67. Content they do not cover is an abstention with `no_supported_rule_matched`, not `UNK-02`, because the classifier cannot claim that no issue type fits. An unsupported language is an abstention, though secrets are still flagged. A refund with no object (money or credits) is `UNK-01` with a clarification. No confidence numbers are produced.
- **No mutation.** The output carries the issue type's maximum automation scope and whether it typically involves a protected change. Nothing in the package can execute one, and a test checks the exports.

Review is required for abstentions, tie-breaks, subject conflicts, contradictions, authority claims, human-only issues, multiple protected requests, data-quality anomalies, and the `F-SEC`, `F-LEG`, and `F-CHB` flags.

`scoreAgreement` reports exact-primary agreement, acceptable-alternate agreement, secondary agreement, abstention, and per-flag precision and recall separately, each with its denominator and the label set's status. Against labels written by the rules' author, these numbers measure consistency with that author, not accuracy.

## ADR-022: The ticket demo is synthetic and self-checking; the private import is opt-in and outside the repo; no new cases yet

`pnpm tickets:demo` runs the whole path on 41 invented records in `packages/ticket-analysis/fixtures/`:

- parsing, including one deliberately malformed record, out-of-order records, and a duplicated record;
- grouping, triage, independent flags, and trusted synthetic state for five threads;
- an outage cluster that produces `F-OUT`, and a lone outage report that does not;
- agreement with an author-labeled development set.

It writes `artifacts/tickets/triage.json`, which holds codes only. Before exiting it checks that no secret value, name, email address, or message text from the input appears in its printed output or the artifact, and it exits 1 if one does. CI runs it before the sensitive-data scan, which then scans the artifact too. The demo labels are the rules author's own. The output says that agreement with them shows consistency, not accuracy, and it does not gate anything.

`src/cli/local-import.ts` is an optional aggregation of a real-format export, for local use by its owner. It is deliberately hard to run by accident:

- No package script, CI job, or demo references it, and a test checks that.
- It refuses to run without `--i-have-permission-to-process-this-file`.
- Input and output must be absolute paths outside the repository. Symlinks are resolved first, so a link cannot point back inside.
- It refuses a non-empty output directory, makes no network calls (the package boundary test forbids network modules), and holds raw text only in memory.
- The output is a single `summary.json` with mode `0600` in a `0700` directory. It contains aggregate counts by domain, issue type, flag, anomaly, and rejection code, with every count under ten suppressed, and no IDs or text.

Its tests use invented records in a temporary directory. It has not been run on any real data.

`.gitignore` and the sensitive-data scanner reduce the chance of committing private data, but they are not guarantees. The real protection is that nothing private is ever placed inside the repository.

**No new evaluation cases (T04).** The crosswalk proposes eight new cases for gaps the v1 suite does not exercise: an API 401 with a pasted key, rate limits, webhook retries, credits that never arrived, a pending hold versus a duplicate, a stuck job that is the central need, a deletion with a legal deadline, and a non-English ambiguous refund. None is authored yet. A new case needs expected behavior that someone other than its author has reviewed, in a separately versioned dataset that runs outside the v1 gate. Writing cases and labels alone would create the self-graded gold set the project avoids elsewhere. The proposals are in `docs/TAXONOMY_COVERAGE_CROSSWALK.md`, ready for that review.

## ADR-023: A release gate trusts the fixture's case list, and CI publishes artifacts only after a successful scan

`computeGate` used to treat a report as complete when `cases.length` equalled the report's own `dataset.caseCount` and the report's dataset hash matched the fixture. That accepts a report that drops a case and lowers the declared count, swaps in an unknown case id, marks `NO_FALSE_COMPLETION` as `not_applicable`, or downgrades a critical failure's severity. Those reports are now `ERROR`.

When the caller supplies the verified fixture (`pnpm eval:gate` and the worker both do), the gate requires:

- the same case count and the same case ids as the fixture, on the candidate and on any baseline;
- the report's risk, must-escalate label, proposed action, and caller-verification flag to match that fixture case, because those fields decide recall and which severities are legal;
- `not_applicable` only where the rule defines it: tenant isolation for a verified caller, escalation when escalation is not required, and response concepts when none are annotated;
- each result's severity and evaluator version to be the one that rule produces, and the case status to agree with its rule results and with whether output is present.

`RESPONSE_CONCEPTS` may stay `not_applicable` for the v1 suite, whose cases annotate no response concepts. The check does not re-grade the reply.

CI uploads `artifacts/` and the Playwright report only when the sensitive-data scan step completed successfully. The scan still runs if an earlier step failed, including the expected BLOCK in the manual regression workflow, so a clean scan can still publish that evidence. If the scan fails, the job uploads only the scan's own summary, which is file, line, and kind, never the matched value. A skipped scan publishes nothing.
