export {
  MIGRATIONS_DIR,
  checkConnection,
  connect,
  databaseUrlSchema,
  migrateDatabase,
  redactDatabaseUrl,
  type Db,
  type DbHandle,
  type Executor,
  type Tx,
} from './client.ts';
export {
  DatasetConflictError,
  getCaseIdByKey,
  getDatasetByVersion,
  importDataset,
  listDatasets,
  loadCaseInputs,
  loadCaseLabels,
  rebuildGoldenCase,
  type CaseInputRow,
  type DatasetImport,
  type StoredDataset,
} from './queries/datasets.ts';
export {
  claimNextJob,
  finishRun,
  getJobForRun,
  releaseJob,
  renewLease,
  type ClaimedJob,
  type FinishRunInput,
} from './queries/jobs.ts';
export { workspaceMetrics, type WorkspaceMetrics } from './queries/metrics.ts';
export {
  countCaseResults,
  insertCaseResult,
  listCaseIdsWithResults,
  listTraceEvents,
  loadRunResults,
  runSummary,
  type CaseResultInsert,
  type RunSummary,
  type StoredCaseResult,
} from './queries/results.ts';
export {
  GateAlreadyRecordedError,
  appendAudit,
  countAuditEvents,
  createRun,
  getRun,
  listRuns,
  recordGate,
  registerAgentVersion,
  type AgentVersionRecord,
  type AuditInput,
  type CreateRunInput,
  type ListRunsInput,
  type RunRecord,
} from './queries/runs.ts';
export { sql } from 'drizzle-orm';
export { loadRepoEnv, requireDatabaseUrl } from './cli/env.ts';
export { postgresCode, postgresMessage } from './errors.ts';
export * as schema from './schema.ts';
export { createTestDatabase, testDatabaseUrl, type TestDatabase } from './test-database.ts';
