import { gateSchema, runDetailSchema } from '../api.ts';
import { GateBadge, KeyValue, Load } from '../components.tsx';
import { blockerCase, commitUrl, shortHash } from '../format.ts';
import { useApi } from '../hooks.ts';

function statement(status: 'PASS' | 'BLOCK' | 'ERROR'): string {
  switch (status) {
    case 'PASS':
      return 'Promotion allowed: every case has complete results, no critical rule failed, and all thresholds are met on the configured synthetic suite.';
    case 'BLOCK':
      return 'Promotion blocked: the evidence is complete and shows at least one blocking problem on the configured synthetic suite.';
    case 'ERROR':
      return 'Promotion blocked: the evidence is incomplete or could not be compared, so the gate refuses to pass.';
  }
}

export function ReleaseDecisionView({ runId }: { runId: string }) {
  const gate = useApi(`/api/v1/evaluation-runs/${runId}/gate`, gateSchema);
  const run = useApi(`/api/v1/evaluation-runs/${runId}`, runDetailSchema);
  return (
    <section aria-labelledby="decision-heading">
      <p>
        <a href={`#/runs/${runId}`}>← Back to run</a>
      </p>
      <h2 id="decision-heading">Release decision</h2>
      <Load value={gate}>
        {(data) => {
          const commit = run.state === 'ready' ? run.data.agent.sourceCommit : null;
          const url = commitUrl(commit);
          return (
            <>
              <p className="decision">
                <GateBadge status={data.status} /> {statement(data.status)}
              </p>
              <KeyValue
                rows={[
                  ['Agent version', data.agentVersion],
                  [
                    'Agent source hash',
                    <code key="src">{shortHash(data.agentSourceHash, 16)}</code>,
                  ],
                  [
                    'Source commit',
                    commit === null ? (
                      'unknown'
                    ) : url === null ? (
                      <code key="c">{commit}</code>
                    ) : (
                      <a key="c" href={url}>
                        <code>{commit}</code>
                      </a>
                    ),
                  ],
                  [
                    'Dataset',
                    <span key="ds">
                      {data.datasetVersion}, sha256 <code>{shortHash(data.datasetSha256, 16)}</code>
                    </span>,
                  ],
                  ['Policy sha256', <code key="pol">{shortHash(data.policySha256, 16)}</code>],
                  ['Evaluator', data.evaluatorVersion],
                  [
                    'Baseline run',
                    data.baselineRunId === null ? (
                      'none'
                    ) : (
                      <code key="b">{data.baselineRunId}</code>
                    ),
                  ],
                  ['Gate recorded', data.generatedAt],
                ]}
              />
              <h3>Blockers ({String(data.blockers.length)})</h3>
              {data.blockers.length === 0 ? (
                <p>None.</p>
              ) : (
                <ul className="blockers">
                  {data.blockers.map((blocker) => {
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
              )}
              {data.warnings.length > 0 && (
                <p className="muted">Warnings: {data.warnings.join(', ')}</p>
              )}
              <h3>Thresholds and denominators</h3>
              <KeyValue
                rows={Object.entries({ ...data.thresholds, ...data.denominators }).map(
                  ([key, value]) => [key, String(value)],
                )}
              />
              <p className="muted">
                Thresholds are illustrative criteria for a small synthetic suite, not production
                safety claims.
              </p>
              <details>
                <summary>Gate artifact (gate.json)</summary>
                <pre>{JSON.stringify(data, null, 2)}</pre>
              </details>
            </>
          );
        }}
      </Load>
    </section>
  );
}
