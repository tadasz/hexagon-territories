import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTPayload } from 'jose';
import { AppError, ERROR_CODES } from '../../errors.js';
import type { Clock } from '../../lib/time.js';

export const APPLE_ISSUER = 'https://appleid.apple.com';

/** What the API keeps from a verified Apple identity token. */
export interface AppleIdentity {
  /** Apple's stable user identifier (`users.apple_sub`). */
  sub: string;
  email?: string;
  emailVerified?: boolean;
  isPrivateEmail?: boolean;
}

export interface AppleTokenVerifier {
  verify(identityToken: string): Promise<AppleIdentity>;
}

export type AppleTokenRejection = 'expired' | 'audience' | 'issuer' | 'signature' | 'malformed';

export interface JoseAppleVerifierOptions {
  jwksUrl: string;
  /** Accepted `aud` values: the app's bundle identifier(s). */
  clientIds: readonly string[];
  clock?: Clock;
  /** JWKS cache; defaults match research.md R1 (30 s cooldown, 10 min max age). */
  cooldownDuration?: number;
  cacheMaxAge?: number;
  timeoutDuration?: number;
}

function invalid(reason: AppleTokenRejection, message: string): AppError {
  return new AppError(401, ERROR_CODES.INVALID_APPLE_TOKEN, message, { reason });
}

function unavailable(message: string): AppError {
  return new AppError(503, ERROR_CODES.APPLE_UNAVAILABLE, message);
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

/** Maps a jose failure to the 401/503 envelope of contracts/openapi.yaml (research.md R1). */
export function mapJoseError(err: unknown): AppError {
  if (err instanceof joseErrors.JWTExpired) return invalid('expired', 'Identity token has expired');
  if (err instanceof joseErrors.JWTClaimValidationFailed) {
    if (err.claim === 'aud') return invalid('audience', 'Identity token audience is not this app');
    if (err.claim === 'iss') return invalid('issuer', 'Identity token issuer is not Apple');
    return invalid('malformed', `Identity token claim "${err.claim}" is invalid`);
  }
  if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
    return invalid('signature', 'Identity token signature does not verify');
  }
  if (
    err instanceof joseErrors.JWKSNoMatchingKey ||
    err instanceof joseErrors.JWKSTimeout ||
    err instanceof joseErrors.JWKSInvalid ||
    err instanceof joseErrors.JWKSMultipleMatchingKeys
  ) {
    return unavailable("Apple's signing keys could not be resolved; try again later");
  }
  if (err instanceof joseErrors.JOSEError) {
    // JWSInvalid, JWTInvalid, JOSEAlgNotAllowed, JOSENotSupported, ...
    return invalid('malformed', 'Identity token is malformed');
  }
  // fetch failures (network, DNS, connection refused) surface as plain errors
  return unavailable("Apple's key service is unreachable; try again later");
}

/**
 * Verifies Apple identity tokens against Apple's JWKS with `jose` (research.md R1). Keys are
 * cached in process, so a brief Apple outage does not affect sign-in. The JWKS URL is
 * configurable so tests and the dev stub serve their own keys.
 */
export class JoseAppleVerifier implements AppleTokenVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly clientIds: string[];
  private readonly clock: Clock | undefined;

  constructor(opts: JoseAppleVerifierOptions) {
    this.jwks = createRemoteJWKSet(new URL(opts.jwksUrl), {
      cooldownDuration: opts.cooldownDuration ?? 30_000,
      cacheMaxAge: opts.cacheMaxAge ?? 600_000,
      timeoutDuration: opts.timeoutDuration ?? 5_000,
    });
    this.clientIds = [...opts.clientIds];
    this.clock = opts.clock;
  }

  async verify(identityToken: string): Promise<AppleIdentity> {
    let payload: JWTPayload;
    try {
      const result = await jwtVerify(identityToken, this.jwks, {
        issuer: APPLE_ISSUER,
        audience: this.clientIds,
        algorithms: ['RS256'],
        ...(this.clock ? { currentDate: this.clock.now() } : {}),
      });
      payload = result.payload;
    } catch (err) {
      throw mapJoseError(err);
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw invalid('malformed', 'Identity token has no subject');
    }
    const identity: AppleIdentity = { sub: payload.sub };
    if (typeof payload.email === 'string' && payload.email.length > 0) {
      identity.email = payload.email;
    }
    const emailVerified = asBoolean(payload.email_verified);
    if (emailVerified !== undefined) identity.emailVerified = emailVerified;
    const isPrivate = asBoolean(payload.is_private_email);
    if (isPrivate !== undefined) identity.isPrivateEmail = isPrivate;
    return identity;
  }
}
