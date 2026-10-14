import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, importJWK, SignJWT, type JSONWebKeySet, type JWK } from 'jose';

export const DEV_ISSUER = 'srl-local-issuer';
export const DEV_AUDIENCE = 'srl-api';

export interface DevKeyPair {
  privateJwk: JWK;
  jwks: JSONWebKeySet;
}

/** A local ES256 key pair for development and tests. Never used for anything but this local API. */
export async function generateDevKeyPair(): Promise<DevKeyPair> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const kid = randomUUID();
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
  const privateJwk = { ...(await exportJWK(privateKey)), kid, alg: 'ES256' };
  return { privateJwk, jwks: { keys: [publicJwk] } };
}

export interface DevTokenClaims {
  subject: string;
  workspaceId: string;
  role: 'viewer' | 'reviewer';
  ttlSeconds?: number;
  issuer?: string;
  audience?: string;
}

export async function signDevToken(privateJwk: JWK, claims: DevTokenClaims): Promise<string> {
  const key = await importJWK(privateJwk, 'ES256');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ workspace_id: claims.workspaceId, role: claims.role })
    .setProtectedHeader({ alg: 'ES256', kid: privateJwk.kid ?? '', typ: 'JWT' })
    .setSubject(claims.subject)
    .setIssuer(claims.issuer ?? DEV_ISSUER)
    .setAudience(claims.audience ?? DEV_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + (claims.ttlSeconds ?? 3600))
    .sign(key);
}
