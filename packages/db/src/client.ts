import { fileURLToPath } from 'node:url';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { z } from 'zod';
import * as schema from './schema.ts';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Executor = Db | Tx;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

export const databaseUrlSchema = z
  .string()
  .regex(/^postgres(ql)?:\/\/[^/\s]+\/[A-Za-z0-9_-]+(\?[^\s]*)?$/u, {
    error: 'must be a postgresql:// URL',
  });

/** Hides the password so a URL can appear in logs or errors. */
export function redactDatabaseUrl(url: string): string {
  return url.replace(/(postgres(?:ql)?:\/\/[^:/@\s]+):[^@\s]*@/u, '$1:***@');
}

export function connect(url: string, options: { max?: number } = {}): DbHandle {
  const parsed = databaseUrlSchema.safeParse(url);
  if (!parsed.success) {
    throw new Error('DATABASE_URL must be a postgresql:// URL');
  }
  const pool = new pg.Pool({ connectionString: parsed.data, max: options.max ?? 10 });
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    close: () => pool.end(),
  };
}

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

export async function migrateDatabase(handle: DbHandle): Promise<void> {
  await migrate(handle.db, { migrationsFolder: MIGRATIONS_DIR });
}

export async function checkConnection(handle: DbHandle): Promise<boolean> {
  try {
    await handle.pool.query('select 1');
    return true;
  } catch {
    return false;
  }
}
