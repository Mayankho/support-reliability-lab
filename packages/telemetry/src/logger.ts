import pino, { type DestinationStream, type Logger } from 'pino';

/**
 * Paths that never reach a log line: credentials, connection strings, and customer or agent text.
 * Operational logs carry IDs, codes, counts, and durations only.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  '*.password',
  '*.token',
  '*.authorization',
  '*.databaseUrl',
  '*.DATABASE_URL',
  '*.message',
  '*.customerReply',
  '*.input',
  '*.body',
] as const;

export function createLogger(
  service: string,
  level = 'info',
  destination?: DestinationStream,
): Logger {
  return pino(
    {
      name: service,
      level,
      base: { service },
      redact: { paths: [...REDACT_PATHS], censor: '[redacted]' },
    },
    destination,
  );
}

export type { Logger };
