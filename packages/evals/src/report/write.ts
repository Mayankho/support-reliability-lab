import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderRunReportHtml } from './html.ts';
import type { GateArtifact, RunReport } from './schema.ts';

export interface WrittenArtifacts {
  dir: string;
  reportJson: string;
  gateJson: string;
  reportHtml: string;
}

export async function writeRunArtifacts(
  dir: string,
  report: RunReport,
  gate: GateArtifact,
): Promise<WrittenArtifacts> {
  await mkdir(dir, { recursive: true });
  const paths = {
    dir,
    reportJson: join(dir, 'run-report.json'),
    gateJson: join(dir, 'gate.json'),
    reportHtml: join(dir, 'run-report.html'),
  };
  await writeFile(paths.reportJson, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(paths.gateJson, `${JSON.stringify(gate, null, 2)}\n`);
  await writeFile(paths.reportHtml, renderRunReportHtml(report, gate));
  return paths;
}
