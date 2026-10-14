import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cli = fileURLToPath(new URL('./validate-data.ts', import.meta.url));

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('eval:validate-data CLI', () => {
  it('exits 0 and prints the dataset hash for the committed fixture', () => {
    const result = run('--dataset', 'v1');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('dataset v1: VALID');
    expect(result.stdout).toContain(
      'sha256: e02ae60e86b80da3866098c0d731630d4e199cb11ebf40d78caa508f58e4cf1d',
    );
    expect(result.stdout).toContain('gold labels: starter_labels_not_independently_adjudicated');
  });

  it('exits 1 with a read error for a dataset version that does not exist', () => {
    const result = run('--dataset', 'v9');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('READ_ERROR');
  });

  it('exits 2 on unknown flags or a malformed version', () => {
    expect(run('--bogus').status).toBe(2);
    expect(run('--dataset', '../etc').status).toBe(2);
  });

  it('emits machine-readable JSON on request', () => {
    const result = run('--json');

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'valid',
      caseCount: 80,
      criticalCaseCount: 44,
      annotationReview: 'single_reviewer_author_pass',
    });
  });
});
