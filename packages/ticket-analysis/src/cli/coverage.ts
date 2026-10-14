import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { buildCoverage, CROSSWALK_DOC } from '../crosswalk/coverage.ts';

async function main(): Promise<number> {
  let values: { write: boolean; check: boolean };
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2).filter((arg) => arg !== '--'),
      options: {
        write: { type: 'boolean', default: false },
        check: { type: 'boolean', default: false },
      },
      strict: true,
    }));
  } catch {
    process.stderr.write('usage: pnpm tickets:coverage [-- --write | --check]\n');
    return 2;
  }

  const build = await buildCoverage();
  if (!build.ok) {
    for (const problem of build.problems) process.stderr.write(`${problem}\n`);
    return 1;
  }
  const { crosswalk, coverage } = build;
  const total = crosswalk.records.length;
  const byStatus = (status: string) =>
    crosswalk.records.filter((r) => r.coverageStatus === status).length;
  const touched = coverage.filter((c) => c.status !== 'missing').length;
  const urgent = coverage.filter(
    (c) => c.status === 'missing' && (c.priority === 'P1' || c.priority === 'P2'),
  );

  process.stdout.write(
    [
      `crosswalk ${crosswalk.crosswalkVersion} (${crosswalk.reviewStatus}) for dataset ${crosswalk.datasetVersion}`,
      `  cases: ${String(total)}; covered ${String(byStatus('covered'))}, partial ${String(byStatus('partial'))}, needs_review ${String(byStatus('needs_review'))}`,
      `  issue types touched: ${String(touched)} of ${String(coverage.length)}`,
      `  P1/P2 issue types with no case: ${urgent.map((c) => c.code).join(', ') || 'none'}`,
      `  gaps proposed (not authored): ${crosswalk.gaps.map((g) => `${g.id} ${g.l2}`).join(', ')}`,
      '',
    ].join('\n'),
  );

  if (values.write) {
    writeFileSync(CROSSWALK_DOC, build.markdown);
    process.stdout.write(`wrote ${CROSSWALK_DOC}\n`);
  }
  if (values.check) {
    let current: string;
    try {
      current = readFileSync(CROSSWALK_DOC, 'utf8');
    } catch {
      current = '';
    }
    if (current !== build.markdown) {
      process.stderr.write(
        'docs/TAXONOMY_COVERAGE_CROSSWALK.md is out of date; run with --write\n',
      );
      return 1;
    }
  }
  return 0;
}

process.exitCode = await main();
