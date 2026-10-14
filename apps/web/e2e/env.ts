import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Shared settings for the end-to-end environment. Ports are fixed so the suite can run in CI. */
export const E2E = {
  databaseUrl: process.env.E2E_DATABASE_URL ?? 'postgresql://app:app@localhost:5432/srl_e2e',
  stateDir: join(tmpdir(), 'srl-e2e'),
  localApiPort: 3100,
  jwtApiPort: 3101,
  localWebPort: 4180,
  jwtWebPort: 4181,
  issuer: 'srl-e2e-issuer',
  audience: 'srl-api',
} as const;

export const STATE_FILE = join(E2E.stateDir, 'state.json');
export const JWKS_FILE = join(E2E.stateDir, 'jwks.json');

export interface E2EState {
  regressionRunId: string;
  referenceRunId: string;
  tokens: { reviewer: string; otherWorkspaceViewer: string };
}
