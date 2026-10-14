import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { postgresMessage } from '@srl/db';
import { gateFinishedRun } from '../report.ts';
import { workOnce } from '../worker.ts';
import { ARTIFACTS_DIR, cliArgs, openDatabase } from './common.ts';

/** Long-running worker for runs enqueued through the API. `--once` drains the queue and exits. */
async function main(): Promise<number> {
  let once: boolean;
  try {
    once = parseArgs({
      args: cliArgs(),
      options: { once: { type: 'boolean', default: false } },
      strict: true,
    }).values.once;
  } catch {
    process.stderr.write('usage: pnpm worker [-- --once]\n');
    return 2;
  }

  const handle = await openDatabase();
  const workerId = `worker-${String(process.pid)}`;
  const state = { stopping: false };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      state.stopping = true;
    });
  }

  try {
    process.stdout.write(`${workerId} polling for runs\n`);
    while (!state.stopping) {
      const outcome = await workOnce({ db: handle.db, workerId, leaseMs: 30_000 });
      if (outcome !== null) {
        const suffix = outcome.errorCode === null ? '' : ` (${outcome.errorCode})`;
        process.stdout.write(`${workerId} run ${outcome.runId}: ${outcome.outcome}${suffix}\n`);
        if (outcome.outcome === 'completed' || outcome.outcome === 'errored') {
          const gate = await gateFinishedRun(handle.db, outcome.runId, join(ARTIFACTS_DIR, 'runs'));
          process.stdout.write(
            `${workerId} run ${outcome.runId}: gate ${gate.status} (${gate.paths.reportHtml})\n`,
          );
        }
        continue;
      }
      if (once) break;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    return 0;
  } catch (error) {
    process.stderr.write(`worker failed: ${postgresMessage(error)}\n`);
    return 1;
  } finally {
    await handle.close();
  }
}

process.exitCode = await main();
