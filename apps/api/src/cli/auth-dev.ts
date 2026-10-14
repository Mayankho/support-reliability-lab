import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { DEV_AUDIENCE, DEV_ISSUER, generateDevKeyPair, signDevToken } from '../dev-auth.ts';

const DIR = fileURLToPath(new URL('../../../../.local-auth/', import.meta.url));
const PRIVATE_KEY = join(DIR, 'signing-key.json');
const JWKS = join(DIR, 'jwks.json');

const USAGE = [
  'usage:',
  '  pnpm auth:init                                         create a local ES256 key pair in .local-auth/',
  '  pnpm auth:token -- [--workspace ws_demo] [--role reviewer|viewer] [--ttl 3600]',
].join('\n');

async function init(): Promise<number> {
  if (existsSync(PRIVATE_KEY)) {
    process.stdout.write(`key pair already exists in ${DIR}\n`);
    return 0;
  }
  const pair = await generateDevKeyPair();
  await mkdir(DIR, { recursive: true, mode: 0o700 });
  await writeFile(PRIVATE_KEY, `${JSON.stringify(pair.privateJwk)}\n`, { mode: 0o600 });
  await chmod(PRIVATE_KEY, 0o600);
  await writeFile(JWKS, `${JSON.stringify(pair.jwks, null, 2)}\n`);
  process.stdout.write(
    [
      `wrote ${JWKS} (public) and ${PRIVATE_KEY} (private, git-ignored)`,
      'to require tokens, set in .env:',
      '  AUTH_MODE=jwt',
      `  JWT_ISSUER=${DEV_ISSUER}`,
      `  JWT_AUDIENCE=${DEV_AUDIENCE}`,
      `  JWT_JWKS_FILE=${JWKS}`,
      '',
    ].join('\n'),
  );
  return 0;
}

async function token(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      workspace: { type: 'string', default: 'ws_demo' },
      role: { type: 'string', default: 'reviewer' },
      ttl: { type: 'string', default: '3600' },
      subject: { type: 'string', default: 'local-reviewer' },
    },
    strict: true,
  });
  const parsed = z
    .object({
      workspace: z.string().regex(/^ws_[a-z0-9_]{1,40}$/u),
      role: z.enum(['viewer', 'reviewer']),
      ttl: z.coerce.number().int().min(60).max(86_400),
      subject: z.string().min(1).max(128),
    })
    .parse(values);
  if (!existsSync(PRIVATE_KEY)) {
    process.stderr.write('no key pair; run pnpm auth:init first\n');
    return 1;
  }
  const privateJwk = JSON.parse(await readFile(PRIVATE_KEY, 'utf8')) as Record<string, unknown>;
  const jwt = await signDevToken(privateJwk, {
    subject: parsed.subject,
    workspaceId: parsed.workspace,
    role: parsed.role,
    ttlSeconds: parsed.ttl,
  });
  process.stdout.write(`${jwt}\n`);
  return 0;
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2).filter((arg) => arg !== '--');
  try {
    if (command === 'init') return await init();
    if (command === 'token') return await token(rest);
  } catch {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  process.stderr.write(`${USAGE}\n`);
  return 2;
}

process.exitCode = await main();
