import { loadRepoEnv } from '@srl/db';
import { ConfigError, loadConfig } from './config.ts';
import { startServer } from './server.ts';

loadRepoEnv();

try {
  const config = loadConfig(process.env);
  const app = await startServer(config);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  }
} catch (error) {
  const message =
    error instanceof ConfigError
      ? error.message
      : error instanceof Error
        ? `${error.name}: ${error.message}`
        : 'server failed to start';
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
