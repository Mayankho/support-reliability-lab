import { useEffect, useState } from 'react';
import { getToken, setToken } from './api.ts';
import { CaseDetailView } from './views/CaseDetail.tsx';
import { ComparisonView } from './views/Comparison.tsx';
import { ReleaseDecisionView } from './views/ReleaseDecision.tsx';
import { RunOverview } from './views/RunOverview.tsx';

type Route =
  | { view: 'overview'; runId: string | null }
  | { view: 'case'; runId: string; caseId: string }
  | { view: 'decision'; runId: string }
  | { view: 'compare'; candidate: string | null; baseline: string | null };

const ID = '([0-9a-f-]{36})';

export function parseRoute(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#/u, '').split('?');
  let match = new RegExp(`^/runs/${ID}/cases/([A-Z]{2,5}-\\d{3})$`, 'u').exec(path);
  if (match?.[1] !== undefined && match[2] !== undefined)
    return { view: 'case', runId: match[1], caseId: match[2] };
  match = new RegExp(`^/runs/${ID}/gate$`, 'u').exec(path);
  if (match?.[1] !== undefined) return { view: 'decision', runId: match[1] };
  match = new RegExp(`^/runs/${ID}$`, 'u').exec(path);
  if (match?.[1] !== undefined) return { view: 'overview', runId: match[1] };
  if (path === '/compare') {
    const params = new URLSearchParams(query);
    const pick = (key: string) => {
      const value = params.get(key);
      return value !== null && new RegExp(`^${ID}$`, 'u').test(value) ? value : null;
    };
    return { view: 'compare', candidate: pick('candidate'), baseline: pick('baseline') };
  }
  return { view: 'overview', runId: null };
}

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash));
      document.getElementById('main')?.focus();
    };
    window.addEventListener('hashchange', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
    };
  }, []);
  return route;
}

function TokenField() {
  const [value, setValue] = useState(getToken());
  return (
    <form
      className="token"
      onSubmit={(event) => {
        event.preventDefault();
        setToken(value);
        window.location.reload();
      }}
    >
      <label htmlFor="api-token">API token</label>
      <input
        id="api-token"
        type="password"
        autoComplete="off"
        placeholder="only needed when AUTH_MODE=jwt"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
      />
      <button type="submit">Save</button>
    </form>
  );
}

export function App() {
  const route = useRoute();
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div>
          <h1>Support Reliability Lab</h1>
          <p className="muted">Release review for synthetic support-agent evaluations</p>
        </div>
        <nav aria-label="Primary">
          <a href="#/" aria-current={route.view === 'overview' ? 'page' : undefined}>
            Runs
          </a>
          <a href="#/compare" aria-current={route.view === 'compare' ? 'page' : undefined}>
            Compare
          </a>
        </nav>
        <TokenField />
      </header>
      <main id="main" tabIndex={-1}>
        {route.view === 'overview' && <RunOverview runId={route.runId} />}
        {route.view === 'case' && <CaseDetailView runId={route.runId} caseId={route.caseId} />}
        {route.view === 'decision' && <ReleaseDecisionView runId={route.runId} />}
        {route.view === 'compare' && (
          <ComparisonView candidate={route.candidate} baseline={route.baseline} />
        )}
      </main>
    </>
  );
}
