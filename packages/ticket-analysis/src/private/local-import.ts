import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { triageThread } from '../classify/triage.ts';
import { loadTaxonomy } from '../taxonomy/load.ts';
import { groupThreads } from '../thread/group.ts';
import { parseMessages } from '../thread/parse.ts';

export const PERMISSION_FLAG = 'i-have-permission-to-process-this-file';
export const MAX_INPUT_BYTES = 200 * 1024 * 1024;
/** Counts below this are reported as `<10` so small groups cannot be singled out. */
export const SUPPRESS_BELOW = 10;

export type LocalImportOutcome =
  | { ok: true; summaryPath: string; threads: number }
  | {
      ok: false;
      code:
        | 'USAGE'
        | 'PERMISSION_NOT_ACKNOWLEDGED'
        | 'PATH_NOT_ABSOLUTE'
        | 'PATH_INSIDE_REPOSITORY'
        | 'INPUT_NOT_A_FILE'
        | 'INPUT_TOO_LARGE'
        | 'OUTPUT_NOT_EMPTY'
        | 'INPUT_INVALID';
    };

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** Resolves symlinks on the deepest existing ancestor, so a link cannot smuggle a path into the repo. */
function realish(path: string): string {
  let current = resolve(path);
  const rest: string[] = [];
  while (!existsSync(current)) {
    rest.unshift(current.slice(dirname(current).length + 1));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return join(realpathSync(current), ...rest);
}

const count = (n: number): number | string =>
  n < SUPPRESS_BELOW ? `<${String(SUPPRESS_BELOW)}` : n;

function tally(values: readonly string[]): Record<string, number | string> {
  const totals = new Map<string, number>();
  for (const value of values) totals.set(value, (totals.get(value) ?? 0) + 1);
  return Object.fromEntries(
    [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, count(v)]),
  );
}

/**
 * Optional, local-only aggregation of a real-format export. It is not wired into any script, CI job,
 * or demo, and refuses to run without an explicit acknowledgment. Input and output must both be
 * absolute paths outside the repository. The output holds aggregate counts only: no thread or ticket
 * IDs, no text, and every count under ten suppressed.
 */
export function runLocalImport(argv: readonly string[], repoRoot: string): LocalImportOutcome {
  let values: { input?: string; output?: string; [PERMISSION_FLAG]: boolean };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        input: { type: 'string' },
        output: { type: 'string' },
        [PERMISSION_FLAG]: { type: 'boolean', default: false },
      },
      strict: true,
    }));
  } catch {
    return { ok: false, code: 'USAGE' };
  }
  if (values.input === undefined || values.output === undefined)
    return { ok: false, code: 'USAGE' };
  if (!values[PERMISSION_FLAG]) return { ok: false, code: 'PERMISSION_NOT_ACKNOWLEDGED' };
  if (!isAbsolute(values.input) || !isAbsolute(values.output))
    return { ok: false, code: 'PATH_NOT_ABSOLUTE' };

  const root = realpathSync(repoRoot);
  const input = realish(values.input);
  const output = realish(values.output);
  if (inside(root, input) || inside(root, output))
    return { ok: false, code: 'PATH_INSIDE_REPOSITORY' };
  if (!existsSync(input) || !statSync(input).isFile())
    return { ok: false, code: 'INPUT_NOT_A_FILE' };
  if (statSync(input).size > MAX_INPUT_BYTES) return { ok: false, code: 'INPUT_TOO_LARGE' };
  if (existsSync(output) && readdirSync(output).length > 0)
    return { ok: false, code: 'OUTPUT_NOT_EMPTY' };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(input, 'utf8'));
  } catch {
    return { ok: false, code: 'INPUT_INVALID' };
  }
  const parsed = parseMessages(raw);
  if (!parsed.ok) return { ok: false, code: 'INPUT_INVALID' };

  const taxonomy = loadTaxonomy();
  const triages = groupThreads(parsed.messages).map((thread) => triageThread(thread, { taxonomy }));
  const summary = {
    kind: 'private_aggregate_summary',
    notice:
      'Local, private output. Aggregate counts only, with counts under ten suppressed. Not a measurement of accuracy or of any production system. Do not publish.',
    taxonomyVersion: taxonomy.taxonomy.taxonomyVersion,
    records: count(Array.isArray(raw) ? raw.length : 0),
    rejectedRecords: tally(parsed.issues.map((issue) => issue.code)),
    threads: count(triages.length),
    abstained: count(triages.filter((t) => t.abstained).length),
    reviewRequired: count(triages.filter((t) => t.reviewRequired).length),
    primaryL1: tally(triages.map((t) => t.primaryL1 ?? 'abstained')),
    primaryL2: tally(triages.map((t) => t.primaryL2 ?? 'abstained')),
    flags: tally(triages.flatMap((t) => t.flags.map((flag) => flag.code))),
    anomalies: tally(triages.flatMap((t) => t.anomalies)),
  };

  mkdirSync(output, { recursive: true, mode: 0o700 });
  chmodSync(output, 0o700);
  const summaryPath = `${output}${sep}summary.json`;
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  chmodSync(summaryPath, 0o600);
  return { ok: true, summaryPath, threads: triages.length };
}
