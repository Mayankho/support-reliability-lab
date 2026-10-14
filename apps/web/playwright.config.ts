import { defineConfig, devices } from '@playwright/test';
import { E2E, JWKS_FILE } from './e2e/env.ts';

const node = process.execPath;
const api = (port: number, auth: Record<string, string>) => ({
  command: `"${node}" ../api/src/main.ts`,
  url: `http://127.0.0.1:${String(port)}/health/live`,
  reuseExistingServer: false,
  timeout: 30_000,
  env: {
    DATABASE_URL: E2E.databaseUrl,
    PORT: String(port),
    LOG_LEVEL: 'warn',
    NODE_ENV: 'test',
    ...auth,
  },
});
const web = (port: number, apiPort: number) => ({
  command: 'pnpm exec vite preview',
  url: `http://127.0.0.1:${String(port)}/`,
  reuseExistingServer: false,
  timeout: 30_000,
  env: { SRL_WEB_PORT: String(port), SRL_API_URL: `http://127.0.0.1:${String(apiPort)}` },
});

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    api(E2E.localApiPort, { AUTH_MODE: 'local' }),
    api(E2E.jwtApiPort, {
      AUTH_MODE: 'jwt',
      JWT_ISSUER: E2E.issuer,
      JWT_AUDIENCE: E2E.audience,
      JWT_JWKS_FILE: JWKS_FILE,
    }),
    web(E2E.localWebPort, E2E.localApiPort),
    web(E2E.jwtWebPort, E2E.jwtApiPort),
  ],
});
