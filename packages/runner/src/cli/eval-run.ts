import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { postgresMessage } from '@srl/db';
import { readReportFile, evaluateAndGate, buildReportFromDb } from '../report.ts';
import { RunRequestError, enqueueRun, runUntilFinished } from '../service.ts';
import { formatRunSummary } from '../summary.ts';
import { ARTIFACTS_DIR, cliArgs, openDatabase } from './common.ts';

const USAGE =
  'usage: pnpm eval:run -- --agent <version> [--dataset v1] [--baseline-run <run id> | --baseline-report <path>] [--out <dir>]';

async function main(): Promise<number> {
  let options: {
    agent: string;
    dataset: string;
    baselineRun?: string;
    baselineReport?: string;
    out?: string;
  };
  try {
    const { values } = parseArgs({
      args: cliArgs(),
      options: {
        agent: { type: 'string' },
        dataset: { type: 'string', default: 'v1' },
        'baseline-run': { type: 'string' },
        'baseline-report': { type: 'string' },
        out: { type: 'string' },
      },
      strict: true,
    });
    if (
      values.agent === undefined ||
      (values['baseline-run'] !== undefined && values['baseline-report'] !== undefined)
    ) {
      throw new Error('invalid arguments');
    }
    options = {
      agent: values.agent,
      dataset: values.dataset,
      ...(values['baseline-run'] === undefined ? {} : { baselineRun: values['baseline-run'] }),
      ...(values['baseline-report'] === undefined
        ? {}
        : { baselineReport: values['baseline-report'] }),
      ...(values.out === undefined ? {} : { out: values.out }),
    };
  } catch {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  let handle: Awaited<ReturnType<typeof openDatabase>>;
  try {
    handle = await openDatabase();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'database unavailable'}\n`);
    return 2;
  }

  try {
    const runId = await enqueueRun(handle.db, {
      datasetVersion: options.dataset,
      agentVersion: options.agent,
      baselineRunId: options.baselineRun ?? null,
      workspaceId: 'ws_demo',
      actor: 'cli',
      correlationId: `cli:${String(process.pid)}`,
    });
    process.stdout.write(`enqueued run ${runId}\n`);
    const status = await runUntilFinished(
      { db: handle.db, workerId: `cli-${String(process.pid)}`, leaseMs: 30_000 },
      runId,
    );
    process.stdout.write(`run ${runId} ${status}\n`);

    const baseline =
      options.baselineRun !== undefined
        ? await buildReportFromDb(handle.db, options.baselineRun)
        : options.baselineReport !== undefined
          ? await readReportFile(options.baselineReport)
          : undefined;
    const outcome = await evaluateAndGate(
      handle.db,
      runId,
      options.out ?? join(ARTIFACTS_DIR, 'runs', runId),
      baseline,
    );
    process.stdout.write(
      `${formatRunSummary(outcome.report, outcome.gate, outcome.paths.reportHtml)}\n`,
    );
    return outcome.status === 'PASS' ? 0 : 1;
  } catch (error) {
    const message =
      error instanceof RunRequestError ? `${error.code}: ${error.message}` : postgresMessage(error);
    process.stderr.write(`eval:run failed: ${message}\n`);
    return 1;
  } finally {
    await handle.close();
  }
}

process.exitCode = await main();
