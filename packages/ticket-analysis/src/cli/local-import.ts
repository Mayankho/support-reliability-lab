import { fileURLToPath } from 'node:url';
import { PERMISSION_FLAG, runLocalImport } from '../private/local-import.ts';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const USAGE = `usage: node packages/ticket-analysis/src/cli/local-import.ts --input /absolute/path/outside/repo.json --output /absolute/dir/outside/repo --${PERMISSION_FLAG}\n`;

const outcome = runLocalImport(
  process.argv.slice(2).filter((arg) => arg !== '--'),
  ROOT,
);
if (outcome.ok) {
  process.stdout.write(
    `wrote aggregate summary for ${outcome.threads < 10 ? '<10' : String(outcome.threads)} threads to ${outcome.summaryPath}\n`,
  );
  process.exitCode = 0;
} else {
  process.stderr.write(`local import refused: ${outcome.code}\n`);
  if (outcome.code === 'USAGE') process.stderr.write(USAGE);
  process.exitCode = outcome.code === 'USAGE' ? 2 : 1;
}
