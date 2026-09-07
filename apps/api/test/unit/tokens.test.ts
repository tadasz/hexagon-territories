import { decodeJwt, decodeProtectedHeader } from 'jose';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors.js';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from '../../src/modules/auth/tokens.js';
import { FakeClock } from '../helpers/clock.js';

const SECRET = 'unit-test-secret-unit-test-secret-0123456789';
const USER = { id: '5b3f4e6c-2d1a-4c8b-9e7f-0a1b2c3d4e5f', role: 'player' as const };

describe('access tokens', () => {
  it('signs HS256 tokens with the claims of data-model.md §3', async () => {
    const clock = new FakeClock('2026-09-07T10:00:00.000Z');
    const { token, expiresAt } = await signAccessToken({ secret: SECRET, ttlS: 900, clock }, USER);
    expect(decodeProtectedHeader(token)).toEqual({ alg: 'HS256', typ: 'JWT' });
    const claims = decodeJwt(token);
    const iat = Math.floor(clock.now().getTime() / 1000);
    expect(claims).toEqual({
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      sub: USER.id,
      role: 'player',
      iat,
      exp: iat + 900,
    });
    expect(expiresAt.toISOString()).toBe('2026-09-07T10:15:00.000Z');
  });

  it('verifies a fresh token and rejects it once expired', async () => {
    const clock = new FakeClock('2026-09-07T10:00:00.000Z');
    const { token } = await signAccessToken({ secret: SECRET, ttlS: 900, clock }, USER);
    await expect(verifyAccessToken({ secret: SECRET, clock }, token)).resolves.toMatchObject({
      sub: USER.id,
      role: 'player',
    });

    clock.advanceSeconds(899);
    await expect(verifyAccessToken({ secret: SECRET, clock }, token)).resolves.toBeDefined();

    clock.advanceSeconds(2);
    const err = await verifyAccessToken({ secret: SECRET, clock }, token).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('TOKEN_EXPIRED');
    expect((err as AppError).statusCode).toBe(401);
  });

  it('rejects a token signed with another secret or malformed as UNAUTHORIZED', async () => {
    const clock = new FakeClock();
    const { token } = await signAccessToken(
      { secret: 'other-secret-other-secret-0123456789', ttlS: 900, clock },
      USER,
    );
    const forged = await verifyAccessToken({ secret: SECRET, clock }, token).catch(
      (e: unknown) => e,
    );
    expect((forged as AppError).code).toBe('UNAUTHORIZED');
    const garbage = await verifyAccessToken({ secret: SECRET, clock }, 'abc').catch(
      (e: unknown) => e,
    );
    expect((garbage as AppError).code).toBe('UNAUTHORIZED');
  });
});

describe('refresh tokens', () => {
  it('generates 32 random bytes as base64url and hashes them with sha256', () => {
    const token = generateRefreshToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateRefreshToken()).not.toBe(token);
    const hash = hashRefreshToken(token);
    expect(Buffer.isBuffer(hash)).toBe(true);
    expect(hash).toHaveLength(32);
    expect(hashRefreshToken(token).equals(hash)).toBe(true);
    expect(hashRefreshToken(`${token}x`).equals(hash)).toBe(false);
  });
});
