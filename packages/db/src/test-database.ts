import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { connect, migrateDatabase, type DbHandle } from './client.ts';

export const DEFAULT_TEST_DATABASE_URL = 'postgresql://app:app@localhost:5432/support_reliability';

export function testDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}

export interface TestDatabase {
  url: string;
  handle: DbHandle;
  drop(): Promise<void>;
}

/**
 * Creates a fresh, migrated database next to the configured one and drops it afterwards, so each
 * integration suite starts clean and never touches data it did not create.
 */
export async function createTestDatabase(baseUrl = testDatabaseUrl()): Promise<TestDatabase> {
  const name = `srl_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }

  const url = baseUrl.replace(/\/[A-Za-z0-9_-]+(\?|$)/u, `/${name}$1`);
  const handle = connect(url, { max: 8 });
  await migrateDatabase(handle);

  return {
    url,
    handle,
    async drop() {
      await handle.close();
      const cleanup = new pg.Client({ connectionString: baseUrl });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
