import { useEffect, useState } from 'react';
import type { z } from 'zod';
import { ApiFailure, getJson } from './api.ts';

export type Loadable<T> =
  { state: 'loading' } | { state: 'error'; error: ApiFailure } | { state: 'ready'; data: T };

/** Loads and validates one API resource; `path === null` means nothing to load yet. */
export function useApi<T>(path: string | null, schema: z.ZodType<T>, reloadKey = 0): Loadable<T> {
  const [result, setResult] = useState<Loadable<T>>({ state: 'loading' });
  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    setResult({ state: 'loading' });
    getJson(path, schema)
      .then((data) => {
        if (!cancelled) setResult({ state: 'ready', data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setResult({
          state: 'error',
          error:
            error instanceof ApiFailure
              ? error
              : new ApiFailure(0, 'NETWORK', 'The API could not be reached.'),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [path, schema, reloadKey]);
  return result;
}
