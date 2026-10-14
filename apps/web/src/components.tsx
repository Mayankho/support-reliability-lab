import type { ReactNode } from 'react';
import type { ApiFailure } from './api.ts';
import { gateLabel } from './format.ts';
import type { Loadable } from './hooks.ts';

export function GateBadge({ status }: { status: string | null }) {
  const tone =
    status === 'PASS'
      ? 'pass'
      : status === 'BLOCK'
        ? 'block'
        : status === 'ERROR'
          ? 'error'
          : 'none';
  return <span className={`badge badge-${tone}`}>{gateLabel(status)}</span>;
}

export function CaseStatus({ status }: { status: string }) {
  const symbol = status === 'pass' ? '✓' : status === 'fail' ? '✕' : '!';
  return (
    <span className={`case-status case-${status}`}>
      <span aria-hidden="true">{symbol}</span> {status}
    </span>
  );
}

export function ErrorNotice({ error }: { error: ApiFailure }) {
  if (error.status === 401) {
    return (
      <div className="notice notice-error" role="alert">
        <strong>Sign-in required.</strong> The API is running with token authentication. Generate a
        token with <code>pnpm auth:token</code> and paste it into the token field above.
      </div>
    );
  }
  return (
    <div className="notice notice-error" role="alert">
      <strong>{error.code}</strong>: {error.message}
    </div>
  );
}

/** Renders loading and error states consistently, and the content once data is ready. */
export function Load<T>({
  value,
  children,
}: {
  value: Loadable<T>;
  children: (data: T) => ReactNode;
}) {
  if (value.state === 'loading') {
    return (
      <p className="muted" role="status">
        Loading…
      </p>
    );
  }
  if (value.state === 'error') {
    return <ErrorNotice error={value.error} />;
  }
  return <>{children(value.data)}</>;
}

export function KeyValue({ rows }: { rows: ReadonlyArray<[string, ReactNode]> }) {
  return (
    <table className="kv">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
