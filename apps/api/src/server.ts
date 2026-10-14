import type { FastifyInstance } from 'fastify';
import { connect } from '@srl/db';
import { buildApp, LOCAL_BIND_HOST } from './app.ts';
import type { AppConfig } from './config.ts';

export async function startServer(config: AppConfig): Promise<FastifyInstance> {
  const database = connect(config.DATABASE_URL);
  const app = buildApp(config, { database });
  app.addHook('onClose', async () => {
    await database.close();
  });
  await app.listen({ host: LOCAL_BIND_HOST, port: config.PORT });
  return app;
}
