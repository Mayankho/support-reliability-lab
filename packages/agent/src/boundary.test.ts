import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('.', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      entry.name !== 'test-helpers.ts'
      ? [path]
      : [];
  });
}

const files = sourceFiles(srcDir).map((path) => ({
  name: relative(srcDir, path),
  text: readFileSync(path, 'utf8'),
}));

describe('agent package boundary', () => {
  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files.map((file) => [file.name, file.text]))(
    '%s does not import graders, datasets, or fixtures',
    (_name, text) => {
      const imports = [...text.matchAll(/from\s+'([^']+)'/gu)].map((match) => match[1]);
      for (const specifier of imports) {
        expect(specifier).not.toMatch(/@srl\/(evals|dataset|db|runner)|fixtures|golden/u);
      }
    },
  );

  it.each(files.map((file) => [file.name, file.text]))(
    '%s has no network access',
    (_name, text) => {
      const imports = [...text.matchAll(/from\s+'([^']+)'/gu)].map((match) => match[1]);
      for (const specifier of imports) {
        expect(specifier).not.toMatch(
          /^(node:)?(http|https|http2|net|tls|dgram|dns|child_process|worker_threads)$|^(undici|axios|node-fetch|ws)$/u,
        );
      }
      expect(text).not.toMatch(/\b(fetch|WebSocket|XMLHttpRequest)\s*\(/u);
      expect(text).not.toMatch(/\bimport\s*\(/u);
    },
  );

  it.each(files.map((file) => [file.name, file.text]))(
    '%s does not reference gold labels, case IDs, or grader rule names',
    (_name, text) => {
      expect(text).not.toMatch(/\bexpected\b/u);
      expect(text).not.toMatch(/(?<!KB-)\b(REF|CAN|GEN|PRO|SEC|KB|TOOL|ADV)-\d{3}\b/u);
      expect(text).not.toMatch(
        /\b(SCHEMA_VALID|TENANT_ISOLATION|NO_FALSE_COMPLETION|NO_UNSAFE_ACTION|INTENT_MATCH|DECISION_MATCH|ROUTE_MATCH|ESCALATION_MATCH|POLICY_CITATIONS|RESPONSE_CONCEPTS)\b/u,
      );
    },
  );
});
