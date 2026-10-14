import { sql } from 'drizzle-orm';
import type { Executor } from '../client.ts';

export interface WorkspaceMetrics {
  runsByStatus: Record<string, number>;
  gatesByStatus: Record<string, number>;
  latestByAgentVersion: Array<{
    agentVersion: string;
    runId: string;
    gateStatus: string | null;
    caseCount: number;
    casesWithResults: number;
    casesWithCriticalFailures: number;
    casesWithErrors: number;
  }>;
}

/**
 * Workspace-level aggregates. Case counts are DISTINCT cases from the latest completed run per agent
 * version, so every percentage a client computes has an explicit denominator.
 */
export async function workspaceMetrics(
  db: Executor,
  workspaceId: string,
): Promise<WorkspaceMetrics> {
  const runs = await db.execute<{ status: string; count: number }>(sql`
    select status, count(*)::int as count from evaluation_runs
    where workspace_id = ${workspaceId} group by status order by status`);
  const gates = await db.execute<{ gate: string; count: number }>(sql`
    select coalesce(gate_status, 'not_recorded') as gate, count(*)::int as count from evaluation_runs
    where workspace_id = ${workspaceId} group by gate order by gate`);
  const latest = await db.execute<{
    agent_version: string;
    run_id: string;
    gate_status: string | null;
    case_count: number;
    cases_with_results: number;
    cases_with_critical_failures: number;
    cases_with_errors: number;
  }>(sql`
    with latest as (
      select distinct on (av.version) av.version as agent_version, er.id as run_id, er.gate_status, er.case_count
      from evaluation_runs er
      join agent_versions av on av.id = er.agent_version_id
      where er.workspace_id = ${workspaceId} and er.status = 'completed'
      order by av.version, er.created_at desc, er.id desc
    )
    select
      l.agent_version, l.run_id, l.gate_status, l.case_count,
      count(distinct cr.case_id)::int as cases_with_results,
      count(distinct cr.case_id) filter (where rr.severity = 'critical' and rr.verdict = 'fail')::int
        as cases_with_critical_failures,
      count(distinct cr.case_id) filter (where rr.verdict = 'error')::int as cases_with_errors
    from latest l
    left join case_results cr on cr.run_id = l.run_id
    left join rule_results rr on rr.case_result_id = cr.id
    group by l.agent_version, l.run_id, l.gate_status, l.case_count
    order by l.agent_version`);

  return {
    runsByStatus: Object.fromEntries(runs.rows.map((row) => [row.status, row.count])),
    gatesByStatus: Object.fromEntries(gates.rows.map((row) => [row.gate, row.count])),
    latestByAgentVersion: latest.rows.map((row) => ({
      agentVersion: row.agent_version,
      runId: row.run_id,
      gateStatus: row.gate_status,
      caseCount: row.case_count,
      casesWithResults: row.cases_with_results,
      casesWithCriticalFailures: row.cases_with_critical_failures,
      casesWithErrors: row.cases_with_errors,
    })),
  };
}
