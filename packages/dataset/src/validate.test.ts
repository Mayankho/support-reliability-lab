import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkAnnotationReview } from './annotations.ts';
import { datasetPaths, loadDataset } from './load.ts';
import { sha256Hex, validateDataset, type DatasetValidation } from './validate.ts';

const paths = datasetPaths('v1');
const fixtureBytes = readFileSync(paths.fixture);
const fixtureText = fixtureBytes.toString('utf8');
const manifest = JSON.parse(readFileSync(paths.manifest, 'utf8')) as Record<string, unknown>;
const reviewText = readFileSync(paths.annotations, 'utf8');

function lines(): string[] {
  return fixtureText.trimEnd().split('\n');
}

function validate(text: string, manifestOverrides: Record<string, unknown> = {}, rehash = true) {
  const bytes = Buffer.from(text, 'utf8');
  const manifestBody = {
    ...manifest,
    ...(rehash ? { sha256: sha256Hex(bytes) } : {}),
    ...manifestOverrides,
  };
  return validateDataset({
    expectedVersion: 'v1',
    fixtureBytes: bytes,
    manifestText: JSON.stringify(manifestBody),
  });
}

function codes(result: DatasetValidation): string[] {
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

function editLine(index: number, edit: (record: Record<string, unknown>) => void): string {
  const all = lines();
  const record = JSON.parse(all[index] ?? '{}') as Record<string, unknown>;
  edit(record);
  all[index] = JSON.stringify(record);
  return `${all.join('\n')}\n`;
}

describe('validateDataset on the checked-in fixture', () => {
  it('accepts v1 exactly as committed', async () => {
    const result = await loadDataset('v1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dataset.cases).toHaveLength(80);
      expect(result.dataset.sha256).toBe(manifest.sha256);
      expect(result.dataset.manifest.humanReviewStatus).toBe(
        'starter_labels_not_independently_adjudicated',
      );
      expect(result.review?.independentlyAdjudicated).toBe(false);
    }
  });

  it('does not modify the fixture or manifest while validating', async () => {
    const before = sha256Hex(await readFile(paths.fixture));
    const manifestBefore = await readFile(paths.manifest, 'utf8');
    await loadDataset('v1');

    expect(sha256Hex(await readFile(paths.fixture))).toBe(before);
    expect(await readFile(paths.manifest, 'utf8')).toBe(manifestBefore);
  });
});

describe('validateDataset failures', () => {
  it('rejects a one-byte change without a new manifest', () => {
    const mutated = Buffer.from(fixtureBytes);
    const index = mutated.indexOf('refund them', 0, 'utf8');
    mutated[index] = 'R'.charCodeAt(0);
    const result = validateDataset({
      expectedVersion: 'v1',
      fixtureBytes: mutated,
      manifestText: JSON.stringify(manifest),
    });

    expect(codes(result)).toEqual(['SHA256_MISMATCH']);
  });

  it('rejects a duplicate case id and reports the first occurrence', () => {
    const all = lines();
    const duplicated = `${[...all, all[0] ?? ''].join('\n')}\n`;
    const result = validate(duplicated);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const duplicate = result.issues.find((issue) => issue.code === 'DUPLICATE_CASE_ID');
      expect(duplicate).toMatchObject({
        line: 81,
        caseId: 'REF-001',
        detail: 'first seen on line 1',
      });
    }
  });

  it('rejects a policy id that is not in the registry', () => {
    const text = editLine(0, (record) => {
      record.availablePolicyIds = ['KB-REFUND-001', 'KB-NONE-999'];
    });

    expect(codes(validate(text))).toContain('UNKNOWN_POLICY_ID');
  });

  it('rejects a required citation that the agent is never given', () => {
    const text = editLine(0, (record) => {
      record.availablePolicyIds = ['KB-CREDIT-001'];
    });

    expect(codes(validate(text))).toEqual(['REQUIRED_POLICY_NOT_AVAILABLE']);
  });

  it('keeps a case with no supplied policy documents valid', () => {
    const index = lines().findIndex((line) => line.includes('"id":"KB-010"'));
    const record = JSON.parse(lines()[index] ?? '{}') as { availablePolicyIds: string[] };

    expect(record.availablePolicyIds).toEqual([]);
    expect(validate(fixtureText).ok).toBe(true);
  });

  it('rejects declared counts that disagree with the records', () => {
    const result = validate(fixtureText, {
      criticalCaseCount: 45,
      categoryCounts: { ...(manifest.categoryCounts as object), cancellation: 11 },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.detail)).toEqual([
        'categoryCounts.cancellation: manifest 11, observed 10',
        'criticalCaseCount: manifest 45, observed 44',
      ]);
    }
  });

  it('rejects malformed JSON without echoing the line', () => {
    const all = lines();
    all[4] = '{"id":"REF-005", "secret-looking-fragment": ';
    const result = validate(`${all.join('\n')}\n`);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((candidate) => candidate.code === 'INVALID_JSON');
      expect(issue).toEqual({ code: 'INVALID_JSON', line: 5, detail: 'line is not valid JSON' });
      expect(JSON.stringify(result.issues)).not.toContain('secret-looking-fragment');
    }
  });

  it('rejects a schema violation and names the field path', () => {
    const text = editLine(2, (record) => {
      (record.expected as Record<string, unknown>).decision = 'issue_refund';
    });
    const result = validate(text);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((candidate) => candidate.code === 'SCHEMA_INVALID');
      expect(issue).toMatchObject({ code: 'SCHEMA_INVALID', line: 3 });
      expect(issue?.detail).toMatch(/^expected\.decision: /u);
    }
  });

  it('rejects carriage returns and blank lines', () => {
    const crlf = fixtureText.replace('\n', '\r\n');
    const blank = fixtureText.replace('\n', '\n\n');

    expect(codes(validate(crlf))).toContain('LINE_ENDING_INVALID');
    expect(codes(validate(blank))).toContain('EMPTY_LINE');
  });

  it('rejects contact details and token-shaped values without echoing them', () => {
    const email = 'person@example.com';
    const text = editLine(0, (record) => {
      (record.input as Record<string, unknown>).message = `Please email ${email} about my refund.`;
    });
    const result = validate(text);

    expect(codes(result)).toEqual(['SENSITIVE_PATTERN']);
    expect(JSON.stringify(result)).not.toContain(email);
  });

  it('rejects an invalid manifest, a wrong version, and a real-data flag', () => {
    expect(
      codes(
        validateDataset({
          expectedVersion: 'v1',
          fixtureBytes,
          manifestText: '{not json',
        }),
      ),
    ).toContain('MANIFEST_INVALID_JSON');
    expect(codes(validate(fixtureText, { usesRealCustomerData: true }))).toContain(
      'MANIFEST_INVALID',
    );
    expect(codes(validate(fixtureText, { policyVersion: 'SYN-POLICY-2' }))).toEqual([
      'POLICY_VERSION_MISMATCH',
    ]);
    expect(
      codes(
        validateDataset({
          expectedVersion: 'v2',
          fixtureBytes,
          manifestText: JSON.stringify(manifest),
        }),
      ),
    ).toEqual(['MANIFEST_VERSION_MISMATCH']);
  });

  it('rejects an oversized fixture before parsing it', () => {
    const result = validateDataset({
      expectedVersion: 'v1',
      fixtureBytes: new Uint8Array(5 * 1024 * 1024 + 1),
      manifestText: JSON.stringify(manifest),
    });

    expect(codes(result)).toEqual(['FILE_TOO_LARGE']);
  });

  it('returns the same issues in the same order on every run', () => {
    const text = `${[...lines(), lines()[1] ?? '', 'not json'].join('\n')}\n`;

    expect(validate(text, {}, false)).toEqual(validate(text, {}, false));
  });

  it('reports unreadable files as a read error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'srl-dataset-'));
    const result = await loadDataset('v1', datasetPaths('v1', dir));

    expect(result).toEqual({
      ok: false,
      issues: [{ code: 'READ_ERROR', detail: 'could not read dataset files (ENOENT)' }],
      observedSha256: null,
    });
  });

  it('fails the whole load when the annotation file describes different bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'srl-dataset-'));
    const tmpPaths = { ...datasetPaths('v1', dir), annotations: join(dir, 'review.v1.json') };
    const review = JSON.parse(reviewText) as Record<string, unknown>;
    await writeFile(tmpPaths.fixture, fixtureBytes);
    await writeFile(tmpPaths.manifest, JSON.stringify(manifest));
    await writeFile(
      tmpPaths.annotations,
      JSON.stringify({ ...review, datasetSha256: 'a'.repeat(64) }),
    );

    const result = await loadDataset('v1', tmpPaths);

    expect(result).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'ANNOTATION_INVALID',
          detail: 'review datasetSha256 does not match the fixture bytes',
        },
      ],
    });
  });
});

describe('annotation review honesty', () => {
  async function dataset() {
    const loaded = await loadDataset('v1');
    if (!loaded.ok) {
      throw new Error('expected the committed dataset to load');
    }
    return loaded.dataset;
  }

  it('refuses to mark a single-reviewer pass as independently adjudicated', async () => {
    const review = JSON.parse(reviewText) as Record<string, unknown>;
    const result = checkAnnotationReview(
      JSON.stringify({ ...review, independentlyAdjudicated: true }),
      await dataset(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.detail)).toEqual([
        'independentlyAdjudicated disagrees with the manifest humanReviewStatus',
        'a single-reviewer pass cannot be marked independently adjudicated',
      ]);
    }
  });

  it('requires one entry per case and a note on every non-consistent entry', async () => {
    const review = JSON.parse(reviewText) as { entries: Array<Record<string, unknown>> };
    const [first, ...rest] = review.entries;
    const result = checkAnnotationReview(
      JSON.stringify({
        ...review,
        entries: [...rest, { ...first, status: 'note', notes: [] }, rest[0]],
      }),
      await dataset(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.detail)).toEqual([
        'REF-001 has status note without a note',
        'REF-002 is reviewed more than once',
      ]);
    }
  });

  it('records GEN-012 as disputed but still scored', async () => {
    const result = checkAnnotationReview(reviewText, await dataset());

    expect(result.ok).toBe(true);
    if (result.ok) {
      const disputed = result.review.entries.filter((entry) => entry.status === 'disputed');
      expect(disputed.map((entry) => [entry.caseId, entry.scored])).toEqual([['GEN-012', true]]);
    }
  });
});
