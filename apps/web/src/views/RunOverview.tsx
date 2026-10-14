import { useState } from 'react';
import { caseListSchema, runDetailSchema, runListSchema } from '../api.ts';
import { CaseStatus, GateBadge, KeyValue, Load } from '../components.tsx';
import { blockerCase, formatDate, formatMs, formatRatio, shortHash } from '../format.ts';
import { useApi } from '../hooks.ts';
import { gateSchema } from '../api.ts';

const RULES = [
  'TENANT_ISOLATION',
  'NO_FALSE_COMPLETION',
  'NO_UNSAFE_ACTION',
  'DECISION_MATCH',
  'ROUTE_MATCH',
  'ESCALATION_MATCH',
  'POLICY_CITATIONS',
  'INTENT_MATCH',
] as const;

function RunList({ selected }: { selected: string | null }) {
  const [status, setStatus] = useState('');
  const runs = useApi(
    `/api/v1/evaluation-runs?limit=50${status === '' ? '' : `&status=${status}`}`,
    runListSchema,
  );
  return (
    <section aria-labelledby="runs-heading">
      <h2 id="runs-heading">Evaluation runs</h2>
      <label className="field">
        Status
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
          }}
        >
          <option value="">All</option>
          <option value="completed">Completed</option>
          <option value="queued">Queued</option>
          <option value="running">Running</option>
          <option value="errored">Errored</option>
        </select>
      </label>
      <Load value={runs}>
        {(data) =>
          data.items.length === 0 ? (
            <p className="muted">
              No runs yet. Run <code>pnpm demo</code> or enqueue one through the API.
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Agent version</th>
                  <th scope="col">Gate</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((run) => (
                  <tr key={run.id} aria-current={run.id === selected ? 'true' : undefined}>
                    <td>
                      <a href={`#/runs/${run.id}`}>{run.agent.version}</a>
                    </td>
                    <td>
                      <GateBadge status={run.gateStatus} />
                    </td>
                    <td>{run.status}</td>
                    <td>{formatDate(run.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Load>
    </section>
  );
}

function Blockers({ runId }: { runId: string }) {
  const gate = useApi(`/api/v1/evaluation-runs/${runId}/gate`, gateSchema);
  if (gate.state !== 'ready') return null;
  return gate.data.blockers.length === 0 ? (
    <p>No blockers.</p>
  ) : (
    <ul className="blockers">
      {gate.data.blockers.map((blocker) => {
        const caseId = blockerCase(blocker);
        return (
          <li key={blocker}>
            {caseId === null ? (
              <code>{blocker}</code>
            ) : (
              <a href={`#/runs/${runId}/cases/${caseId}`}>
                <code>{blocker}</code>
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CaseTable({ runId }: { runId: string }) {
  const [status, setStatus] = useState('fail');
  const [rule, setRule] = useState('');
  const query = new URLSearchParams({ limit: '100' });
  if (status !== '') query.set('status', status);
  if (rule !== '') {
    query.set('rule', rule);
    query.set('verdict', 'fail');
  }
  const cases = useApi(
    `/api/v1/evaluation-runs/${runId}/cases?${query.toString()}`,
    caseListSchema,
  );
  return (
    <section aria-labelledby="cases-heading">
      <h3 id="cases-heading">Cases</h3>
      <div className="filters">
        <label className="field">
          Case status
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
            }}
          >
            <option value="">All</option>
            <option value="fail">Failed</option>
            <option value="error">Errored</option>
            <option value="pass">Passed</option>
          </select>
        </label>
        <label className="field">
          Failing rule
          <select
            value={rule}
            onChange={(event) => {
              setRule(event.target.value);
            }}
          >
            <option value="">Any</option>
            {RULES.map((ruleId) => (
              <option key={ruleId} value={ruleId}>
                {ruleId}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Load value={cases}>
        {(data) => (
          <>
            <p className="muted">{String(data.total)} matching case(s).</p>
            {data.items.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th scope="col">Case</th>
                    <th scope="col">Category</th>
                    <th scope="col">Risk</th>
                    <th scope="col">Status</th>
                    <th scope="col">Failing rules</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.caseId}>
                      <td>
                        <a href={`#/runs/${runId}/cases/${item.caseId}`}>{item.caseId}</a>
                      </td>
                      <td>{item.category}</td>
                      <td>{item.risk}</td>
                      <td>
                        <CaseStatus status={item.status} />
                      </td>
                      <td>
                        {item.failingRules
                          .map((failing) => `${failing.ruleId} (${failing.severity})`)
                          .join(', ') || 'none'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </Load>
    </section>
  );
}

function RunSummary({ runId }: { runId: string }) {
  const run = useApi(`/api/v1/evaluation-runs/${runId}`, runDetailSchema);
  return (
    <Load value={run}>
      {(data) => (
        <section aria-labelledby="run-heading" className="panel">
          <h2 id="run-heading">
            {data.agent.version} <GateBadge status={data.gateStatus} />
          </h2>
          <KeyValue
            rows={[
              ['Run', <code key="id">{data.id}</code>],
              ['Status', `${data.status}${data.errorCode === null ? '' : ` (${data.errorCode})`}`],
              [
                'Cases with results',
                `${String(data.summary.totalCases)} of ${String(data.dataset.caseCount)}`,
              ],
              ['Cases with critical failures', String(data.summary.casesWithCriticalFailures)],
              [
                'Dataset',
                <span key="ds">
                  {data.dataset.version}, sha256 <code>{shortHash(data.dataset.sha256, 16)}</code>
                </span>,
              ],
              ['Agent source', <code key="src">{shortHash(data.agent.sourceHash, 16)}</code>],
              ['Created', formatDate(data.createdAt)],
              [
                'Decision accuracy',
                data.metrics === null ? 'n/a' : formatRatio(data.metrics.decisionAccuracy),
              ],
              [
                'Route accuracy',
                data.metrics === null ? 'n/a' : formatRatio(data.metrics.routeAccuracy),
              ],
              [
                'Must-escalate recall (critical)',
                data.metrics === null ? 'n/a' : formatRatio(data.metrics.mustEscalateRecall),
              ],
              [
                'Latency median / p95',
                data.metrics === null
                  ? 'n/a'
                  : `${formatMs(data.metrics.latencyMs.p50)} / ${formatMs(data.metrics.latencyMs.p95)}`,
              ],
            ]}
          />
          <p className="actions">
            <a href={`#/runs/${data.id}/gate`}>Release decision</a>
            {data.baselineRunId !== null && (
              <a href={`#/compare?candidate=${data.id}&baseline=${data.baselineRunId}`}>
                Compare with baseline
              </a>
            )}
          </p>
          {data.gateStatus !== null && (
            <>
              <h3>Blockers</h3>
              <Blockers runId={data.id} />
            </>
          )}
          {data.status === 'completed' && <CaseTable runId={data.id} />}
        </section>
      )}
    </Load>
  );
}

export function RunOverview({ runId }: { runId: string | null }) {
  return (
    <div className="overview">
      <RunList selected={runId} />
      {runId === null ? (
        <p className="muted">Select a run to see its gate, metrics, and cases.</p>
      ) : (
        <RunSummary runId={runId} />
      )}
    </div>
  );
}
