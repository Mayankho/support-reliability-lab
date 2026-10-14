import { AGENT_VERSION_IDS } from '@srl/agent';
import {
  connect,
  migrateDatabase,
  postgresMessage,
  redactDatabaseUrl,
  requireDatabaseUrl,
} from '@srl/db';
import {
  RunRequestError,
  ensureAgentVersion,
  ensureDataset,
  loadVerifiedDataset,
} from '../service.ts';

async function main(): Promise<number> {
  let url: string;
  try {
    url = requireDatabaseUrl();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'invalid configuration'}\n`);
    return 2;
  }
  const handle = connect(url, { max: 2 });
  try {
    await migrateDatabase(handle);
    const dataset = await loadVerifiedDataset('v1');
    const datasetId = await ensureDataset(handle.db, dataset);
    process.stdout.write(
      `dataset v1 stored (${String(dataset.cases.length)} cases, sha256 ${dataset.sha256}) as ${datasetId}\n`,
    );
    for (const version of AGENT_VERSION_IDS) {
      const id = await ensureAgentVersion(handle.db, version);
      process.stdout.write(`agent ${version} registered as ${id}\n`);
    }
    process.stdout.write(`seed complete for ${redactDatabaseUrl(url)}\n`);
    return 0;
  } catch (error) {
    const message =
      error instanceof RunRequestError ? `${error.code}: ${error.message}` : postgresMessage(error);
    process.stderr.write(`seed failed: ${message}\n`);
    return 1;
  } finally {
    await handle.close();
  }
}

process.exitCode = await main();
