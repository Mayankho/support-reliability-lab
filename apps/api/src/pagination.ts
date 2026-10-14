import { z } from 'zod';
import { ApiError } from './errors.ts';

/** Opaque cursors: base64url JSON validated on the way back in. */
export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeCursor<T>(cursor: string, schema: z.ZodType<T>): T {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return schema.parse(decoded);
  } catch {
    throw new ApiError(422, 'VALIDATION_FAILED', 'Invalid request: cursor.');
  }
}

export const limitSchema = z.coerce.number().int().min(1).max(100).default(20);
