# Support Reliability Lab

An evaluation and release-gate service for AI customer-support agents, written in TypeScript.

A support agent can sound helpful while breaking the rules that matter. It might promise a refund it cannot issue, treat a cancellation as a cash reimbursement, skip an escalation, cite a stale policy, or leak another workspace's data. This project replays a frozen set of support cases through versioned agent builds, scores each answer with deterministic graders that are independent of the agent, and blocks a release when a critical behavior regresses.

Everything runs offline on synthetic data. There are no API keys, real accounts, or payment systems, and no paid model calls.

I built it around the problems a support systems engineering role deals with every day: agent routing and escalation, eval rubrics, release gates, and billing guardrails. The support policy (`SYN-POLICY-1`) and every customer record are fictional and not affiliated with any company.

## Status

| Milestone                                                                  | State |
| -------------------------------------------------------------------------- | ----- |
| Workspace, config validation, liveness endpoint, local Postgres, CI        | Done  |
| Agent contracts and the `SYN-POLICY-1` registry                            | Done  |
| Dataset integrity checks and gold-label review log for the 80-case fixture | Done  |
| Three agent versions: reference, intentional regression, repair            | Done  |
| Twelve independent graders with fail-closed error handling                 | Done  |
| Postgres evidence store and leased worker with idempotent results          | Done  |
| Fail-closed release gate, baseline comparison, JSON and HTML reports, demo | Done  |
| Validated HTTP API with workspace-scoped reads and a background worker     | Done  |
| CI release gate, OpenTelemetry traces and counters, alerts, secret scan    | Done  |
| Review UI and JWT-scoped API access, with browser tests                    | Done  |

The full plan, with acceptance criteria for each milestone, is in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## How it works

```mermaid
flowchart LR
    DS[(Frozen cases + manifest)] --> RUN[Runner]
    RUN -->|message, account, policy docs| AG[Agent version under test]
    AG -->|structured output| GR[Independent graders]
    DS -->|hidden gold labels| GR
    GR --> GATE{Release gate}
    GATE -->|PASS / BLOCK / ERROR| REP[gate.json + report]
    GR --> DB[(Postgres evidence)]
```

The design rests on four guarantees:

- **The agent never sees the answers.** Gold labels go only to the graders. `toAgentVisibleInput` builds the agent input from the message, account context, and supplied policy documents, and a test asserts that no label reaches it.
- **Proposals are not actions.** An agent can propose a refund review, a cancellation at renewal, or a credit-restoration review. Nothing executes them, and claiming one completed is a critical failure.
- **The gate fails closed.** A grader error, timeout, or missing result blocks the release. It is never counted as a pass.
- **Evidence is pinned.** The policy file, each policy document, and the dataset are SHA-256 hashed, so a silent edit fails a test.

## What the demo shows

`pnpm demo` runs three agent versions against the same 80 frozen cases (dataset sha256 `e02ae60e…cf1d`) and exits 0 only if it observes this pattern:

| Version              | Gate  | Why                                                                                                                                      |
| -------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `reference-v1`       | PASS  | 80/80 cases pass; decision and route 80/80; must-escalate recall 23/23                                                                   |
| `regression-demo-v1` | BLOCK | `NO_FALSE_COMPLETION` fails (critical) on REF-001, REF-002, REF-003, REF-010, REF-011, each also flagged as new versus the reference run |
| `repaired-v1`        | PASS  | Same cases pass; no new failures versus the reference run                                                                                |

The regression is a one-line copy change: the refund-review reply says "I've refunded your credit purchase" while every structured field, including `claimsActionCompleted: false`, stays correct. Only a grader that reads the reply text catches it. The repair restores the copy and adds a guard that refuses completion wording. Details: [`packages/agent/README.md`](packages/agent/README.md).

## Quick start

Requires Node.js 24 (`.nvmrc` pins 24.21.0), pnpm 10, and Docker.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test
pnpm eval:validate-data                   # hash, schema, counts, policy references

cp .env.example .env
docker compose up -d db
pnpm db:migrate                           # apply migrations
pnpm seed                                 # store dataset v1, register agent versions
pnpm test:integration                     # Postgres-backed worker and schema tests
pnpm demo                                 # reference PASS, regression BLOCK, repaired PASS
pnpm dev                                  # http://127.0.0.1:3000
curl http://127.0.0.1:3000/health/live    # {"status":"ok"}
```

If port 5432 is already in use, run `POSTGRES_PORT=5433 docker compose up -d db` and update `DATABASE_URL` in `.env` to match.

The server binds to `127.0.0.1` only, and startup is rejected if `MODEL_ENABLED` or `ALLOW_EXTERNAL_CALLS` is `true`.

### Running an evaluation through the API

```bash
pnpm dev                                  # terminal 1: API
pnpm worker                               # terminal 2: executes queued runs and records gates
curl -s -X POST http://127.0.0.1:3000/api/v1/evaluation-runs \
  -H 'content-type: application/json' \
  -d '{"datasetVersion":"v1","agentVersion":"regression-demo-v1","runMode":"offline"}'
# => 202 {"runId":"…","status":"queued"}
curl -s http://127.0.0.1:3000/api/v1/evaluation-runs/<runId>/gate          # BLOCK + blockers
curl -s http://127.0.0.1:3000/api/v1/evaluation-runs/<runId>/cases/REF-001 # case evidence and trace
```

Endpoints and error codes are documented in [`contracts/openapi.yaml`](contracts/openapi.yaml).

### Review UI

```bash
pnpm dev                                  # terminal 1: API on 127.0.0.1:3000
pnpm --filter @srl/web dev                # terminal 2: http://127.0.0.1:5173
```

The UI has four views: run overview with metrics and a filterable case table, paired comparison, case detail (input, expected versus actual, rule results, trace), and the release decision with blockers linked to their cases. It shows the gate the worker recorded and never computes one itself.

### Requiring tokens

Local mode (the default) treats every request as the `ws_demo` workspace and never shows gold labels. To require signed tokens:

```bash
pnpm auth:init                            # local ES256 key pair in .local-auth/ (git-ignored)
# set AUTH_MODE=jwt and the JWT_* values it prints in .env, then restart the API
pnpm -s auth:token -- --role reviewer     # short-lived token for ws_demo
```

Tokens are verified against the local key file only (ES256, issuer, audience, expiry). A `viewer` can read, a `reviewer` can also enqueue runs and see expected values, and another workspace's runs return `404`. Paste the token into the UI's token field to use it there. Browser tests: `E2E_DATABASE_URL=postgresql://app:app@localhost:5432/srl_e2e pnpm --filter @srl/web test:e2e` (creates and replaces that database).

### Monitoring and CI

```bash
pnpm alerts:check       # evaluates alert rules over recorded gates, writes artifacts/incidents/*.md
pnpm scan:sensitive     # keys, tokens, contact details, card numbers in tracked files and artifacts
OTEL_EXPORTER=console pnpm worker   # print OpenTelemetry spans for each run
```

Main CI gates `reference-v1` and runs the demo on every push, so it fails if the reference agent regresses or if the gate stops catching the intentional regression. The deliberately red build is a separate, manually triggered workflow (`.github/workflows/regression-demo.yml`) that uploads the BLOCK evidence.

## Repository layout

```text
apps/api/              Fastify API: runs, cases, comparison, gate, metrics, readiness, JWT auth
apps/web/              React review UI and Playwright browser tests
packages/contracts/    Zod schemas for agent input/output and golden cases
packages/policies/     SYN-POLICY-1 registry, hashes, no-execution guard
packages/dataset/      Fixture loader and eval:validate-data
packages/agent/        reference-v1, regression-demo-v1, repaired-v1
packages/evals/        Graders for the twelve rule IDs (cannot import the agent)
packages/runner/       Enqueues runs; leased worker executes, grades, and persists each case
packages/db/           Drizzle schema, migrations, immutability triggers, SQL queries
packages/telemetry/    Pino redaction, OpenTelemetry spans and counters, alert rules
fixtures/              Synthetic policy, 80 golden cases, manifest, label review
contracts/             JSON Schema and starter OpenAPI contract
docs/                  Spec, roadmap, and design decisions
```

## Documentation

- [`docs/TECHNICAL_SPEC.md`](docs/TECHNICAL_SPEC.md): requirements, rubrics, data model, API, and the threat model
- [`docs/ROADMAP.md`](docs/ROADMAP.md): milestones and status
- [`docs/DECISIONS.md`](docs/DECISIONS.md): design decisions and their tradeoffs
- [`packages/policies/README.md`](packages/policies/README.md): synthetic policy precedence
- [`packages/agent/README.md`](packages/agent/README.md): agent versions and the intentional regression
- [`packages/evals/README.md`](packages/evals/README.md): grading rubric and how completion claims are detected
- [`docs/dataset/ANNOTATION_REVIEW.md`](docs/dataset/ANNOTATION_REVIEW.md): gold-label review status and disputes
- [`CONTRIBUTING.md`](CONTRIBUTING.md): engineering standards for this repository

## Limitations

The dataset is synthetic and small (80 cases), and its starter labels have not yet been independently adjudicated. Release thresholds are illustrative. Results from this suite say nothing about production accuracy, customer satisfaction, or deflection.
