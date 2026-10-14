import { connect, migrateDatabase, redactDatabaseUrl } from '../client.ts';
import { postgresMessage } from '../errors.ts';
import { requireDatabaseUrl } from './env.ts';

async function main(): Promise<number> {
  let url: string;
  try {
    url = requireDatabaseUrl();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'invalid configuration'}\n`);
    return 2;
  }
  const handle = connect(url, { max: 1 });
  try {
    await migrateDatabase(handle);
    process.stdout.write(`migrations applied to ${redactDatabaseUrl(url)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`migration failed: ${postgresMessage(error)}\n`);
    return 1;
  } finally {
    await handle.close();
  }
}

process.exitCode = await main();
