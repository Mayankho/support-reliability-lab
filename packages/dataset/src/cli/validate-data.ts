import { parseArgs } from 'node:util';
import { formatIssue } from '../issues.ts';
import { loadDataset } from '../load.ts';

const USAGE = 'usage: pnpm eval:validate-data [--dataset v1] [--json]';

function main(): Promise<number> | number {
  let values: { dataset: string; json: boolean };
  try {
    const parsed = parseArgs({
      args: process.argv.slice(2).filter((arg) => arg !== '--'),
      options: {
        dataset: { type: 'string', default: 'v1' },
        json: { type: 'boolean', default: false },
      },
      strict: true,
    });
    values = { dataset: parsed.values.dataset, json: parsed.values.json };
  } catch {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  if (!/^v[0-9]+(?:\.[0-9]+)?$/u.test(values.dataset)) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  return run(values.dataset, values.json);
}

async function run(version: string, json: boolean): Promise<number> {
  const result = await loadDataset(version);

  if (json) {
    const body = result.ok
      ? {
          status: 'valid',
          datasetVersion: result.dataset.version,
          sha256: result.dataset.sha256,
          caseCount: result.dataset.cases.length,
          criticalCaseCount: result.dataset.manifest.criticalCaseCount,
          policy: result.dataset.policy,
          humanReviewStatus: result.dataset.manifest.humanReviewStatus,
          annotationReview: result.review === null ? null : result.review.reviewType,
        }
      : { status: 'invalid', observedSha256: result.observedSha256, issues: result.issues };
    process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
    return result.ok ? 0 : 1;
  }

  if (!result.ok) {
    process.stdout.write(`dataset ${version}: INVALID (${String(result.issues.length)} issues)\n`);
    for (const issue of result.issues) {
      process.stdout.write(`  ${formatIssue(issue)}\n`);
    }
    return 1;
  }

  const { dataset, review } = result;
  const lines = [
    `dataset ${dataset.version}: VALID`,
    `  cases: ${String(dataset.cases.length)} (${String(dataset.manifest.criticalCaseCount)} critical)`,
    `  sha256: ${dataset.sha256}`,
    `  policy: ${dataset.policy.id} sha256 ${dataset.policy.sha256}`,
    `  gold labels: ${dataset.manifest.humanReviewStatus}`,
    review === null
      ? '  annotation review: none on file'
      : `  annotation review: ${review.reviewType}, independently adjudicated: ${String(review.independentlyAdjudicated)}`,
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

process.exitCode = await main();
