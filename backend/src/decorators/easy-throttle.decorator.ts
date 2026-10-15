import { Throttle } from '@nestjs/throttler';

/**
 * Per route rate limit.
 *
 * `ttl` is in **seconds** here (that is how every call site reads), while
 * `@nestjs/throttler` v5+ expects **milliseconds** — this decorator does the
 * conversion. Before, the raw value was passed through as milliseconds, so
 * `EasyThrottle(30, 300)` allowed 30 requests per *0.3 s* instead of per
 * 5 minutes (audit A-1: rate limiting was effectively off).
 */
export const EasyThrottle = (
  limit: number,
  ttlSeconds?: number,
): MethodDecorator & ClassDecorator =>
  Throttle({
    default: {
      limit,
      ttl: (ttlSeconds ?? 60) * 1000,
    },
  });
