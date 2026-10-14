import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { DbHandle } from '@srl/db';
import { REDACT_PATHS, SpanStatusCode, startChildSpan, type Span } from '@srl/telemetry';
import type { AppConfig } from './config.ts';
import { localWorkspace, registerWorkspaceContext, type WorkspaceResolver } from './context.ts';
import { registerErrorHandling } from './errors.ts';
import { createRateLimiter, type RateLimiter } from './rate-limit.ts';
import { registerCaseRoutes } from './routes/cases.ts';
import { registerDatasetRoutes } from './routes/datasets.ts';
import { registerHealthRoutes } from './routes/health.ts';
import { registerMetricsRoutes } from './routes/metrics.ts';
import { registerRunRoutes } from './routes/runs.ts';

export const LOCAL_BIND_HOST = '127.0.0.1';

const CORRELATION_ID = /^[A-Za-z0-9._:-]{1,64}$/u;

export interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
  database?: DbHandle;
  rateLimiter?: RateLimiter;
  resolveWorkspace?: WorkspaceResolver;
}

export function buildApp(config: AppConfig, options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? {
      level: config.LOG_LEVEL,
      redact: [...REDACT_PATHS],
    },
    bodyLimit: 16 * 1024,
    genReqId: (request) => {
      const incoming = request.headers['x-correlation-id'];
      return typeof incoming === 'string' && CORRELATION_ID.test(incoming)
        ? incoming
        : randomUUID();
    },
  });

  app.removeContentTypeParser('text/plain');
  const spans = new WeakMap<object, Span>();
  app.addHook('onRequest', (request, _reply, done) => {
    spans.set(
      request,
      startChildSpan('http.request', null, {
        'http.method': request.method,
        'srl.correlation_id': request.id,
      }),
    );
    done();
  });
  app.addHook('onSend', (request, reply, payload, done) => {
    void reply.header('x-correlation-id', request.id);
    done(null, payload);
  });
  app.addHook('onResponse', (request, reply, done) => {
    const span = spans.get(request);
    if (span !== undefined) {
      span.setAttribute('http.route', request.routeOptions.url ?? 'unmatched');
      span.setAttribute('http.status_code', reply.statusCode);
      if (reply.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    }
    done();
  });

  registerErrorHandling(app);
  registerWorkspaceContext(app, options.resolveWorkspace ?? localWorkspace);

  const db = options.database?.db;
  registerHealthRoutes(app, options.database);
  registerDatasetRoutes(app, db);
  registerRunRoutes(app, db, options.rateLimiter ?? createRateLimiter(30, 60_000));
  registerCaseRoutes(app, db);
  registerMetricsRoutes(app, db);
  return app;
}
