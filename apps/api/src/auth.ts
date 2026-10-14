import { readFileSync } from 'node:fs';
import type { FastifyRequest } from 'fastify';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { z } from 'zod';
import { ApiError } from './errors.ts';

export const ROLES = ['viewer', 'reviewer'] as const;
export type Role = (typeof ROLES)[number];

export interface Principal {
  subject: string;
  workspaceId: string;
  role: Role;
  /** False in local mode, where nobody has proven who they are. */
  authenticated: boolean;
}

export type PrincipalResolver = (request: FastifyRequest) => Promise<Principal> | Principal;

export const LOCAL_PRINCIPAL: Principal = {
  subject: 'local',
  workspaceId: 'ws_demo',
  role: 'reviewer',
  authenticated: false,
};

export const localPrincipal: PrincipalResolver = () => LOCAL_PRINCIPAL;

const claimsSchema = z.object({
  sub: z.string().min(1).max(128),
  workspace_id: z.string().regex(/^ws_[a-z0-9_]{1,40}$/u),
  role: z.enum(ROLES),
  exp: z.number().int(),
});

const jwksSchema = z.object({ keys: z.array(z.record(z.string(), z.unknown())).min(1) });

const unauthenticated = () => new ApiError(401, 'UNAUTHENTICATED', 'Authentication required.');

export interface JwtSettings {
  issuer: string;
  audience: string;
  jwks: JSONWebKeySet;
}

export function readJwks(path: string): JSONWebKeySet {
  const parsed: unknown = jwksSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  return parsed as JSONWebKeySet;
}

/**
 * Verifies bearer tokens against a key set loaded from local configuration. Keys are never fetched
 * from a URL in the token, only ES256 is accepted, and issuer, audience, expiry, subject, workspace,
 * and role are all required. Any failure is a generic 401.
 */
export function jwtPrincipal(settings: JwtSettings): PrincipalResolver {
  const keySet = createLocalJWKSet(settings.jwks);
  return async (request) => {
    const header = request.headers.authorization;
    const match =
      typeof header === 'string'
        ? /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u.exec(header)
        : null;
    const token = match?.[1];
    if (token === undefined) {
      throw unauthenticated();
    }
    try {
      const { payload } = await jwtVerify(token, keySet, {
        issuer: settings.issuer,
        audience: settings.audience,
        algorithms: ['ES256'],
        requiredClaims: ['exp', 'sub'],
        clockTolerance: 5,
      });
      const claims = claimsSchema.parse(payload);
      return {
        subject: claims.sub,
        workspaceId: claims.workspace_id,
        role: claims.role,
        authenticated: true,
      };
    } catch {
      throw unauthenticated();
    }
  };
}

export function requireRole(principal: Principal, role: Role): void {
  if (principal.authenticated && ROLES.indexOf(principal.role) < ROLES.indexOf(role)) {
    throw new ApiError(403, 'FORBIDDEN', 'This action requires a different role.');
  }
}

/** Gold labels are diagnostic data: only an authenticated reviewer may see them. */
export function canSeeExpected(principal: Principal): boolean {
  return principal.authenticated && principal.role === 'reviewer';
}
