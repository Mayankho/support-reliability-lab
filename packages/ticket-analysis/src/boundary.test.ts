import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OWN_SRC = fileURLToPath(new URL('.', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path);
    return /\.tsx?$/u.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

const importsOf = (text: string) =>
  [...text.matchAll(/from\s+'([^']+)'/gu)].map((match) => match[1] ?? '');

const own = sourceFiles(OWN_SRC).map((path) => ({
  name: relative(OWN_SRC, path),
  text: readFileSync(path, 'utf8'),
}));

const corePackages = [
  'contracts',
  'policies',
  'dataset',
  'agent',
  'evals',
  'db',
  'runner',
  'telemetry',
];
const core = [
  ...corePackages.map((name) => join(ROOT, 'packages', name, 'src')),
  join(ROOT, 'apps', 'api', 'src'),
  join(ROOT, 'apps', 'web', 'src'),
].flatMap((dir) =>
  sourceFiles(dir).map((path) => ({
    name: relative(ROOT, path),
    text: readFileSync(path, 'utf8'),
  })),
);

describe('ticket-analysis boundary', () => {
  it('has source files to check', () => {
    expect(own.length).toBeGreaterThan(5);
    expect(core.length).toBeGreaterThan(50);
  });

  it.each(own.map((file) => [file.name, file.text]))(
    '%s stays offline and outside the evaluation path',
    (_name, text) => {
      for (const specifier of importsOf(text)) {
        expect(specifier).not.toMatch(
          /^(node:)?(http|https|http2|net|tls|dgram|dns|child_process|worker_threads)$|^(undici|axios|node-fetch|ws)$/u,
        );
        expect(specifier).not.toMatch(/^@srl\/(agent|evals|db|runner|telemetry)$/u);
      }
      expect(text).not.toMatch(/\b(fetch|WebSocket|XMLHttpRequest)\s*\(/u);
      expect(text).not.toMatch(/\bimport\s*\(/u);
    },
  );

  it('is not imported by the agent, graders, gate, worker, API, or UI', () => {
    for (const file of core) {
      expect(importsOf(file.text), file.name).not.toContain('@srl/ticket-analysis');
    }
    for (const name of [...corePackages.map((p) => `packages/${p}`), 'apps/api', 'apps/web']) {
      const manifest = readFileSync(join(ROOT, name, 'package.json'), 'utf8');
      expect(manifest, name).not.toContain('@srl/ticket-analysis');
    }
  });
});
