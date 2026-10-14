import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTaxonomy, type TaxonomyValidation, type ValidatedTaxonomy } from './validate.ts';

export const DATA_DIR = fileURLToPath(new URL('../../data/', import.meta.url));
export const MANIFEST_FILE = join(DATA_DIR, 'taxonomy.manifest.json');

export function readTaxonomy(manifestPath = MANIFEST_FILE): TaxonomyValidation {
  let manifestText: string;
  let bytes: Uint8Array;
  try {
    manifestText = readFileSync(manifestPath, 'utf8');
    const file = (JSON.parse(manifestText) as { file?: unknown }).file;
    if (typeof file !== 'string' || !/^[a-z0-9.-]+\.json$/u.test(file)) {
      return {
        ok: false,
        issues: [{ code: 'MANIFEST_INVALID', detail: 'file' }],
        observedSha256: '',
      };
    }
    bytes = readFileSync(join(manifestPath, '..', file));
  } catch {
    return {
      ok: false,
      issues: [{ code: 'MANIFEST_INVALID', detail: 'manifest or registry could not be read' }],
      observedSha256: '',
    };
  }
  return validateTaxonomy({ bytes, manifestText });
}

let cached: ValidatedTaxonomy | undefined;

/** The committed registry. Throws if it fails validation, so nothing classifies against bad data. */
export function loadTaxonomy(): ValidatedTaxonomy {
  if (cached !== undefined) return cached;
  const result = readTaxonomy();
  if (!result.ok) {
    throw new Error(
      `taxonomy registry is invalid: ${result.issues.map((issue) => issue.code).join(', ')}`,
    );
  }
  cached = result.value;
  return cached;
}
