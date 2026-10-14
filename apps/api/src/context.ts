import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '@srl/db';
import { ApiError } from './errors.ts';

declare module 'fastify' {
  interface FastifyRequest {
    workspaceId: string;
  }
}

export const LOCAL_WORKSPACE_ID = 'ws_demo';

export interface WorkspaceResolver {
  (request: FastifyRequest): Promise<string> | string;
}

/** Local P0 mode: every request acts in the single demo workspace. Replaced by JWT claims when auth is on. */
export const localWorkspace: WorkspaceResolver = () => LOCAL_WORKSPACE_ID;

export function registerWorkspaceContext(app: FastifyInstance, resolve: WorkspaceResolver): void {
  app.decorateRequest('workspaceId', '');
  app.addHook('onRequest', async (request) => {
    if (request.url.startsWith('/api/')) {
      request.workspaceId = await resolve(request);
    }
  });
}

export function requireDb(db: Db | undefined): Db {
  if (db === undefined) {
    throw new ApiError(503, 'NOT_READY', 'Database is not configured.');
  }
  return db;
}

export const uuidSchema = z.uuid();

/** Path IDs are opaque; anything that is not a well-formed ID is simply not found. */
export function parseRunId(value: unknown): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(404, 'NOT_FOUND', 'Resource not found.');
  }
  return parsed.data;
}
