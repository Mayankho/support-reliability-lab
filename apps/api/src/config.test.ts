import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, type EnvKey } from './config.ts';

function validEnv(overrides: Partial<Record<EnvKey, string>> = {}): Record<EnvKey, string> {
  return {
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: 'postgresql://app:app@localhost:5432/support_reliability',
    MODEL_ENABLED: 'false',
    ALLOW_EXTERNAL_CALLS: 'false',
    USE_SYNTHETIC_FIXTURES: 'true',
    EVAL_DEFAULT_DATASET: 'v1',
    EVAL_MAX_CONCURRENCY: '4',
    EVAL_CASE_TIMEOUT_MS: '5000',
    EVAL_MAX_CASES: '100',
    OTEL_EXPORTER: 'console',
    LOG_LEVEL: 'silent',
    ...overrides,
  };
}

describe('loadConfig', () => {
  it('parses a valid environment into typed settings', () => {
    const config = loadConfig(validEnv());

    expect(config).toEqual({
      NODE_ENV: 'test',
      PORT: 3000,
      DATABASE_URL: 'postgresql://app:app@localhost:5432/support_reliability',
      MODEL_ENABLED: false,
      ALLOW_EXTERNAL_CALLS: false,
      USE_SYNTHETIC_FIXTURES: true,
      EVAL_DEFAULT_DATASET: 'v1',
      EVAL_MAX_CONCURRENCY: 4,
      EVAL_CASE_TIMEOUT_MS: 5000,
      EVAL_MAX_CASES: 100,
      OTEL_EXPORTER: 'console',
      LOG_LEVEL: 'silent',
    });
  });

  it('applies defaults when optional variables are omitted', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://app:app@localhost:5432/support_reliability',
    });

    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(3000);
    expect(config.MODEL_ENABLED).toBe(false);
    expect(config.ALLOW_EXTERNAL_CALLS).toBe(false);
    expect(config.USE_SYNTHETIC_FIXTURES).toBe(true);
    expect(config.EVAL_DEFAULT_DATASET).toBe('v1');
    expect(config.OTEL_EXPORTER).toBe('console');
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('treats blank optional variables as missing', () => {
    const config = loadConfig(
      validEnv({
        PORT: '   ',
        LOG_LEVEL: '',
      }),
    );

    expect(config.PORT).toBe(3000);
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('rejects a missing database URL', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('rejects external models', () => {
    expect(() => loadConfig(validEnv({ MODEL_ENABLED: 'true' }))).toThrow(
      /MODEL_ENABLED: must be false/,
    );
  });

  it('rejects external network calls', () => {
    expect(() => loadConfig(validEnv({ ALLOW_EXTERNAL_CALLS: 'true' }))).toThrow(
      /ALLOW_EXTERNAL_CALLS: must be false/,
    );
  });

  it('rejects non-synthetic fixture mode', () => {
    expect(() => loadConfig(validEnv({ USE_SYNTHETIC_FIXTURES: 'false' }))).toThrow(
      /USE_SYNTHETIC_FIXTURES: must be true/,
    );
  });

  it('rejects boolean values that are not exact true or false strings', () => {
    expect(() => loadConfig(validEnv({ MODEL_ENABLED: '1' }))).toThrow(ConfigError);
    expect(() => loadConfig(validEnv({ ALLOW_EXTERNAL_CALLS: 'yes' }))).toThrow(ConfigError);
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadConfig(validEnv({ PORT: '0' }))).toThrow(/PORT: must be between 1 and 65535/);
    expect(() => loadConfig(validEnv({ PORT: '70000' }))).toThrow(/PORT/);
    expect(() => loadConfig(validEnv({ PORT: 'abc' }))).toThrow(/PORT/);
  });

  it('rejects evaluation bounds outside the configured limits', () => {
    expect(() => loadConfig(validEnv({ EVAL_MAX_CONCURRENCY: '0' }))).toThrow(
      /EVAL_MAX_CONCURRENCY/,
    );
    expect(() => loadConfig(validEnv({ EVAL_MAX_CASES: '101' }))).toThrow(/EVAL_MAX_CASES/);
    expect(() => loadConfig(validEnv({ EVAL_CASE_TIMEOUT_MS: '60001' }))).toThrow(
      /EVAL_CASE_TIMEOUT_MS/,
    );
  });

  it('does not echo database credentials when the URL is invalid', () => {
    const secret = 'supersecret-db-password';
    let caught: unknown;
    try {
      loadConfig(
        validEnv({
          DATABASE_URL: `postgresql://app:${secret}@localhost:5432/support_reliability extra`,
        }),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    expect(caught instanceof Error ? caught.message : '').not.toContain(secret);
  });
});
