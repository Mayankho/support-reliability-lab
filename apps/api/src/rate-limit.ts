import { ApiError } from './errors.ts';

export interface RateLimiter {
  check(key: string): void;
}

/** Fixed-window counter per key. Enough to bound run creation on a local service. */
export function createRateLimiter(
  limit: number,
  windowMs: number,
  now: () => number = Date.now,
): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    check(key) {
      const current = now();
      const window = windows.get(key);
      if (window === undefined || current - window.start >= windowMs) {
        windows.set(key, { start: current, count: 1 });
        return;
      }
      if (window.count >= limit) {
        throw new ApiError(429, 'RATE_LIMITED', 'Too many requests; try again shortly.');
      }
      window.count += 1;
    },
  };
}
