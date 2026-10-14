/** The underlying Postgres error message, unwrapping the query wrapper Drizzle adds. */
export function postgresMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause: unknown = error.cause;
    if (cause instanceof Error) {
      return cause.message;
    }
    return error.message;
  }
  return String(error);
}

/** Postgres SQLSTATE code, if the error carries one. */
export function postgresCode(error: unknown): string | null {
  const candidates = [error, error instanceof Error ? error.cause : undefined];
  for (const candidate of candidates) {
    if (
      typeof candidate === 'object' &&
      candidate !== null &&
      'code' in candidate &&
      typeof candidate.code === 'string'
    ) {
      return candidate.code;
    }
  }
  return null;
}
