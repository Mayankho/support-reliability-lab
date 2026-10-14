import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const datasets = pgTable(
  'datasets',
  {
    id: id(),
    version: text('version').notNull(),
    sha256: text('sha256').notNull(),
    caseCount: integer('case_count').notNull(),
    policyVersion: text('policy_version').notNull(),
    policySha256: text('policy_sha256').notNull(),
    reviewStatus: text('review_status').notNull(),
    manifestJson: jsonb('manifest_json').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('datasets_version_unique').on(t.version),
    unique('datasets_sha256_unique').on(t.sha256),
    check('datasets_sha256_format', sql`${t.sha256} ~ '^[a-f0-9]{64}$'`),
    check('datasets_case_count_positive', sql`${t.caseCount} > 0`),
  ],
);

export const cases = pgTable(
  'cases',
  {
    id: id(),
    datasetId: uuid('dataset_id')
      .notNull()
      .references(() => datasets.id),
    caseKey: text('case_key').notNull(),
    category: text('category').notNull(),
    risk: text('risk').notNull(),
    inputJson: jsonb('input_json').notNull(),
    availablePolicyIds: jsonb('available_policy_ids').notNull(),
    expectedJson: jsonb('expected_json').notNull(),
    tags: jsonb('tags').notNull(),
  },
  (t) => [
    unique('cases_dataset_case_key_unique').on(t.datasetId, t.caseKey),
    check('cases_risk_valid', sql`${t.risk} in ('critical', 'high', 'standard')`),
  ],
);

export const agentVersions = pgTable(
  'agent_versions',
  {
    id: id(),
    version: text('version').notNull(),
    sourceHash: text('source_hash').notNull(),
    policyHash: text('policy_hash').notNull(),
    adapterKind: text('adapter_kind').notNull(),
    sourceCommit: text('source_commit'),
    description: text('description').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('agent_versions_version_source_unique').on(t.version, t.sourceHash),
    check(
      'agent_versions_adapter_kind_valid',
      sql`${t.adapterKind} in ('offline_deterministic', 'model')`,
    ),
  ],
);

export const evaluationRuns = pgTable(
  'evaluation_runs',
  {
    id: id(),
    workspaceId: text('workspace_id').notNull(),
    datasetId: uuid('dataset_id')
      .notNull()
      .references(() => datasets.id),
    agentVersionId: uuid('agent_version_id')
      .notNull()
      .references(() => agentVersions.id),
    baselineRunId: uuid('baseline_run_id'),
    status: text('status').notNull().default('queued'),
    gateStatus: text('gate_status'),
    gateJson: jsonb('gate_json'),
    caseCount: integer('case_count').notNull(),
    manifestSha: text('manifest_sha').notNull(),
    policySha: text('policy_sha').notNull(),
    evaluatorVersion: text('evaluator_version').notNull(),
    configJson: jsonb('config_json').notNull(),
    errorCode: text('error_code'),
    createdAt: createdAt(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'evaluation_runs_status_valid',
      sql`${t.status} in ('queued', 'running', 'completed', 'errored', 'cancelled')`,
    ),
    check(
      'evaluation_runs_gate_status_valid',
      sql`${t.gateStatus} is null or ${t.gateStatus} in ('PASS', 'BLOCK', 'ERROR')`,
    ),
    index('evaluation_runs_created_status_idx').on(t.createdAt.desc(), t.status),
  ],
);

export const caseResults = pgTable(
  'case_results',
  {
    id: id(),
    runId: uuid('run_id')
      .notNull()
      .references(() => evaluationRuns.id),
    caseId: uuid('case_id')
      .notNull()
      .references(() => cases.id),
    status: text('status').notNull(),
    executionState: text('execution_state').notNull(),
    executionError: text('execution_error'),
    outputJson: jsonb('output_json'),
    durationMs: doublePrecision('duration_ms').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
    costSource: text('cost_source').notNull(),
    traceId: text('trace_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('case_results_run_case_unique').on(t.runId, t.caseId),
    check('case_results_status_valid', sql`${t.status} in ('pass', 'fail', 'error')`),
    check('case_results_execution_state_valid', sql`${t.executionState} in ('completed', 'error')`),
    check('case_results_duration_nonnegative', sql`${t.durationMs} >= 0`),
  ],
);

export const ruleResults = pgTable(
  'rule_results',
  {
    id: id(),
    caseResultId: uuid('case_result_id')
      .notNull()
      .references(() => caseResults.id),
    ruleId: text('rule_id').notNull(),
    verdict: text('verdict').notNull(),
    severity: text('severity').notNull(),
    evaluatorVersion: text('evaluator_version').notNull(),
    evidenceCode: text('evidence_code').notNull(),
    evidenceJson: jsonb('evidence_json').notNull(),
  },
  (t) => [
    unique('rule_results_case_rule_unique').on(t.caseResultId, t.ruleId),
    check(
      'rule_results_verdict_valid',
      sql`${t.verdict} in ('pass', 'fail', 'error', 'not_applicable')`,
    ),
    check('rule_results_severity_valid', sql`${t.severity} in ('critical', 'high', 'standard')`),
    index('rule_results_lookup_idx').on(t.caseResultId, t.verdict, t.severity),
  ],
);

export const traceEvents = pgTable(
  'trace_events',
  {
    id: id(),
    runId: uuid('run_id')
      .notNull()
      .references(() => evaluationRuns.id),
    caseId: uuid('case_id').references(() => cases.id),
    traceId: text('trace_id').notNull(),
    spanId: text('span_id').notNull(),
    kind: text('kind').notNull(),
    redactedAttributesJson: jsonb('redacted_attributes_json').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('trace_events_run_idx').on(t.runId, t.occurredAt)],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: id(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    resourceId: text('resource_id').notNull(),
    correlationId: text('correlation_id').notNull(),
    detailsJson: jsonb('details_json').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_events_resource_idx').on(t.resourceId, t.occurredAt)],
);

export const runJobs = pgTable(
  'run_jobs',
  {
    id: id(),
    runId: uuid('run_id')
      .notNull()
      .references(() => evaluationRuns.id),
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    workerId: text('worker_id'),
    lastError: text('last_error'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('run_jobs_run_unique').on(t.runId),
    check('run_jobs_status_valid', sql`${t.status} in ('queued', 'leased', 'done', 'failed')`),
    check('run_jobs_attempts_valid', sql`${t.attempts} >= 0 and ${t.maxAttempts} > 0`),
    index('run_jobs_status_lease_idx').on(t.status, t.leaseExpiresAt),
  ],
);
