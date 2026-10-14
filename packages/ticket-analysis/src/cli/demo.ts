import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTicketDemo } from '../demo.ts';

const OUT_DIR = fileURLToPath(new URL('../../../../artifacts/tickets/', import.meta.url));

function main(): number {
  let result: ReturnType<typeof runTicketDemo>;
  try {
    result = runTicketDemo();
  } catch (error) {
    process.stderr.write(`tickets:demo failed: ${error instanceof Error ? error.name : 'error'}\n`);
    return 1;
  }
  process.stdout.write(`${result.lines.join('\n')}\n`);
  if (!result.ok) return 1;
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, 'triage.json');
  writeFileSync(path, `${JSON.stringify(result.artifact, null, 2)}\n`);
  process.stdout.write(`Wrote ${path}\n`);
  return 0;
}

process.exitCode = main();
