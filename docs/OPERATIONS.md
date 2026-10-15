# Operations

Configuration, commands, and troubleshooting for running the lab locally. Everything here runs offline against synthetic data.

## Configuration

Copy `.env.example` to `.env`. The API validates the environment at startup and refuses to start on any invalid value. Errors name the variable, never its value. The CLIs read `.env` for `DATABASE_URL`, and real environment variables take precedence.

| Variable                                      | Default       | Allowed values and notes                                                                        |
| --------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                    | `development` | `development`, `test`, `production`                                                             |
| `PORT`                                        | `3000`        | 1–65535. The API always binds to `127.0.0.1`.                                                   |
| `DATABASE_URL`                                | none          | `postgresql://` URL. Required by the API's data routes, the worker, and every database command. |
| `MODEL_ENABLED`                               | `false`       | Must be `false`. External models are disabled.                                                  |
| `ALLOW_EXTERNAL_CALLS`                        | `false`       | Must be `false`.                                                                                |
| `USE_SYNTHETIC_FIXTURES`                      | `true`        | Must be `true`.                                                                                 |
| `EVAL_DEFAULT_DATASET`                        | `v1`          | Dataset version used when a request omits one.                                                  |
| `EVAL_MAX_CONCURRENCY`                        | `4`           | 1–16 cases in flight per run.                                                                   |
| `EVAL_CASE_TIMEOUT_MS`                        | `5000`        | 1–60000. A case that exceeds it is recorded as an execution error.                              |
| `EVAL_MAX_CASES`                              | `100`         | 1–100.                                                                                          |
| `OTEL_EXPORTER`                               | `none`        | `none` or `console` (prints spans and metrics).                                                 |
| `LOG_LEVEL`                                   | `info`        | Pino levels, or `silent`.                                                                       |
| `AUTH_MODE`                                   | `local`       | `local` (single workspace `ws_demo`, no authentication, refused in production) or `jwt`.        |
| `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_JWKS_FILE` | none          | Required when `AUTH_MODE=jwt`. `pnpm auth:init` prints suitable local values.                   |

Test and browser-test databases:

| Variable            | Default                                       | Used by                                                                                          |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `TEST_DATABASE_URL` | falls back to `DATABASE_URL`                  | Integration tests. Each suite creates and drops its own temporary database through this URL.     |
| `E2E_DATABASE_URL`  | `postgresql://app:app@localhost:5432/srl_e2e` | `pnpm --filter @srl/web test:e2e`. The named database is **dropped and recreated** on every run. |

## Commands

| Command                              | What it does                                                                     | Exit codes                                  |
| ------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------- |
| `pnpm eval:validate-data`            | Hashes the fixture and validates manifest, schema, counts, and policy references | 0 valid, 1 invalid, 2 usage                 |
| `pnpm db:migrate`                    | Applies migrations (idempotent)                                                  | 0, 1 on failure                             |
| `pnpm seed`                          | Stores dataset `v1` and registers the three agent versions (idempotent)          | 0, 1 on failure                             |
| `pnpm eval:run -- --agent <version>` | Enqueues, executes, and gates one run; writes `artifacts/runs/<id>/`             | 0 PASS, 1 BLOCK, ERROR, or failure, 2 usage |
| `pnpm eval:gate -- --report <file>`  | Re-gates a saved `run-report.json`, optionally against `--baseline <file>`       | 0 PASS, 1 BLOCK or ERROR, 2 usage           |
| `pnpm demo`                          | Reference, regression, repaired; writes `artifacts/demo/`                        | 0 only if PASS, BLOCK, PASS was observed    |
| `pnpm worker [-- --once]`            | Processes queued runs and records their gates                                    | 0, 1 on failure, 2 usage                    |
| `pnpm alerts:check`                  | Evaluates alert rules over recorded gates; writes `artifacts/incidents/`         | 0 none open, 1 open alert, 2 usage          |
| `pnpm scan:sensitive`                | Scans tracked files and `artifacts/` for keys, tokens, contact details, cards    | 0 clean, 1 findings                         |
| `pnpm auth:init`, `pnpm auth:token`  | Local ES256 key pair and short-lived development tokens                          | 0, 1 no key pair, 2 usage                   |
| `pnpm dev`                           | API on `127.0.0.1:3000` with file watching                                       |                                             |
| `pnpm --filter @srl/web dev`         | Review UI on `127.0.0.1:5173`, proxying `/api` to the API                        |                                             |
| `pnpm --filter @srl/web test:e2e`    | Builds the UI, recreates the e2e database, runs Playwright                       | 0 all passed                                |
| `pnpm --filter @srl/web screenshots` | Regenerates `docs/images/*.png` from a fresh e2e database                        | 0 captured                                  |

## Artifacts

A run directory (`artifacts/runs/<runId>/` or `artifacts/demo/<version>/`) holds:

- `gate.json`: status, blockers, warnings, metrics, denominators, thresholds, and every pinned hash.
- `run-report.json`: per-case results and rule verdicts, validated against a schema before gating.
- `run-report.html`: the same report for reading, with customer text escaped.

`artifacts/` is git-ignored. CI uploads it only after `pnpm scan:sensitive` completes successfully. A sample from a clean run is committed under [`docs/demo/`](demo/).

## Troubleshooting

**Port 5432 is already in use.** Another Postgres is running. Start the project database on another port and point `DATABASE_URL` at it:

```bash
POSTGRES_PORT=5433 docker compose up -d db
# .env: DATABASE_URL=postgresql://app:app@localhost:5433/support_reliability
```

**`Unknown file extension ".ts"` or syntax errors in `.ts` files.** The CLIs run TypeScript directly through Node's type stripping, which needs Node 24. Check `node --version` against `.nvmrc`.

**`/health/ready` returns 503 with `"status": "not_ready"`.** The `checks` field says which part failed: `database` is `not_configured` or `unavailable` (check `DATABASE_URL` and `docker compose ps`), or `dataset` is `invalid` (run `pnpm eval:validate-data`).

**A run's gate is `ERROR`.** The evidence is incomplete or not comparable, which is different from a failing release. The reasons are listed first in `blockers`, prefixed `error:` (for example `error:missing_results:79/80`, `error:missing_rule:<rule>:<case>`, or `error:not_applicable:<rule>:<case>`), `integrity:` (the report's dataset hash, case ids, case count, or scoring labels differ from the fixture), or `incompatible_baseline:` (the baseline used a different dataset, policy, or evaluator, or is incomplete). Fix the cause and run again. An `ERROR` is never downgraded to `PASS`.

**A run ends `errored` with `agent_source_changed`.** The agent source changed between enqueue and execution, so the worker refused to run code other than what the run recorded. Enqueue a new run; enqueueing registers the current source hash.

**Every API request returns 401.** `AUTH_MODE=jwt` is set. Create a token with `pnpm -s auth:token -- --role reviewer` and send it as `Authorization: Bearer <token>`, or paste it into the UI's token field.

**Playwright cannot find a browser.** Run `pnpm --filter @srl/web exec playwright install chromium`, adding `--with-deps` on a fresh Linux machine.
