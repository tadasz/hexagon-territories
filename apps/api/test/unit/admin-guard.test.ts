import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors.js';
import { requireRole } from '../../src/modules/admin/guard.js';

function request(role: 'player' | 'tester' | 'admin' | null): FastifyRequest {
  return {
    user: role === null ? null : { id: 'u', role, factionId: 1, lastSeenAt: null },
  } as unknown as FastifyRequest;
}

describe('requireRole (research.md R12)', () => {
  it('lets the required role through', async () => {
    await expect(requireRole('admin')(request('admin'))).resolves.toBeUndefined();
    await expect(requireRole('tester')(request('tester'))).resolves.toBeUndefined();
  });

  it('answers 403 FORBIDDEN for any other role, naming the required one', () => {
    for (const role of ['player', 'tester'] as const) {
      try {
        void requireRole('admin')(request(role));
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect(err).toMatchObject({
          statusCode: 403,
          code: 'FORBIDDEN',
          details: { requiredRole: 'admin' },
        });
      }
    }
  });

  it('answers 401 when authenticate did not run', () => {
    expect(() => requireRole('admin')(request(null))).toThrow(
      expect.objectContaining({ statusCode: 401, code: 'UNAUTHORIZED' }) as Error,
    );
  });
});
