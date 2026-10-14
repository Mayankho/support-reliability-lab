import { fileURLToPath } from 'node:url';
import { connect, migrateDatabase, requireDatabaseUrl, type DbHandle } from '@srl/db';

export const ARTIFACTS_DIR = fileURLToPath(new URL('../../../../artifacts/', import.meta.url));

export class UsageError extends Error {}

/** Connects to the configured database and applies migrations, so every command starts from a known schema. */
export async function openDatabase(): Promise<DbHandle> {
  const handle = connect(requireDatabaseUrl(), { max: 6 });
  await migrateDatabase(handle);
  return handle;
}

export function cliArgs(): string[] {
  return process.argv.slice(2).filter((arg) => arg !== '--');
}
