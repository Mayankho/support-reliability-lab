import { metrics } from '@opentelemetry/api';

const RUN_STATUSES = new Set(['completed', 'errored', 'cancelled']);
const CASE_STATUSES = new Set(['pass', 'fail', 'error']);
const RISKS = new Set(['critical', 'high', 'standard']);
const RULE_ID = /^[A-Z_]{3,40}$/u;
const BLOCK_CATEGORIES = new Set([
  'critical',
  'threshold',
  'regression',
  'error',
  'integrity',
  'incompatible_baseline',
]);

/** Label values come from closed sets; anything else is bucketed so cardinality stays bounded. */
const bounded = (value: string, allowed: ReadonlySet<string>) =>
  allowed.has(value) ? value : 'other';

function meter() {
  return metrics.getMeter('support-reliability-lab');
}

export function recordRunFinished(status: string): void {
  meter()
    .createCounter('eval_runs_total', { description: 'Evaluation runs by final status' })
    .add(1, {
      status: bounded(status, RUN_STATUSES),
    });
}

export function recordCaseResult(input: {
  status: string;
  risk: string;
  durationMs: number;
  failedRules: ReadonlyArray<{ ruleId: string; severity: string }>;
  costUsd: number | null;
  costKnown: boolean;
}): void {
  const m = meter();
  m.createCounter('eval_case_results_total', {
    description: 'Case results by status and risk',
  }).add(1, {
    status: bounded(input.status, CASE_STATUSES),
    risk: bounded(input.risk, RISKS),
  });
  m.createHistogram('eval_duration_ms', {
    description: 'Per-case adapter duration',
    unit: 'ms',
  }).record(input.durationMs);
  const failures = m.createCounter('eval_rule_failures_total', {
    description: 'Rule failures and errors by rule and severity',
  });
  for (const rule of input.failedRules) {
    failures.add(1, {
      rule_id: RULE_ID.test(rule.ruleId) ? rule.ruleId : 'other',
      severity: bounded(rule.severity, RISKS),
    });
  }
  if (input.costKnown && input.costUsd !== null) {
    m.createCounter('agent_estimated_cost_usd', {
      description: 'Reported model cost; offline adapter is $0',
    }).add(input.costUsd);
  }
}

export function recordGateOutcome(status: string, blockers: readonly string[]): void {
  const counter = meter().createCounter('eval_gate_blocked_total', {
    description: 'Gate blocks and errors by reason category',
  });
  if (status === 'PASS') return;
  const categories = new Set(blockers.map((blocker) => blocker.split(':')[0] ?? 'other'));
  for (const category of categories) {
    counter.add(1, { reason_category: bounded(category, BLOCK_CATEGORIES) });
  }
}

export function recordLeaseRecovery(): void {
  meter()
    .createCounter('eval_worker_lease_recovery_total', {
      description: 'Stale jobs recovered from expired leases',
    })
    .add(1);
}

export function recordDatasetIntegrityError(): void {
  meter()
    .createCounter('eval_dataset_integrity_errors_total', {
      description: 'Dataset hash, count, or schema failures',
    })
    .add(1);
}
