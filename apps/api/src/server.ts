import { buildApp, LOCAL_BIND_HOST } from './app.ts';
import type { AppConfig } from './config.ts';
import type { FastifyInstance } from 'fastify';

export async function startServer(config: AppConfig): Promise<FastifyInstance> {
  const app = buildApp(config);
  await app.listen({ host: LOCAL_BIND_HOST, port: config.PORT });
  return app;
}
