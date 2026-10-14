import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText, type ScanFinding } from '../scan.ts';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SKIP = [/^pnpm-lock\.yaml$/u, /\.(png|jpg|jpeg|gif|webp|ico|woff2?|docx|pdf)$/iu];

/**
 * Test files deliberately contain fake credential-shaped strings to prove redaction works. Each entry
 * names the file and the kind, so a new kind of finding in the same file still fails the scan.
 */
const SCANNER_FIXTURE_KINDS: ReadonlyArray<ScanFinding['kind']> = [
  'private_key',
  'access_token',
  'email',
  'phone',
  'payment_card',
  'connection_password',
];

const REVIEWED_TEST_FIXTURES: ReadonlyArray<{ path: RegExp; kind: ScanFinding['kind'] }> = [
  { path: /^apps\/api\/src\/(config|api\.int)\.test\.ts$/u, kind: 'connection_password' },
  { path: /^packages\/db\/src\/cli\/env\.test\.ts$/u, kind: 'connection_password' },
  { path: /^packages\/telemetry\/src\/telemetry\.test\.ts$/u, kind: 'connection_password' },
  // The scanner's own tests must contain one example of every kind it detects.
  ...SCANNER_FIXTURE_KINDS.map((kind) => ({
    path: /^packages\/dataset\/src\/scan\.test\.ts$/u,
    kind,
  })),
];

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((path) => path.length > 0);
}

function artifactFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? artifactFiles(path) : [relative(ROOT, path)];
  });
}

function main(): number {
  const files = [...new Set([...trackedFiles(), ...artifactFiles(join(ROOT, 'artifacts'))])].filter(
    (path) => !SKIP.some((pattern) => pattern.test(path)) && existsSync(join(ROOT, path)),
  );
  const findings = files
    .flatMap((path) => scanText(path, readFileSync(join(ROOT, path), 'utf8')))
    .filter(
      (finding) =>
        !REVIEWED_TEST_FIXTURES.some(
          (allowed) => allowed.path.test(finding.path) && allowed.kind === finding.kind,
        ),
    );

  for (const finding of findings) {
    process.stdout.write(`${finding.path}:${String(finding.line)} ${finding.kind}\n`);
  }
  process.stdout.write(
    `scanned ${String(files.length)} files, ${String(findings.length)} finding(s)\n`,
  );
  return findings.length === 0 ? 0 : 1;
}

process.exitCode = main();
