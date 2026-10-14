/**
 * Alert rules, kept in source control so thresholds are reviewed like code. No delivery channel:
 * events are printed and written to an incident report.
 */
export const ALERT_RULES = {
  CRITICAL_RULE_FAILURE: {
    description: 'A gated run has at least one critical rule failure.',
    minCriticalCases: 1,
  },
  RUN_ERROR_SPIKE: {
    description: 'Too many of the most recent runs errored.',
    window: 5,
    maxErrored: 2,
  },
  EVAL_STALE_OR_MISSING: {
    description: 'No completed, gated run for the reference agent recently.',
    maxAgeHours: 24,
  },
  LATENCY_REGRESSION: {
    description: 'p95 latency exceeded 1.3x its baseline (comparable timings only).',
    maxRatio: 1.3,
  },
} as const;

export type AlertRuleId = keyof typeof ALERT_RULES;

export interface GatedRun {
  runId: string;
  agentVersion: string;
  status: string;
  gateStatus: string | null;
  createdAt: Date;
  baselineRunId: string | null;
  criticalFailureCases: number;
  blockers: readonly string[];
  latencyRatio: number | null;
  firstFailingCase: { caseId: string; traceId: string; ruleId: string } | null;
}

export interface AlertEvent {
  /** Identity of the alert: a firing and its matching resolution share a key. */
  key: string;
  rule: AlertRuleId;
  state: 'firing' | 'resolved';
  at: string;
  runId: string;
  agentVersion: string;
  detail: string;
  evidence: { caseId: string; traceId: string; ruleId: string } | null;
}

/**
 * Replays runs in creation order and emits a firing event when a rule starts failing and a resolved
 * event when a later run clears it. Candidate runs (those with a baseline) share one track, so a
 * blocked candidate followed by a passing one reads as failure and recovery.
 */
export function evaluateAlerts(
  runs: readonly GatedRun[],
  now: Date,
  referenceAgent = 'reference-v1',
): AlertEvent[] {
  const events: AlertEvent[] = [];
  const ordered = [...runs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const firing = new Map<string, AlertEvent>();
  const track = (run: GatedRun) =>
    run.baselineRunId === null ? `baseline:${run.agentVersion}` : 'candidate';

  const transition = (
    key: string,
    active: boolean,
    make: () => Omit<AlertEvent, 'key'>,
    run: GatedRun,
  ) => {
    const open = firing.get(key);
    if (active && open === undefined) {
      const event: AlertEvent = { key, ...make() };
      firing.set(key, event);
      events.push(event);
    } else if (!active && open !== undefined) {
      firing.delete(key);
      events.push({
        ...open,
        state: 'resolved',
        at: run.createdAt.toISOString(),
        runId: run.runId,
        agentVersion: run.agentVersion,
        detail: `Cleared by run ${run.runId}.`,
        evidence: null,
      });
    }
  };

  const recent: GatedRun[] = [];
  for (const run of ordered) {
    if (run.gateStatus !== null) {
      transition(
        `CRITICAL_RULE_FAILURE:${track(run)}`,
        run.criticalFailureCases >= ALERT_RULES.CRITICAL_RULE_FAILURE.minCriticalCases,
        () => ({
          rule: 'CRITICAL_RULE_FAILURE',
          state: 'firing',
          at: run.createdAt.toISOString(),
          runId: run.runId,
          agentVersion: run.agentVersion,
          detail: `${String(run.criticalFailureCases)} case(s) with critical failures; gate ${run.gateStatus ?? 'not recorded'}. ${run.blockers.slice(0, 3).join(', ')}`,
          evidence: run.firstFailingCase,
        }),
        run,
      );
      transition(
        `LATENCY_REGRESSION:${track(run)}`,
        run.latencyRatio !== null && run.latencyRatio > ALERT_RULES.LATENCY_REGRESSION.maxRatio,
        () => ({
          rule: 'LATENCY_REGRESSION',
          state: 'firing',
          at: run.createdAt.toISOString(),
          runId: run.runId,
          agentVersion: run.agentVersion,
          detail: `p95 latency ${(run.latencyRatio ?? 0).toFixed(2)}x baseline.`,
          evidence: null,
        }),
        run,
      );
    }

    recent.push(run);
    const windowRuns = recent.slice(-ALERT_RULES.RUN_ERROR_SPIKE.window);
    const errored = windowRuns.filter((candidate) => candidate.status === 'errored').length;
    transition(
      'RUN_ERROR_SPIKE',
      errored > ALERT_RULES.RUN_ERROR_SPIKE.maxErrored,
      () => ({
        rule: 'RUN_ERROR_SPIKE',
        state: 'firing',
        at: run.createdAt.toISOString(),
        runId: run.runId,
        agentVersion: run.agentVersion,
        detail: `${String(errored)} of the last ${String(windowRuns.length)} runs errored.`,
        evidence: null,
      }),
      run,
    );
  }

  const lastReference = ordered
    .filter(
      (run) =>
        run.agentVersion === referenceAgent &&
        run.status === 'completed' &&
        run.gateStatus !== null,
    )
    .at(-1);
  const maxAgeMs = ALERT_RULES.EVAL_STALE_OR_MISSING.maxAgeHours * 3_600_000;
  if (lastReference === undefined || now.getTime() - lastReference.createdAt.getTime() > maxAgeMs) {
    events.push({
      key: `EVAL_STALE_OR_MISSING:${referenceAgent}`,
      rule: 'EVAL_STALE_OR_MISSING',
      state: 'firing',
      at: now.toISOString(),
      runId: lastReference?.runId ?? 'none',
      agentVersion: referenceAgent,
      detail:
        lastReference === undefined
          ? `No completed, gated ${referenceAgent} run found.`
          : `Last gated ${referenceAgent} run is older than ${String(ALERT_RULES.EVAL_STALE_OR_MISSING.maxAgeHours)} hours.`,
      evidence: null,
    });
  }
  return events;
}
