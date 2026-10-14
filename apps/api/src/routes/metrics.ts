import type { FastifyInstance } from 'fastify';
import { workspaceMetrics, type Db } from '@srl/db';
import { requireDb } from '../context.ts';

export function registerMetricsRoutes(app: FastifyInstance, db: Db | undefined): void {
  app.get('/api/v1/metrics/summary', async (request) => {
    const metrics = await workspaceMetrics(requireDb(db), request.workspaceId);
    return {
      ...metrics,
      definitions: {
        casesWithCriticalFailures:
          'Distinct cases in the latest completed run per agent version with at least one critical rule failure.',
        denominator: 'caseCount of that run. One case failing several rules counts once.',
        scope: 'Synthetic evaluation data only; not production metrics.',
      },
    };
  });
}
