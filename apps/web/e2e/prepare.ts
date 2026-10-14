import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { connect, migrateDatabase } from '@srl/db';
import { runDemo } from '@srl/runner';
import { generateDevKeyPair, signDevToken } from '../../api/src/dev-auth.ts';
import { E2E, JWKS_FILE, STATE_FILE, type E2EState } from './env.ts';

/**
 * Rebuilds the end-to-end database from scratch, runs the real demo into it, and writes a local
 * signing key set plus tokens for the JWT-mode server. Nothing here touches other databases.
 */
async function main(): Promise<void> {
  const name = /\/([A-Za-z0-9_]+)(\?|$)/u.exec(E2E.databaseUrl)?.[1];
  if (name === undefined || !name.startsWith('srl_e2e')) {
    throw new Error('E2E_DATABASE_URL must point at a database named srl_e2e*');
  }
  const admin = new pg.Client({
    connectionString: E2E.databaseUrl.replace(`/${name}`, '/postgres'),
  });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const handle = connect(E2E.databaseUrl, { max: 4 });
  try {
    await migrateDatabase(handle);
    await mkdir(E2E.stateDir, { recursive: true });
    const demo = await runDemo(handle.db, `${E2E.stateDir}/demo`, 'e2e-prepare');
    if (!demo.ok) {
      throw new Error(`demo did not observe PASS, BLOCK, PASS: ${demo.problems.join('; ')}`);
    }
    const pair = await generateDevKeyPair();
    await writeFile(JWKS_FILE, JSON.stringify(pair.jwks));
    const sign = (workspaceId: string, role: 'viewer' | 'reviewer') =>
      signDevToken(pair.privateJwk, {
        subject: `e2e-${role}`,
        workspaceId,
        role,
        issuer: E2E.issuer,
        audience: E2E.audience,
      });
    const state: E2EState = {
      referenceRunId: demo.steps[0]?.outcome.report.run.id ?? '',
      regressionRunId: demo.steps[1]?.outcome.report.run.id ?? '',
      tokens: {
        reviewer: await sign('ws_demo', 'reviewer'),
        otherWorkspaceViewer: await sign('ws_other', 'viewer'),
      },
    };
    await writeFile(STATE_FILE, JSON.stringify(state));
    process.stdout.write(`e2e database ready: ${demo.verdict}\n`);
  } finally {
    await handle.close();
  }
}

await main();
