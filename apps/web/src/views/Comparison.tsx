import { comparisonSchema, runListSchema } from '../api.ts';
import { Load } from '../components.tsx';
import { formatMs } from '../format.ts';
import { useApi } from '../hooks.ts';

const METRICS = [
  ['decisionAccuracy', 'Decision accuracy'],
  ['routeAccuracy', 'Route accuracy'],
  ['intentAccuracy', 'Intent accuracy'],
  ['mustEscalateRecall', 'Must-escalate recall'],
] as const;

function Bar({ label, value }: { label: string; value: number | null }) {
  const percent = value === null ? 0 : Math.round(value * 1000) / 10;
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <span className="bar-track" aria-hidden="true">
        <span className="bar-fill" style={{ width: `${String(percent)}%` }} />
      </span>
      <span className="bar-value">{value === null ? 'n/a' : `${percent.toFixed(1)}%`}</span>
    </div>
  );
}

function CaseLinks({ runId, cases }: { runId: string; cases: readonly string[] }) {
  if (cases.length === 0) return <p className="muted">None.</p>;
  return (
    <ul className="inline-list">
      {cases.map((caseId) => (
        <li key={caseId}>
          <a href={`#/runs/${runId}/cases/${caseId}`}>{caseId}</a>
        </li>
      ))}
    </ul>
  );
}

export function ComparisonView({
  candidate,
  baseline,
}: {
  candidate: string | null;
  baseline: string | null;
}) {
  const runs = useApi('/api/v1/evaluation-runs?limit=50&status=completed', runListSchema);
  const comparison = useApi(
    candidate !== null && baseline !== null
      ? `/api/v1/evaluation-runs/${candidate}/compare?baselineRunId=${baseline}`
      : null,
    comparisonSchema,
  );
  const choose = (next: { candidate?: string; baseline?: string }) => {
    const params = new URLSearchParams({
      candidate: next.candidate ?? candidate ?? '',
      baseline: next.baseline ?? baseline ?? '',
    });
    window.location.hash = `#/compare?${params.toString()}`;
  };

  return (
    <section aria-labelledby="compare-heading">
      <h2 id="compare-heading">Candidate vs baseline</h2>
      <Load value={runs}>
        {(data) => (
          <div className="filters">
            {(['candidate', 'baseline'] as const).map((role) => (
              <label className="field" key={role}>
                {role === 'candidate' ? 'Candidate run' : 'Baseline run'}
                <select
                  value={(role === 'candidate' ? candidate : baseline) ?? ''}
                  onChange={(event) => {
                    choose({ [role]: event.target.value });
                  }}
                >
                  <option value="">Choose a completed run</option>
                  {data.items.map((run) => (
                    <option key={run.id} value={run.id}>
                      {run.agent.version} · {run.gateStatus ?? 'no gate'} · {run.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
      </Load>
      {candidate !== null && baseline !== null && (
        <Load value={comparison}>
          {(data) => (
            <>
              <div className="compare-grid">
                <div className="panel">
                  <h3>Baseline</h3>
                  {METRICS.map(([key, label]) => (
                    <Bar key={key} label={label} value={data.metricDeltas[key].baseline} />
                  ))}
                </div>
                <div className="panel">
                  <h3>Candidate</h3>
                  {METRICS.map(([key, label]) => (
                    <Bar key={key} label={label} value={data.metricDeltas[key].candidate} />
                  ))}
                </div>
              </div>
              <p className="muted">
                p95 latency {formatMs(data.latency.baselineP95)} →{' '}
                {formatMs(data.latency.candidateP95)}
                {data.latency.comparable ? '' : ' (below the noise floor, not compared)'}.
              </p>
              <h3>New failures ({String(data.newFailures.length)})</h3>
              {data.newFailures.length === 0 ? (
                <p className="muted">None.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Case</th>
                      <th scope="col">Newly failing rules</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.newFailures.map((failure) => (
                      <tr key={failure.caseId}>
                        <td>
                          <a href={`#/runs/${data.candidateRunId}/cases/${failure.caseId}`}>
                            {failure.caseId}
                          </a>
                        </td>
                        <td>{failure.ruleIds.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <h3>Fixed cases ({String(data.fixedCases.length)})</h3>
              <CaseLinks runId={data.candidateRunId} cases={data.fixedCases} />
              <h3>Unchanged failures ({String(data.unchangedFailures.length)})</h3>
              <CaseLinks runId={data.candidateRunId} cases={data.unchangedFailures} />
              <h3>Execution errors ({String(data.executionErrors.length)})</h3>
              <CaseLinks runId={data.candidateRunId} cases={data.executionErrors} />
            </>
          )}
        </Load>
      )}
    </section>
  );
}
