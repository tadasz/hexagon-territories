import { generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors.js';
import { JoseAppleVerifier } from '../../src/modules/auth/apple.js';
import { AppleStub, TEST_CLIENT_ID } from '../helpers/apple.js';
import { FakeClock } from '../helpers/clock.js';

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error('expected the verifier to reject');
}

describe('JoseAppleVerifier (local JWKS, no network)', () => {
  let apple: AppleStub;
  let verifier: JoseAppleVerifier;
  const clock = new FakeClock();

  beforeAll(async () => {
    apple = await AppleStub.create();
    await apple.listen();
    verifier = new JoseAppleVerifier({
      jwksUrl: apple.jwksUrl,
      clientIds: [TEST_CLIENT_ID, 'com.natureexplorer.app.beta'],
      clock,
      cooldownDuration: 0,
    });
  });
  afterAll(async () => {
    await apple.close();
  });

  it('accepts a valid token and returns sub and e-mail', async () => {
    const token = await apple.mintIdentityToken({
      sub: 'user-1',
      email: 'u1@privaterelay.appleid.com',
      isPrivateEmail: true,
      iat: clock.now(),
    });
    await expect(verifier.verify(token)).resolves.toEqual({
      sub: 'user-1',
      email: 'u1@privaterelay.appleid.com',
      emailVerified: true,
      isPrivateEmail: true,
    });

    const beta = await apple.mintIdentityToken({
      sub: 'user-2',
      aud: 'com.natureexplorer.app.beta',
      iat: clock.now(),
    });
    await expect(verifier.verify(beta)).resolves.toEqual({ sub: 'user-2' });
  });

  it('rejects the wrong audience', async () => {
    const token = await apple.mintIdentityToken({
      sub: 'u',
      aud: 'com.other.app',
      iat: clock.now(),
    });
    const err = await rejection(verifier.verify(token));
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('INVALID_APPLE_TOKEN');
    expect(err.details).toEqual({ reason: 'audience' });
  });

  it('rejects the wrong issuer', async () => {
    const token = await apple.mintIdentityToken({
      sub: 'u',
      iss: 'https://accounts.example.com',
      iat: clock.now(),
    });
    const err = await rejection(verifier.verify(token));
    expect(err.code).toBe('INVALID_APPLE_TOKEN');
    expect(err.details).toEqual({ reason: 'issuer' });
  });

  it('rejects an expired token', async () => {
    const token = await apple.mintIdentityToken({
      sub: 'u',
      iat: new Date(clock.now().getTime() - 3_600_000),
      exp: 600,
    });
    const err = await rejection(verifier.verify(token));
    expect(err.code).toBe('INVALID_APPLE_TOKEN');
    expect(err.details).toEqual({ reason: 'expired' });
  });

  it('rejects a token signed by another key with the same kid', async () => {
    const other = await generateKeyPair('RS256', { modulusLength: 2048 });
    const token = await apple.mintIdentityToken({
      sub: 'u',
      privateKey: other.privateKey,
      iat: clock.now(),
    });
    const err = await rejection(verifier.verify(token));
    expect(err.code).toBe('INVALID_APPLE_TOKEN');
    expect(err.details).toEqual({ reason: 'signature' });
  });

  it('answers APPLE_UNAVAILABLE for an unknown kid (keys cannot be resolved)', async () => {
    const token = await apple.mintIdentityToken({ sub: 'u', kid: 'rotated-key', iat: clock.now() });
    const err = await rejection(verifier.verify(token));
    expect(err.statusCode).toBe(503);
    expect(err.code).toBe('APPLE_UNAVAILABLE');
  });

  it('rejects a malformed token', async () => {
    const err = await rejection(verifier.verify('not-a-jwt'));
    expect(err.code).toBe('INVALID_APPLE_TOKEN');
    expect(err.details).toEqual({ reason: 'malformed' });
  });

  it('answers 503 APPLE_UNAVAILABLE when the key service is down', async () => {
    const down = new JoseAppleVerifier({
      jwksUrl: 'http://127.0.0.1:1/keys',
      clientIds: [TEST_CLIENT_ID],
      clock,
      timeoutDuration: 1_000,
    });
    const token = await apple.mintIdentityToken({ sub: 'u', iat: clock.now() });
    const err = await rejection(down.verify(token));
    expect(err.statusCode).toBe(503);
    expect(err.code).toBe('APPLE_UNAVAILABLE');
  });
});
