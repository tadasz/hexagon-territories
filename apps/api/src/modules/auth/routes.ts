import type { FastifyPluginCallbackTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { AppConfig } from '../../config.js';
import type { Clock } from '../../lib/time.js';
import { authRateLimit } from '../../plugins/rate-limit.js';
import { ErrorRef } from '../../schemas/error.js';
import type { AppleTokenVerifier } from './apple.js';
import {
  AuthAppleRequestRef,
  AuthResponseRef,
  LogoutRequestRef,
  RefreshRequestRef,
  TokenPairRef,
} from './schemas.js';
import { logout, refreshTokens, signInWithApple } from './service.js';

export interface AuthRoutesOptions {
  config: Pick<AppConfig, 'jwt' | 'rateLimit'>;
  clock: Clock;
  verifier: AppleTokenVerifier;
}

const rateLimited = {
  ...ErrorRef,
  description:
    'Too many requests from this client address (code RATE_LIMITED, `details.retryAfterS`); the `retry-after` header is set',
};
const badRequest = {
  ...ErrorRef,
  description: 'Request validation failed (code VALIDATION_FAILED)',
};
const unauthorized = {
  ...ErrorRef,
  description:
    'Missing or invalid access token (UNAUTHORIZED), expired token (TOKEN_EXPIRED) or deleted account (ACCOUNT_DELETED)',
};

/** `/v1/auth/*` (contracts/openapi.yaml, tag `auth`); every route is rate limited per client address. */
export const authRoutes: FastifyPluginCallbackTypebox<AuthRoutesOptions> = (
  fastify,
  opts,
  done,
) => {
  const rateLimit = authRateLimit(opts.config.rateLimit.authPerMin);
  const deps = (log: typeof fastify.log) => ({
    db: fastify.db,
    clock: opts.clock,
    config: opts.config,
    verifier: opts.verifier,
    log,
  });

  fastify.post(
    '/v1/auth/apple',
    {
      config: rateLimit,
      schema: {
        tags: ['auth'],
        operationId: 'signInWithApple',
        summary: 'Sign in (or up) with an Apple identity token',
        description:
          "Verifies `identityToken` against Apple's JWKS (issuer `https://appleid.apple.com`, audience = the app's bundle identifier(s)), then creates or resumes the account keyed by Apple's `sub`. E-mail and `fullName` are stored only when the account is created; later calls ignore them. An account marked deleted within the last 30 days is restored (`restored: true`). Rate limited: 20 requests per minute per client address.",
        security: [],
        body: AuthAppleRequestRef,
        response: {
          200: {
            ...AuthResponseRef,
            description: "Tokens for the (new or existing) account and the player's profile",
          },
          400: badRequest,
          401: {
            ...ErrorRef,
            description:
              'The identity token is invalid (code INVALID_APPLE_TOKEN, `details.reason` in expired | audience | issuer | signature | malformed)',
          },
          429: rateLimited,
          503: {
            ...ErrorRef,
            description: "Apple's key service is unreachable (code APPLE_UNAVAILABLE); retry later",
          },
        },
      },
    },
    async (request) => signInWithApple(deps(request.log), request.body),
  );

  fastify.post(
    '/v1/auth/refresh',
    {
      config: rateLimit,
      schema: {
        tags: ['auth'],
        operationId: 'refreshTokens',
        summary: 'Rotate a refresh token',
        description:
          'Exchanges a valid refresh token for a new token pair and revokes the presented token. Presenting a token that was already rotated revokes every refresh token of the account (code REFRESH_REUSED). Rate limited: 20 requests per minute per client address.',
        security: [],
        body: RefreshRequestRef,
        response: {
          200: { ...TokenPairRef, description: 'New token pair' },
          400: badRequest,
          401: {
            ...ErrorRef,
            description:
              'Unknown, expired or revoked token (INVALID_REFRESH_TOKEN), reuse of a rotated token (REFRESH_REUSED), or deleted account (ACCOUNT_DELETED); the client must sign in again',
          },
          429: rateLimited,
        },
      },
    },
    async (request) => refreshTokens(deps(request.log), request.body.refreshToken),
  );

  fastify.post(
    '/v1/auth/logout',
    {
      config: rateLimit,
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['auth'],
        operationId: 'logout',
        summary: 'Revoke the presented refresh token (sign out this device)',
        description:
          'Revokes the refresh token if it belongs to the caller. Always succeeds for a valid session, even when the token is already revoked or unknown. Other devices are unaffected.',
        security: [{ bearerAuth: [] }],
        body: LogoutRequestRef,
        response: {
          204: Type.Null({ description: 'Signed out' }),
          400: badRequest,
          401: unauthorized,
          429: rateLimited,
        },
      },
    },
    async (request, reply) => {
      await logout(deps(request.log), request.user!.id, request.body.refreshToken);
      return reply.code(204).send(null);
    },
  );

  done();
};
