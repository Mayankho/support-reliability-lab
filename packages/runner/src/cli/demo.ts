import { join } from 'node:path';
import { postgresMessage } from '@srl/db';
import { runDemo } from '../demo.ts';
import { formatRunSummary } from '../summary.ts';
import { ARTIFACTS_DIR, openDatabase } from './common.ts';

async function main(): Promise<number> {
  let handle: Awaited<ReturnType<typeof openDatabase>>;
  try {
    handle = await openDatabase();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'database unavailable'}\n`);
    process.stderr.write(
      'Start Postgres with `docker compose up -d db` and set DATABASE_URL (see .env.example).\n',
    );
    return 2;
  }

  try {
    const outDir = join(ARTIFACTS_DIR, 'demo');
    const result = await runDemo(handle.db, outDir);
    for (const [index, step] of result.steps.entries()) {
      process.stdout.write(`\n[${String(index + 1)}/3] expected ${step.expected}\n`);
      process.stdout.write(
        `${formatRunSummary(step.outcome.report, step.outcome.gate, step.outcome.paths.reportHtml)}\n`,
      );
    }
    process.stdout.write(`\n${result.verdict}\n`);
    if (result.ok) {
      process.stdout.write(
        [
          'The regression is one copy entry in packages/agent/src/copy/regression-demo.ts: the refund-review',
          'reply says the refund already happened while claimsActionCompleted stays false. repaired-v1 restores',
          'the truthful copy and enables the completion-wording guard (packages/agent/src/copy/guard.ts).',
          `Side-by-side summary: ${result.indexPath}`,
          '',
        ].join('\n'),
      );
    }
    return result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`demo failed: ${postgresMessage(error)}\n`);
    return 1;
  } finally {
    await handle.close();
  }
}

process.exitCode = await main();
