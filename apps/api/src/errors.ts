import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INCOMPATIBLE_RUNS'
  | 'RUN_NOT_FINISHED'
  | 'GATE_NOT_RECORDED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'RATE_LIMITED'
  | 'NOT_READY'
  | 'INTERNAL';

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;

  constructor(statusCode: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Missing and not-yours look identical, so IDs from another workspace cannot be probed. */
export const notFound = () => new ApiError(404, 'NOT_FOUND', 'Resource not found.');

export interface ErrorBody {
  code: ApiErrorCode;
  message: string;
  correlationId: string;
}

function fromFastifyError(error: FastifyError): ApiError | null {
  switch (error.statusCode) {
    case 400:
      return new ApiError(400, 'BAD_REQUEST', 'Malformed request.');
    case 413:
      return new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    case 415:
      return new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content type must be application/json.');
    default:
      return null;
  }
}

/**
 * One error body shape for every failure. Validation errors name fields, never values; unexpected
 * errors are logged server-side and returned without stack traces or internal messages.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, request, reply) => {
    let apiError: ApiError;
    if (error instanceof ApiError) {
      apiError = error;
    } else if (error instanceof ZodError) {
      const fields = [
        ...new Set(error.issues.map((issue) => issue.path.map(String).join('.') || '(root)')),
      ];
      apiError = new ApiError(
        422,
        'VALIDATION_FAILED',
        `Invalid request: ${fields.slice(0, 10).join(', ')}.`,
      );
    } else {
      const fastifyError = error as FastifyError;
      apiError = fromFastifyError(fastifyError) ?? new ApiError(500, 'INTERNAL', 'Internal error.');
      if (apiError.statusCode === 500) {
        request.log.error(
          { err: { name: fastifyError.name, code: fastifyError.code } },
          'unhandled error',
        );
      }
    }
    const body: ErrorBody = {
      code: apiError.code,
      message: apiError.message,
      correlationId: request.id,
    };
    if (apiError.statusCode === 401) {
      void reply.header('www-authenticate', 'Bearer');
    }
    void reply.status(apiError.statusCode).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const body: ErrorBody = {
      code: 'NOT_FOUND',
      message: 'Resource not found.',
      correlationId: request.id,
    };
    void reply.status(404).send(body);
  });
}
