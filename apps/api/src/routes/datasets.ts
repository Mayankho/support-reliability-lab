import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listDatasets, type Db } from '@srl/db';
import { requireDb } from '../context.ts';
import { limitSchema } from '../pagination.ts';

const querySchema = z.object({ limit: limitSchema }).strict();

export function registerDatasetRoutes(app: FastifyInstance, db: Db | undefined): void {
  app.get('/api/v1/datasets', async (request) => {
    const { limit } = querySchema.parse(request.query);
    const datasets = await listDatasets(requireDb(db));
    return {
      items: datasets.slice(0, limit).map((dataset) => ({
        version: dataset.version,
        sha256: dataset.sha256,
        caseCount: dataset.caseCount,
        policyVersion: dataset.policyVersion,
        policySha256: dataset.policySha256,
        reviewStatus: dataset.reviewStatus,
        createdAt: dataset.createdAt.toISOString(),
      })),
      nextCursor: null,
    };
  });
}
