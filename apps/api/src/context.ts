import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '@srl/db';
import { LOCAL_PRINCIPAL, type Principal, type PrincipalResolver } from './auth.ts';
import { ApiError } from './errors.ts';

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal;
    workspaceId: string;
  }
}

/** Resolves who is calling before any `/api/` route runs; routes read only `request.principal`. */
export function registerPrincipalContext(app: FastifyInstance, resolve: PrincipalResolver): void {
  app.decorateRequest('principal', null as unknown as Principal);
  app.decorateRequest('workspaceId', '');
  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/')) {
      request.principal = LOCAL_PRINCIPAL;
      return;
    }
    request.principal = await resolve(request);
    request.workspaceId = request.principal.workspaceId;
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
