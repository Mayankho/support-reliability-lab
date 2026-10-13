import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, LOCAL_BIND_HOST } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://app:app@localhost:5432/support_reliability',
  LOG_LEVEL: 'silent',
});

describe('GET /health/live', () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map(async (app) => app.close()));
  });

  it('returns ok through Fastify inject', async () => {
    const app = buildApp(config, { logger: false });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('serves local health on the loopback interface', async () => {
    const app = buildApp(config, { logger: false });
    apps.push(app);
    await app.listen({ host: LOCAL_BIND_HOST, port: 0 });

    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected a TCP listen address');
    }

    expect(address.address).toBe(LOCAL_BIND_HOST);

    const response = await fetch(`http://${LOCAL_BIND_HOST}:${String(address.port)}/health/live`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });
});
