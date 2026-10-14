import { caseDetailSchema } from '../api.ts';
import { CaseStatus, KeyValue, Load } from '../components.tsx';
import { formatMs, formatValue } from '../format.ts';
import { useApi } from '../hooks.ts';

const ACCOUNT_FIELDS = [
  'authenticated',
  'workspaceId',
  'actorWorkspaceId',
  'subscription',
  'planStatus',
  'lastPurchaseAgeDays',
  'lastPurchaseCreditsUsed',
  'paymentSettled',
  'disputed',
  'generationStatus',
  'generationChargedCredits',
] as const;

export function CaseDetailView({ runId, caseId }: { runId: string; caseId: string }) {
  const detail = useApi(`/api/v1/evaluation-runs/${runId}/cases/${caseId}`, caseDetailSchema);
  return (
    <Load value={detail}>
      {(data) => {
        const failing = data.rules.filter(
          (rule) => rule.verdict === 'fail' || rule.verdict === 'error',
        );
        const passing = data.rules.filter(
          (rule) => rule.verdict !== 'fail' && rule.verdict !== 'error',
        );
        return (
          <article aria-labelledby="case-heading">
            <p>
              <a href={`#/runs/${runId}`}>← Back to run</a>
            </p>
            <h2 id="case-heading">
              {data.caseId} <CaseStatus status={data.status} />
            </h2>
            <p className="muted">
              {data.category}, {data.risk} risk. Synthetic case.
            </p>

            <section aria-labelledby="input-heading">
              <h3 id="input-heading">Customer message</h3>
              <blockquote className="message">{data.input.message}</blockquote>
              <KeyValue
                rows={ACCOUNT_FIELDS.map((field) => [
                  field,
                  formatValue(data.input.account[field]),
                ])}
              />
            </section>

            <section aria-labelledby="behavior-heading">
              <h3 id="behavior-heading">Expected and actual behavior</h3>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    <th scope="col">Expected</th>
                    <th scope="col">Actual</th>
                  </tr>
                </thead>
                <tbody>
                  {(['intent', 'decision', 'route', 'proposedAction'] as const).map((field) => (
                    <tr key={field}>
                      <th scope="row">{field}</th>
                      <td>
                        {data.expected?.[field] ?? <span className="muted">reviewers only</span>}
                      </td>
                      <td>{data.output?.[field] ?? 'no output'}</td>
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">claimsActionCompleted</th>
                    <td>false</td>
                    <td>
                      {data.output === null
                        ? 'no output'
                        : String(data.output.claimsActionCompleted)}
                    </td>
                  </tr>
                </tbody>
              </table>
              {data.expected === undefined && (
                <p className="muted">Expected values are shown only to authenticated reviewers.</p>
              )}
              <h4>Agent reply</h4>
              <blockquote className="message">
                {data.output?.customerReply ??
                  `No output (${data.executionError ?? 'invalid output'})`}
              </blockquote>
              <p className="muted">
                Citations:{' '}
                {data.output?.policyCitations
                  .map((citation) => `${citation.id}@${citation.version}`)
                  .join(', ') || 'none'}
                . Adapter time {formatMs(data.durationMs)}.
              </p>
            </section>

            <section aria-labelledby="rules-heading">
              <h3 id="rules-heading">Triggered rules ({String(failing.length)})</h3>
              {failing.length === 0 ? (
                <p>No rule failed.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Rule</th>
                      <th scope="col">Verdict</th>
                      <th scope="col">Severity</th>
                      <th scope="col">Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failing.map((rule) => (
                      <tr key={rule.ruleId}>
                        <td>
                          <code>{rule.ruleId}</code>
                        </td>
                        <td>{rule.verdict}</td>
                        <td>{rule.severity}</td>
                        <td>{rule.evidence}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p>
                Suggested fix layer (hypothesis, needs human review):{' '}
                <strong>{data.suggestedFixLayers.join(', ') || 'none'}</strong>
              </p>
              <details>
                <summary>Passing and not-applicable rules ({String(passing.length)})</summary>
                <ul>
                  {passing.map((rule) => (
                    <li key={rule.ruleId}>
                      <code>{rule.ruleId}</code>: {rule.verdict}
                    </li>
                  ))}
                </ul>
              </details>
            </section>

            <section aria-labelledby="trace-heading">
              <h3 id="trace-heading">Trace</h3>
              <p className="muted">
                Trace ID <code>{data.traceId}</code>
              </p>
              <ol className="timeline">
                {data.trace.map((event) => (
                  <li key={event.spanId}>
                    <code>{event.kind}</code>{' '}
                    <span className="muted">{JSON.stringify(event.attributes)}</span>
                  </li>
                ))}
              </ol>
            </section>
          </article>
        );
      }}
    </Load>
  );
}
