import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { computeGate } from '@srl/evals';
import { readReportFile } from '../report.ts';
import { loadVerifiedDataset } from '../service.ts';
import { cliArgs } from './common.ts';

const USAGE =
  'usage: pnpm eval:gate -- --report <run-report.json> [--baseline <run-report.json>] [--out <gate.json>]';

/** Recomputes the gate from report files alone; no database needed. Exit 0 only on PASS. */
async function main(): Promise<number> {
  let values: {
    report?: string | undefined;
    baseline?: string | undefined;
    out?: string | undefined;
  };
  try {
    ({ values } = parseArgs({
      args: cliArgs(),
      options: {
        report: { type: 'string' },
        baseline: { type: 'string' },
        out: { type: 'string' },
      },
      strict: true,
    }));
  } catch {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  if (values.report === undefined) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  try {
    const candidate = await readReportFile(values.report);
    const baseline =
      values.baseline === undefined ? undefined : await readReportFile(values.baseline);
    const fixture = await loadVerifiedDataset('v1');
    const result = computeGate({
      candidate,
      ...(baseline === undefined ? {} : { baseline }),
      expectedDataset: { version: fixture.version, sha256: fixture.sha256 },
    });
    process.stdout.write(`gate ${result.status}\n`);
    for (const blocker of [...result.errors, ...result.blockers]) {
      process.stdout.write(`  ${blocker}\n`);
    }
    if (values.out !== undefined && result.artifact !== null) {
      await writeFile(values.out, `${JSON.stringify(result.artifact, null, 2)}\n`);
    }
    return result.status === 'PASS' ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `eval:gate failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
    );
    return 1;
  }
}

process.exitCode = await main();
