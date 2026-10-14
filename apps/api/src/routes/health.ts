import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadDataset } from '@srl/dataset';
import { checkConnection, type DbHandle } from '@srl/db';

export const liveHealthResponseSchema = z
  .object({
    status: z.literal('ok'),
  })
  .strict();

export type LiveHealthResponse = z.infer<typeof liveHealthResponseSchema>;

export function registerHealthRoutes(app: FastifyInstance, handle?: DbHandle): void {
  app.get('/health/live', () => {
    const body: LiveHealthResponse = { status: 'ok' };
    return liveHealthResponseSchema.parse(body);
  });

  app.get('/health/ready', async (_request, reply) => {
    const database =
      handle === undefined
        ? 'not_configured'
        : (await checkConnection(handle))
          ? 'ok'
          : 'unavailable';
    const dataset = (await loadDataset('v1')).ok ? 'ok' : 'invalid';
    const ready = database === 'ok' && dataset === 'ok';
    return reply
      .status(ready ? 200 : 503)
      .send({ status: ready ? 'ready' : 'not_ready', checks: { database, dataset } });
  });
}
