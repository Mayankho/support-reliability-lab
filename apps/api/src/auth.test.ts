import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { SignJWT, importJWK, type JWK } from 'jose';
import { buildApp } from './app.ts';
import { jwtPrincipal } from './auth.ts';
import { loadConfig } from './config.ts';
import {
  DEV_AUDIENCE,
  DEV_ISSUER,
  generateDevKeyPair,
  signDevToken,
  type DevKeyPair,
} from './dev-auth.ts';

const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://app:app@localhost:5432/support_reliability',
  LOG_LEVEL: 'silent',
});

let pair: DevKeyPair;
let otherPair: DevKeyPair;
let app: FastifyInstance;

const token = (claims: Partial<Parameters<typeof signDevToken>[1]> = {}, key?: JWK) =>
  signDevToken(key ?? pair.privateJwk, {
    subject: 'tester',
    workspaceId: 'ws_demo',
    role: 'reviewer',
    ...claims,
  });

async function custom(
  payload: Record<string, unknown>,
  expiresAt: number,
  key: JWK = pair.privateJwk,
) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', kid: key.kid ?? '' })
    .setIssuer(DEV_ISSUER)
    .setAudience(DEV_AUDIENCE)
    .setSubject('tester')
    .setExpirationTime(expiresAt)
    .sign(await importJWK(key, 'ES256'));
}

const get = (authorization?: string) =>
  app.inject({
    url: '/api/v1/datasets',
    headers: authorization === undefined ? {} : { authorization },
  });

beforeAll(async () => {
  pair = await generateDevKeyPair();
  otherPair = await generateDevKeyPair();
  app = buildApp(config, {
    logger: false,
    resolvePrincipal: jwtPrincipal({ issuer: DEV_ISSUER, audience: DEV_AUDIENCE, jwks: pair.jwks }),
  });
});

afterAll(async () => {
  await app.close();
});

describe('JWT authentication', () => {
  it('rejects a request without a bearer token with 401 and a challenge', async () => {
    const response = await get();

    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.json()).toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Authentication required.',
    });
  });

  it('accepts a valid token (the request then fails only because no database is configured)', async () => {
    const response = await get(`Bearer ${await token()}`);

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'NOT_READY' });
  });

  it.each([
    [
      'an expired token',
      async () =>
        custom({ workspace_id: 'ws_demo', role: 'reviewer' }, Math.floor(Date.now() / 1000) - 120),
    ],
    ['a token for another issuer', async () => token({ issuer: 'someone-else' })],
    ['a token for another audience', async () => token({ audience: 'another-api' })],
    ['a token signed by an unknown key', async () => token({}, otherPair.privateJwk)],
    [
      'a token without a workspace claim',
      async () => custom({ role: 'reviewer' }, Math.floor(Date.now() / 1000) + 600),
    ],
    [
      'a token with an unknown role',
      async () =>
        custom({ workspace_id: 'ws_demo', role: 'admin' }, Math.floor(Date.now() / 1000) + 600),
    ],
    [
      'a token with a malformed workspace',
      async () =>
        custom({ workspace_id: 'other', role: 'viewer' }, Math.floor(Date.now() / 1000) + 600),
    ],
  ])('rejects %s', async (_label, make) => {
    const response = await get(`Bearer ${await make()}`);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects unsigned and HMAC tokens even with valid-looking claims', async () => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const claims = {
      sub: 'tester',
      workspace_id: 'ws_demo',
      role: 'reviewer',
      iss: DEV_ISSUER,
      aud: DEV_AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 600,
    };
    const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode(claims)}.`;
    const hmac = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode('x'.repeat(32)));

    expect((await get(`Bearer ${unsigned}`)).statusCode).toBe(401);
    expect((await get(`Bearer ${hmac}`)).statusCode).toBe(401);
    expect((await get('Basic dXNlcjpwYXNz')).statusCode).toBe(401);
    expect((await get('Bearer not-a-jwt')).statusCode).toBe(401);
  });

  it('keeps health endpoints open', async () => {
    expect((await app.inject('/health/live')).statusCode).toBe(200);
  });

  it('returns 403 when a viewer tries to enqueue a run, before reading the body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/evaluation-runs',
      headers: { authorization: `Bearer ${await token({ role: 'viewer' })}` },
      payload: { not: 'even valid' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('lets a reviewer through to validation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/evaluation-runs',
      headers: { authorization: `Bearer ${await token()}` },
      payload: { not: 'valid' },
    });

    expect(response.statusCode).toBe(422);
  });
});
