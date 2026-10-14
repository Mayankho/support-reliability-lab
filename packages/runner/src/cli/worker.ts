import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { postgresMessage } from '@srl/db';
import { createLogger, initTelemetry } from '@srl/telemetry';
import { gateFinishedRun } from '../report.ts';
import { workOnce } from '../worker.ts';
import { ARTIFACTS_DIR, cliArgs, openDatabase } from './common.ts';

/**
 * Long-running worker for runs enqueued through the API. Logs structured JSON; `--once` drains the
 * queue and exits. Spans go to the console exporter when OTEL_EXPORTER=console.
 */
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
  const telemetry = initTelemetry(
    process.env.OTEL_EXPORTER === 'console' ? 'console' : 'none',
    'srl-worker',
  );
  const workerId = `worker-${String(process.pid)}`;
  const log = createLogger('srl-worker', process.env.LOG_LEVEL ?? 'info').child({ workerId });
  const state = { stopping: false };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      state.stopping = true;
    });
  }

  try {
    log.info('polling for runs');
    while (!state.stopping) {
      const outcome = await workOnce({ db: handle.db, workerId, leaseMs: 30_000 });
      if (outcome !== null) {
        log.info(
          {
            runId: outcome.runId,
            outcome: outcome.outcome,
            errorCode: outcome.errorCode,
            storedCases: outcome.storedByThisWorker,
            recoveredStaleLease: outcome.recoveredStaleLease,
          },
          'job processed',
        );
        if (outcome.outcome === 'completed' || outcome.outcome === 'errored') {
          const gate = await gateFinishedRun(handle.db, outcome.runId, join(ARTIFACTS_DIR, 'runs'));
          log.info(
            { runId: outcome.runId, gateStatus: gate.status, blockers: gate.gate.blockers.length },
            'gate recorded',
          );
        }
        continue;
      }
      if (once) break;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    return 0;
  } catch (error) {
    log.error({ errorCode: 'worker_failed' }, postgresMessage(error));
    return 1;
  } finally {
    await telemetry.shutdown();
    await handle.close();
  }
}

process.exitCode = await main();
