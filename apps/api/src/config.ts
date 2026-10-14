import { z } from 'zod';

const envBooleanSchema = z.enum(['true', 'false']);
const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);
const integerStringSchema = z.string().regex(/^[0-9]+$/u, {
  error: 'must be a non-negative integer',
});

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: integerStringSchema,
    DATABASE_URL: z.string().regex(/^postgresql:\/\/[^/\s]+\/[^?\s]+$/u, {
      error: 'must be a postgresql:// URL',
    }),
    MODEL_ENABLED: envBooleanSchema,
    ALLOW_EXTERNAL_CALLS: envBooleanSchema,
    USE_SYNTHETIC_FIXTURES: envBooleanSchema,
    EVAL_DEFAULT_DATASET: z.string().regex(/^v[0-9]+(?:\.[0-9]+)?$/u, {
      error: 'EVAL_DEFAULT_DATASET must look like v1',
    }),
    EVAL_MAX_CONCURRENCY: integerStringSchema,
    EVAL_CASE_TIMEOUT_MS: integerStringSchema,
    EVAL_MAX_CASES: integerStringSchema,
    OTEL_EXPORTER: z.enum(['console', 'none']),
    LOG_LEVEL: logLevelSchema,
    AUTH_MODE: z.enum(['local', 'jwt']),
    JWT_ISSUER: z.string().min(1).max(200).optional(),
    JWT_AUDIENCE: z.string().min(1).max(200).optional(),
    JWT_JWKS_FILE: z.string().min(1).max(500).optional(),
  })
  .superRefine((value, context) => {
    if (value.AUTH_MODE === 'jwt') {
      for (const field of ['JWT_ISSUER', 'JWT_AUDIENCE', 'JWT_JWKS_FILE'] as const) {
        if (value[field] === undefined) {
          context.addIssue({
            code: 'custom',
            path: [field],
            message: 'is required when AUTH_MODE=jwt',
          });
        }
      }
    }
    if (value.AUTH_MODE === 'local' && value.NODE_ENV === 'production') {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message: 'must be jwt in production. Local mode has no authentication.',
      });
    }
    addRangeIssue(context, 'PORT', value.PORT, 1, 65_535);
    addRangeIssue(context, 'EVAL_MAX_CONCURRENCY', value.EVAL_MAX_CONCURRENCY, 1, 16);
    addRangeIssue(context, 'EVAL_CASE_TIMEOUT_MS', value.EVAL_CASE_TIMEOUT_MS, 1, 60_000);
    addRangeIssue(context, 'EVAL_MAX_CASES', value.EVAL_MAX_CASES, 1, 100);

    if (value.MODEL_ENABLED !== 'false') {
      context.addIssue({
        code: 'custom',
        path: ['MODEL_ENABLED'],
        message: 'must be false. External models are disabled.',
      });
    }
    if (value.ALLOW_EXTERNAL_CALLS !== 'false') {
      context.addIssue({
        code: 'custom',
        path: ['ALLOW_EXTERNAL_CALLS'],
        message: 'must be false. External network calls are disabled.',
      });
    }
    if (value.USE_SYNTHETIC_FIXTURES !== 'true') {
      context.addIssue({
        code: 'custom',
        path: ['USE_SYNTHETIC_FIXTURES'],
        message: 'must be true. Only synthetic fixtures are allowed.',
      });
    }
  });

const envDefaults = {
  NODE_ENV: 'development',
  PORT: '3000',
  MODEL_ENABLED: 'false',
  ALLOW_EXTERNAL_CALLS: 'false',
  USE_SYNTHETIC_FIXTURES: 'true',
  EVAL_DEFAULT_DATASET: 'v1',
  EVAL_MAX_CONCURRENCY: '4',
  EVAL_CASE_TIMEOUT_MS: '5000',
  EVAL_MAX_CASES: '100',
  OTEL_EXPORTER: 'none',
  LOG_LEVEL: 'info',
  AUTH_MODE: 'local',
} as const;

const envKeys = [
  'NODE_ENV',
  'PORT',
  'DATABASE_URL',
  'MODEL_ENABLED',
  'ALLOW_EXTERNAL_CALLS',
  'USE_SYNTHETIC_FIXTURES',
  'EVAL_DEFAULT_DATASET',
  'EVAL_MAX_CONCURRENCY',
  'EVAL_CASE_TIMEOUT_MS',
  'EVAL_MAX_CASES',
  'OTEL_EXPORTER',
  'LOG_LEVEL',
  'AUTH_MODE',
  'JWT_ISSUER',
  'JWT_AUDIENCE',
  'JWT_JWKS_FILE',
] as const;

export type EnvKey = (typeof envKeys)[number];

export interface AppConfig {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  MODEL_ENABLED: false;
  ALLOW_EXTERNAL_CALLS: false;
  USE_SYNTHETIC_FIXTURES: true;
  EVAL_DEFAULT_DATASET: string;
  EVAL_MAX_CONCURRENCY: number;
  EVAL_CASE_TIMEOUT_MS: number;
  EVAL_MAX_CASES: number;
  OTEL_EXPORTER: 'console' | 'none';
  LOG_LEVEL: z.infer<typeof logLevelSchema>;
  AUTH: AuthConfig;
}

export type AuthConfig =
  { mode: 'local' } | { mode: 'jwt'; issuer: string; audience: string; jwksFile: string };

export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(issues.join('; '));
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

export function loadConfig(source: Readonly<Record<string, string | undefined>>): AppConfig {
  const input: Partial<Record<EnvKey, string>> = {};
  for (const key of envKeys) {
    const raw = source[key];
    if (raw === undefined || raw.trim() === '') {
      if (key in envDefaults) {
        input[key] = envDefaults[key as keyof typeof envDefaults];
      }
      continue;
    }
    input[key] = raw.trim();
  }

  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map(formatIssue));
  }

  return {
    NODE_ENV: parsed.data.NODE_ENV,
    PORT: Number(parsed.data.PORT),
    DATABASE_URL: parsed.data.DATABASE_URL,
    MODEL_ENABLED: false,
    ALLOW_EXTERNAL_CALLS: false,
    USE_SYNTHETIC_FIXTURES: true,
    EVAL_DEFAULT_DATASET: parsed.data.EVAL_DEFAULT_DATASET,
    EVAL_MAX_CONCURRENCY: Number(parsed.data.EVAL_MAX_CONCURRENCY),
    EVAL_CASE_TIMEOUT_MS: Number(parsed.data.EVAL_CASE_TIMEOUT_MS),
    EVAL_MAX_CASES: Number(parsed.data.EVAL_MAX_CASES),
    OTEL_EXPORTER: parsed.data.OTEL_EXPORTER,
    LOG_LEVEL: parsed.data.LOG_LEVEL,
    AUTH:
      parsed.data.AUTH_MODE === 'jwt'
        ? {
            mode: 'jwt',
            issuer: parsed.data.JWT_ISSUER ?? '',
            audience: parsed.data.JWT_AUDIENCE ?? '',
            jwksFile: parsed.data.JWT_JWKS_FILE ?? '',
          }
        : { mode: 'local' },
  };
}

function addRangeIssue(
  context: z.RefinementCtx,
  field: string,
  raw: string,
  min: number,
  max: number,
): void {
  if (!/^[0-9]+$/u.test(raw)) {
    return;
  }
  const value = Number(raw);
  if (value < min || value > max) {
    context.addIssue({
      code: 'custom',
      path: [field],
      message: `must be between ${String(min)} and ${String(max)}`,
    });
  }
}

function formatIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.map(String).join('.');
  return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
}
