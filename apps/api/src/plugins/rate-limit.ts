import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import { AppError, ERROR_CODES } from '../errors.js';

export interface RateLimitPluginOptions {
  /** Requests per window for routes that opt in with `config.rateLimit` (default 20). */
  authPerMin: number;
}

/** Route config for `/v1/auth/*` (specs/002-auth-and-factions/research.md R4). */
export function authRateLimit(authPerMin: number) {
  return { rateLimit: { max: authPerMin, timeWindow: '1 minute' } };
}

/**
 * Registers `@fastify/rate-limit` with `global: false`: only routes that set
 * `config.rateLimit` are throttled, keyed by client address (`request.ip`; honours `TRUST_PROXY`).
 * Exceeding the limit answers the shared envelope `429 RATE_LIMITED` with `details.retryAfterS`
 * and the `retry-after` header. Counters live in memory (single API instance; plan.md Deviations).
 */
export const rateLimitPlugin = fp<RateLimitPluginOptions>(
  async (fastify, opts) => {
    await fastify.register(rateLimit, {
      global: false,
      max: opts.authPerMin,
      timeWindow: '1 minute',
      addHeaders: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
        'retry-after': true,
      },
      errorResponseBuilder(_request, context) {
        const retryAfterS = Math.max(1, Math.ceil(context.ttl / 1_000));
        return new AppError(
          429,
          ERROR_CODES.RATE_LIMITED,
          `Too many requests; retry in ${retryAfterS} s`,
          { retryAfterS, max: context.max },
        );
      },
    });
  },
  { name: 'rate-limit', fastify: '5.x' },
);
