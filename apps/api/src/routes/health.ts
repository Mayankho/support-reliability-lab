import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export const liveHealthResponseSchema = z
  .object({
    status: z.literal('ok'),
  })
  .strict();

export type LiveHealthResponse = z.infer<typeof liveHealthResponseSchema>;

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/health/live', () => {
    const body: LiveHealthResponse = { status: 'ok' };
    return liveHealthResponseSchema.parse(body);
  });
}
