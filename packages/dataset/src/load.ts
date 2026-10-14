import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { checkAnnotationReview, type AnnotationReview } from './annotations.ts';
import type { DatasetIssue } from './issues.ts';
import { validateDataset, type ValidatedDataset } from './validate.ts';

export const DEFAULT_FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/', import.meta.url));

export interface DatasetPaths {
  fixture: string;
  manifest: string;
  annotations: string;
}

export function datasetPaths(version: string, fixturesDir = DEFAULT_FIXTURES_DIR): DatasetPaths {
  if (!/^v[0-9]+(?:\.[0-9]+)?$/u.test(version)) {
    throw new Error('dataset version must look like v1');
  }
  return {
    fixture: join(fixturesDir, `golden_cases.${version}.jsonl`),
    manifest: join(fixturesDir, `manifest.${version}.json`),
    annotations: join(fixturesDir, 'annotations', `review.${version}.json`),
  };
}

export type DatasetLoad =
  | { ok: true; dataset: ValidatedDataset; review: AnnotationReview | null }
  | { ok: false; issues: DatasetIssue[]; observedSha256: string | null };

export async function loadDataset(
  version: string,
  paths = datasetPaths(version),
): Promise<DatasetLoad> {
  let fixtureBytes: Uint8Array;
  let manifestText: string;
  try {
    [fixtureBytes, manifestText] = await Promise.all([
      readFile(paths.fixture),
      readFile(paths.manifest, 'utf8'),
    ]);
  } catch (error) {
    return {
      ok: false,
      issues: [
        { code: 'READ_ERROR', detail: `could not read dataset files (${errorCode(error)})` },
      ],
      observedSha256: null,
    };
  }

  const validation = validateDataset({ expectedVersion: version, fixtureBytes, manifestText });
  if (!validation.ok) {
    return validation;
  }

  let reviewText: string | null = null;
  try {
    reviewText = await readFile(paths.annotations, 'utf8');
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      return {
        ok: false,
        issues: [
          { code: 'READ_ERROR', detail: `could not read annotation review (${errorCode(error)})` },
        ],
        observedSha256: validation.dataset.sha256,
      };
    }
  }
  if (reviewText === null) {
    return { ok: true, dataset: validation.dataset, review: null };
  }

  const review = checkAnnotationReview(reviewText, validation.dataset);
  if (!review.ok) {
    return { ok: false, issues: review.issues, observedSha256: validation.dataset.sha256 };
  }
  return { ok: true, dataset: validation.dataset, review: review.review };
}

function errorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return 'unknown';
}
