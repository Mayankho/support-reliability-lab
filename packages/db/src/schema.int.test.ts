import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { GoldenCase } from '@srl/contracts';
import { migrateDatabase } from './client.ts';
import {
  DatasetConflictError,
  getDatasetByVersion,
  importDataset,
  loadCaseInputs,
  loadCaseLabels,
  type DatasetImport,
} from './queries/datasets.ts';
import { appendAudit, createRun, registerAgentVersion } from './queries/runs.ts';
import { postgresMessage } from './errors.ts';
import { createTestDatabase, type TestDatabase } from './test-database.ts';

let testDb: TestDatabase;

async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return postgresMessage(error);
  }
  throw new Error('expected the statement to be rejected');
}

const goldenCase: GoldenCase = {
  id: 'TST-001',
  category: 'refund_guidance',
  risk: 'critical',
  input: {
    message: 'Synthetic refund request for a test.',
    account: {
      workspaceId: 'ws_t',
      actorWorkspaceId: 'ws_t',
      authenticated: true,
      subscription: 'monthly',
      planStatus: 'active',
      purchasedCreditsRemaining: 5,
      lastPurchaseCreditsGranted: 5,
      lastPurchaseCreditsUsed: 0,
      lastPurchaseAgeDays: 1,
      paymentSettled: true,
      disputed: false,
      generationStatus: 'none',
      generationChargedCredits: 0,
    },
  },
  availablePolicyIds: ['KB-REFUND-001'],
  expected: {
    intent: 'refund_request',
    decision: 'propose_action',
    route: 'billing',
    proposedAction: 'request_refund_review',
    mustEscalate: false,
    requiredPolicyIds: ['KB-REFUND-001'],
    forbiddenClaims: [],
    requiredResponseConcepts: [],
    rationale: 'Synthetic label for a database test.',
  },
  tags: ['synthetic'],
};

const datasetImport = (overrides: Partial<DatasetImport> = {}): DatasetImport => ({
  version: 'vtest',
  sha256: 'a'.repeat(64),
  policyVersion: 'SYN-POLICY-1',
  policySha256: 'b'.repeat(64),
  reviewStatus: 'starter_labels_not_independently_adjudicated',
  manifest: { datasetVersion: 'vtest' },
  cases: [goldenCase],
  ...overrides,
});

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb.drop();
});

describe('migrations', () => {
  it('apply on a clean database and are idempotent', async () => {
    await expect(migrateDatabase(testDb.handle)).resolves.toBeUndefined();
    const tables = await testDb.handle.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'agent_versions',
      'audit_events',
      'case_inputs',
      'case_results',
      'cases',
      'datasets',
      'evaluation_runs',
      'rule_results',
      'run_jobs',
      'trace_events',
    ]);
  });
});

describe('dataset storage', () => {
  it('imports once and treats identical bytes as a no-op', async () => {
    const first = await importDataset(testDb.handle.db, datasetImport());
    const second = await importDataset(testDb.handle.db, datasetImport());

    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });
    expect((await getDatasetByVersion(testDb.handle.db, 'vtest'))?.caseCount).toBe(1);
  });

  it('refuses the same version with different bytes', async () => {
    await expect(
      importDataset(testDb.handle.db, datasetImport({ sha256: 'c'.repeat(64) })),
    ).rejects.toBeInstanceOf(DatasetConflictError);
  });

  it('serves agent inputs from a view with no gold-label column', async () => {
    const columns = await testDb.handle.db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_name = 'case_inputs' order by column_name`,
    );
    expect(columns.rows.map((row) => row.column_name)).not.toContain('expected_json');

    const dataset = await getDatasetByVersion(testDb.handle.db, 'vtest');
    const inputs = await loadCaseInputs(testDb.handle.db, dataset?.id ?? '');
    expect(inputs).toHaveLength(1);
    expect(JSON.stringify(inputs)).not.toContain('rationale');
    const labels = await loadCaseLabels(testDb.handle.db, dataset?.id ?? '');
    expect([...labels.values()][0]?.decision).toBe('propose_action');
  });

  it('rejects edits and deletes of stored cases', async () => {
    expect(
      await rejection(testDb.handle.db.execute(sql`update cases set risk = 'standard'`)),
    ).toMatch(/immutable/u);
    expect(await rejection(testDb.handle.db.execute(sql`delete from datasets`))).toMatch(
      /immutable/u,
    );
  });
});

describe('run lifecycle guards', () => {
  async function newRun(): Promise<string> {
    const dataset = await getDatasetByVersion(testDb.handle.db, 'vtest');
    const agentVersionId = await registerAgentVersion(testDb.handle.db, {
      version: 'reference-v1',
      sourceHash: 'd'.repeat(64),
      policyHash: 'b'.repeat(64),
      adapterKind: 'offline_deterministic',
      sourceCommit: null,
      description: 'test',
    });
    return createRun(testDb.handle.db, {
      workspaceId: 'ws_demo',
      datasetId: dataset?.id ?? '',
      agentVersionId,
      baselineRunId: null,
      caseCount: 1,
      manifestSha: 'a'.repeat(64),
      policySha: 'b'.repeat(64),
      evaluatorVersion: '1.0.0',
      config: {},
      actor: 'test',
      correlationId: 'corr',
    });
  }

  it('rejects skipping states and recording a gate before the run finishes', async () => {
    const runId = await newRun();
    expect(
      await rejection(
        testDb.handle.db.execute(
          sql`update evaluation_runs set status = 'completed' where id = ${runId}`,
        ),
      ),
    ).toMatch(/invalid run transition/u);
    expect(
      await rejection(
        testDb.handle.db.execute(
          sql`update evaluation_runs set gate_status = 'PASS', gate_json = '{}' where id = ${runId}`,
        ),
      ),
    ).toMatch(/gate can only be recorded/u);
  });

  it('freezes a finished run except for a single gate record', async () => {
    const runId = await newRun();
    await testDb.handle.db.execute(
      sql`update evaluation_runs set status = 'running' where id = ${runId}`,
    );
    await testDb.handle.db.execute(
      sql`update evaluation_runs set status = 'completed', finished_at = now() where id = ${runId}`,
    );

    await testDb.handle.db.execute(
      sql`update evaluation_runs set gate_status = 'BLOCK', gate_json = '{"status":"BLOCK"}' where id = ${runId}`,
    );
    expect(
      await rejection(
        testDb.handle.db.execute(
          sql`update evaluation_runs set gate_status = 'PASS', gate_json = '{}' where id = ${runId}`,
        ),
      ),
    ).toMatch(/finalized/u);
    expect(
      await rejection(
        testDb.handle.db.execute(
          sql`update evaluation_runs set config_json = '{"x":1}' where id = ${runId}`,
        ),
      ),
    ).toMatch(/finalized/u);
    expect(
      await rejection(
        testDb.handle.db.execute(sql`delete from evaluation_runs where id = ${runId}`),
      ),
    ).toMatch(/immutable/u);
  });

  it('keeps the audit log append-only', async () => {
    await appendAudit(testDb.handle.db, {
      actor: 'test',
      action: 'test.event',
      resourceId: 'r1',
      correlationId: 'c1',
      details: {},
    });
    expect(
      await rejection(testDb.handle.db.execute(sql`update audit_events set actor = 'x'`)),
    ).toMatch(/immutable/u);
    expect(await rejection(testDb.handle.db.execute(sql`delete from audit_events`))).toMatch(
      /immutable/u,
    );
  });
});
