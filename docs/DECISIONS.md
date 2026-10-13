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
