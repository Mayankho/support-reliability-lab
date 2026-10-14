import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSION_FLAG, runLocalImport } from './local-import.ts';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const FLAG = `--${PERMISSION_FLAG}`;
let work: string;
let input: string;

const record = (thread: number, body: string) => ({
  ticket_id: `x-${String(thread)}`,
  thread_id: `private-thread-${String(thread)}`,
  created_at: '2026-03-02T10:00:00Z',
  author: { type: 'customer', name: 'Invented Person', email: 'invented@example.com' },
  body,
});

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'srl-local-import-'));
  input = join(work, 'export.json');
  const records = [
    ...Array.from({ length: 12 }, (_, i) =>
      record(i, 'My API calls return 401. My key is srl_live_9fQ2xLmP4tR7vB1nZ8'),
    ),
    ...Array.from({ length: 3 }, (_, i) =>
      record(100 + i, 'Please cancel my subscription before renewal.'),
    ),
    { thread_id: 'bad' },
  ];
  writeFileSync(input, JSON.stringify(records));
});

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('local import', () => {
  it('refuses to run without an explicit permission acknowledgment', () => {
    expect(runLocalImport(['--input', input, '--output', join(work, 'out-a')], REPO)).toEqual({
      ok: false,
      code: 'PERMISSION_NOT_ACKNOWLEDGED',
    });
  });

  it('refuses relative paths', () => {
    expect(
      runLocalImport(['--input', 'export.json', '--output', join(work, 'out-b'), FLAG], REPO),
    ).toEqual({
      ok: false,
      code: 'PATH_NOT_ABSOLUTE',
    });
  });

  it('refuses input or output inside the repository, including through a symlink', () => {
    const fixture = join(REPO, 'packages/ticket-analysis/fixtures/threads.demo.v1.json');
    expect(
      runLocalImport(['--input', fixture, '--output', join(work, 'out-c'), FLAG], REPO),
    ).toEqual({
      ok: false,
      code: 'PATH_INSIDE_REPOSITORY',
    });
    expect(
      runLocalImport(['--input', input, '--output', join(REPO, 'artifacts/private'), FLAG], REPO),
    ).toEqual({
      ok: false,
      code: 'PATH_INSIDE_REPOSITORY',
    });
    const link = join(work, 'repo-link');
    symlinkSync(REPO, link);
    expect(
      runLocalImport(['--input', input, '--output', join(link, 'artifacts/private'), FLAG], REPO),
    ).toEqual({
      ok: false,
      code: 'PATH_INSIDE_REPOSITORY',
    });
  });

  it('refuses a missing input and a non-empty output directory', () => {
    expect(
      runLocalImport(
        ['--input', join(work, 'nope.json'), '--output', join(work, 'out-d'), FLAG],
        REPO,
      ),
    ).toEqual({
      ok: false,
      code: 'INPUT_NOT_A_FILE',
    });
    const busy = join(work, 'busy');
    mkdirSync(busy);
    writeFileSync(join(busy, 'existing.txt'), 'x');
    expect(runLocalImport(['--input', input, '--output', busy, FLAG], REPO)).toEqual({
      ok: false,
      code: 'OUTPUT_NOT_EMPTY',
    });
  });

  it('writes a private aggregate with small counts suppressed and no IDs, text, or secrets', () => {
    const out = join(work, 'out-ok');
    const outcome = runLocalImport(['--input', input, '--output', out, FLAG], REPO);
    expect(outcome).toMatchObject({ ok: true, threads: 15 });
    if (!outcome.ok) return;
    const text = readFileSync(outcome.summaryPath, 'utf8');
    const summary = JSON.parse(text) as Record<string, unknown>;
    expect(summary).toMatchObject({
      kind: 'private_aggregate_summary',
      threads: 15,
      primaryL2: { 'API-01': 12, 'BIL-03': '<10' },
      flags: { 'F-SEC': 12, 'F-CHURN': '<10' },
      rejectedRecords: { MISSING_FIELD: '<10' },
    });
    expect(text).not.toMatch(/private-thread|x-\d|Invented|example\.com|srl_live|401|cancel/u);
    expect(statSync(outcome.summaryPath).mode & 0o777).toBe(0o600);
    expect(statSync(out).mode & 0o777).toBe(0o700);
  });

  it('is not wired into any package script', () => {
    for (const manifest of ['package.json', 'packages/ticket-analysis/package.json']) {
      expect(readFileSync(join(REPO, manifest), 'utf8')).not.toContain('local-import');
    }
    expect(readFileSync(join(REPO, '.github/workflows/ci.yml'), 'utf8')).not.toContain(
      'local-import',
    );
  });
});
