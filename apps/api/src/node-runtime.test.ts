import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('plain Node runtime', () => {
  it('loads the API module graph with Node type stripping', () => {
    const entry = fileURLToPath(new URL('./app.ts', import.meta.url));
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(entry)});`],
      {
        encoding: 'utf8',
      },
    );

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
