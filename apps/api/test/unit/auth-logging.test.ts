import { afterEach, describe, expect, it } from 'vitest';
import { LOG_REDACT_CENSOR, type App } from '../../src/app.js';
import { AppError, ERROR_CODES } from '../../src/errors.js';
import type { AppleTokenVerifier } from '../../src/modules/auth/apple.js';
import { subHash } from '../../src/modules/auth/service.js';
import { buildUnitApp } from '../helpers/app.js';

const IDENTITY_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.this-identity-token-must-never-be-logged.sig';
const EMAIL = 'tadas@example.com';

describe('auth logging (FR-015)', () => {
  let app: App | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  function captured() {
    const lines: string[] = [];
    return {
      lines,
      logger: { level: 'info', stream: { write: (line: string) => void lines.push(line) } },
    };
  }

  it('logs a rejected sign-in without the identity token or the e-mail', async () => {
    const { lines, logger } = captured();
    const verifier: AppleTokenVerifier = {
      verify: () =>
        Promise.reject(
          new AppError(401, ERROR_CODES.INVALID_APPLE_TOKEN, 'Identity token has expired', {
            reason: 'expired',
          }),
        ),
    };
    app = await buildUnitApp({ logger, appleVerifier: verifier });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/apple',
      payload: {
        identityToken: IDENTITY_TOKEN,
        authorizationCode: 'c_secret_code',
        fullName: { givenName: 'Tadas' },
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      error: { code: 'INVALID_APPLE_TOKEN', details: { reason: 'expired' } },
    });

    const joined = lines.join('\n');
    expect(joined).toContain('Identity token has expired');
    expect(joined).not.toContain(IDENTITY_TOKEN);
    expect(joined).not.toContain('this-identity-token');
    expect(joined).not.toContain('c_secret_code');
  });

  it('censors request bodies with credentials even when a handler logs them by accident', async () => {
    const { lines, logger } = captured();
    app = await buildUnitApp({ logger });
    app.post('/echo', (request) => {
      request.log.info({ body: request.body }, 'accidental body log');
      return { ok: true };
    });
    await app.inject({
      method: 'POST',
      url: '/echo',
      payload: { identityToken: IDENTITY_TOKEN, email: EMAIL, refreshToken: 'r-secret' },
    });
    const entry = lines
      .map((line) => JSON.parse(line) as { msg?: string; body?: Record<string, unknown> })
      .find((line) => line.msg === 'accidental body log');
    expect(entry?.body).toEqual({
      identityToken: LOG_REDACT_CENSOR,
      email: LOG_REDACT_CENSOR,
      refreshToken: LOG_REDACT_CENSOR,
    });
    expect(lines.join('\n')).not.toContain(EMAIL);
  });

  it('hashes Apple subjects for correlation', () => {
    expect(subHash('001234.abcdef.5678')).toMatch(/^[0-9a-f]{8}$/);
    expect(subHash('a')).not.toBe(subHash('b'));
    expect(subHash('a')).toBe(subHash('a'));
  });
});
