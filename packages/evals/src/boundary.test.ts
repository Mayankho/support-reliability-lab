import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcDir = fileURLToPath(new URL('.', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('grader package boundary', () => {
  const files = sourceFiles(srcDir).map((path) => ({
    name: relative(srcDir, path),
    imports: [...readFileSync(path, 'utf8').matchAll(/from\s+'([^']+)'/gu)].map(
      (match) => match[1],
    ),
  }));

  it.each(files.map((file) => [file.name, file.imports]))(
    '%s does not import the agent or its policy logic',
    (_name, imports) => {
      for (const specifier of imports) {
        expect(specifier).not.toMatch(/@srl\/(agent|policies)/u);
      }
    },
  );
});
