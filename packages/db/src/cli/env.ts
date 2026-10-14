import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { databaseUrlSchema } from '../client.ts';

const REPO_ENV = fileURLToPath(new URL('../../../../.env', import.meta.url));

/** Loads the repository `.env` if present (without overriding real environment variables). */
export function loadRepoEnv(): void {
  if (existsSync(REPO_ENV)) {
    process.loadEnvFile(REPO_ENV);
  }
}

export function requireDatabaseUrl(): string {
  loadRepoEnv();
  const parsed = databaseUrlSchema.safeParse(process.env.DATABASE_URL);
  if (!parsed.success) {
    throw new Error(
      'DATABASE_URL is missing or is not a postgresql:// URL (copy .env.example to .env)',
    );
  }
  return parsed.data;
}
