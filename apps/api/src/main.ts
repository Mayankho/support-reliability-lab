import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigError, loadConfig } from './config.ts';
import { startServer } from './server.ts';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

try {
  const config = loadConfig(process.env);
  await startServer(config);
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
