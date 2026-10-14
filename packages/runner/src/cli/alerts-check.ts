import { join } from 'node:path';
import { postgresMessage } from '@srl/db';
import {
  evaluateAlerts,
  loadGatedRunTimeline,
  openAlerts,
  renderIncidentReport,
  writeIncidentReport,
} from '../alerts.ts';
import { ARTIFACTS_DIR, openDatabase } from './common.ts';

/** Evaluates alert rules over recorded gates, writes an incident report, and exits 1 while any alert is open. */
async function main(): Promise<number> {
  let handle: Awaited<ReturnType<typeof openDatabase>>;
  try {
    handle = await openDatabase();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'database unavailable'}\n`);
    return 2;
  }
  try {
    const now = new Date();
    const timeline = await loadGatedRunTimeline(handle.db, 'ws_demo');
    const events = evaluateAlerts(timeline, now);
    for (const event of events) {
      const evidence =
        event.evidence === null
          ? ''
          : ` [case ${event.evidence.caseId}, trace ${event.evidence.traceId}]`;
      process.stdout.write(
        `${event.state.toUpperCase().padEnd(8)} ${event.rule} ${event.agentVersion} run ${event.runId}: ${event.detail}${evidence}\n`,
      );
    }
    const open = openAlerts(events);
    const path = await writeIncidentReport(
      join(ARTIFACTS_DIR, 'incidents'),
      renderIncidentReport(events, timeline, now),
      now,
    );
    process.stdout.write(
      `${String(events.length)} event(s), ${String(open.length)} open. Report: ${path}\n`,
    );
    return open.length === 0 ? 0 : 1;
  } catch (error) {
    process.stderr.write(`alerts:check failed: ${postgresMessage(error)}\n`);
    return 1;
  } finally {
    await handle.close();
  }
}

process.exitCode = await main();
