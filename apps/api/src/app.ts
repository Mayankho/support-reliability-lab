import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { AppConfig } from './config.ts';
import { registerHealthRoutes } from './routes/health.ts';

export const LOCAL_BIND_HOST = '127.0.0.1';

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
] as const;

interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
}

export function buildApp(config: AppConfig, options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? {
      level: config.LOG_LEVEL,
      redact: [...REDACT_PATHS],
    },
  });

  registerHealthRoutes(app);
  return app;
}
