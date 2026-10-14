import { and, eq, sql } from 'drizzle-orm';
import { expectedBehaviorSchema, goldenCaseSchema, type GoldenCase } from '@srl/contracts';
import type { Db, Executor } from '../client.ts';
import { cases, datasets } from '../schema.ts';

export interface DatasetImport {
  version: string;
  sha256: string;
  policyVersion: string;
  policySha256: string;
  reviewStatus: string;
  manifest: unknown;
  cases: readonly GoldenCase[];
}

export class DatasetConflictError extends Error {
  readonly code = 'DATASET_HASH_CONFLICT';
  constructor(version: string) {
    super(
      `dataset ${version} is already stored with different bytes; publish a new version instead`,
    );
    this.name = 'DatasetConflictError';
  }
}

export interface StoredDataset {
  id: string;
  version: string;
  sha256: string;
  caseCount: number;
  policyVersion: string;
  policySha256: string;
  reviewStatus: string;
  createdAt: Date;
}

/**
 * Stores a validated dataset once. Re-importing identical bytes is a no-op; the same version with
 * different bytes is refused rather than overwritten.
 */
export async function importDataset(
  db: Db,
  data: DatasetImport,
): Promise<{ id: string; created: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`dataset:${data.version}`}))`);
    const [existing] = await tx
      .select({ id: datasets.id, sha256: datasets.sha256 })
      .from(datasets)
      .where(eq(datasets.version, data.version));
    if (existing !== undefined) {
      if (existing.sha256 !== data.sha256) {
        throw new DatasetConflictError(data.version);
      }
      return { id: existing.id, created: false };
    }

    const [inserted] = await tx
      .insert(datasets)
      .values({
        version: data.version,
        sha256: data.sha256,
        caseCount: data.cases.length,
        policyVersion: data.policyVersion,
        policySha256: data.policySha256,
        reviewStatus: data.reviewStatus,
        manifestJson: data.manifest,
      })
      .returning({ id: datasets.id });
    if (inserted === undefined) {
      throw new Error('dataset insert returned no row');
    }
    await tx.insert(cases).values(
      data.cases.map((goldenCase) => ({
        datasetId: inserted.id,
        caseKey: goldenCase.id,
        category: goldenCase.category,
        risk: goldenCase.risk,
        inputJson: goldenCase.input,
        availablePolicyIds: goldenCase.availablePolicyIds,
        expectedJson: goldenCase.expected,
        tags: goldenCase.tags,
      })),
    );
    return { id: inserted.id, created: true };
  });
}

export async function getDatasetByVersion(
  db: Executor,
  version: string,
): Promise<StoredDataset | null> {
  const [row] = await db
    .select({
      id: datasets.id,
      version: datasets.version,
      sha256: datasets.sha256,
      caseCount: datasets.caseCount,
      policyVersion: datasets.policyVersion,
      policySha256: datasets.policySha256,
      reviewStatus: datasets.reviewStatus,
      createdAt: datasets.createdAt,
    })
    .from(datasets)
    .where(eq(datasets.version, version));
  return row ?? null;
}

export async function listDatasets(db: Executor): Promise<StoredDataset[]> {
  return db
    .select({
      id: datasets.id,
      version: datasets.version,
      sha256: datasets.sha256,
      caseCount: datasets.caseCount,
      policyVersion: datasets.policyVersion,
      policySha256: datasets.policySha256,
      reviewStatus: datasets.reviewStatus,
      createdAt: datasets.createdAt,
    })
    .from(datasets)
    .orderBy(datasets.version);
}

export interface CaseInputRow {
  caseId: string;
  caseKey: string;
  category: string;
  risk: string;
  input: unknown;
  availablePolicyIds: unknown;
}

/** Reads from the `case_inputs` view, which has no gold-label column. */
export async function loadCaseInputs(db: Executor, datasetId: string): Promise<CaseInputRow[]> {
  const result = await db.execute<{
    id: string;
    case_key: string;
    category: string;
    risk: string;
    input_json: unknown;
    available_policy_ids: unknown;
  }>(
    sql`select id, case_key, category, risk, input_json, available_policy_ids
        from case_inputs where dataset_id = ${datasetId} order by case_key`,
  );
  return result.rows.map((row) => ({
    caseId: row.id,
    caseKey: row.case_key,
    category: row.category,
    risk: row.risk,
    input: row.input_json,
    availablePolicyIds: row.available_policy_ids,
  }));
}

/** Gold labels for grading only. Validated again because persisted JSON is a trust boundary. */
export async function loadCaseLabels(
  db: Executor,
  datasetId: string,
): Promise<Map<string, ReturnType<typeof expectedBehaviorSchema.parse>>> {
  const rows = await db
    .select({ caseId: cases.id, expected: cases.expectedJson })
    .from(cases)
    .where(eq(cases.datasetId, datasetId));
  return new Map(rows.map((row) => [row.caseId, expectedBehaviorSchema.parse(row.expected)]));
}

/** Rebuilds and re-validates a full golden case from persisted rows (input view plus labels). */
export function rebuildGoldenCase(
  input: CaseInputRow,
  expected: unknown,
  tags: readonly string[] = ['synthetic'],
): GoldenCase {
  return goldenCaseSchema.parse({
    id: input.caseKey,
    category: input.category,
    risk: input.risk,
    input: input.input,
    availablePolicyIds: input.availablePolicyIds,
    expected,
    tags,
  });
}

export async function getCaseIdByKey(
  db: Executor,
  datasetId: string,
  caseKey: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.datasetId, datasetId), eq(cases.caseKey, caseKey)));
  return row?.id ?? null;
}
