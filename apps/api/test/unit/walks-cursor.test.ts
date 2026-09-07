import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors.js';
import { decodeCursor, encodeCursor } from '../../src/modules/walks/cursor.js';

describe('history cursor (research.md R12)', () => {
  const cursor = {
    startedAt: new Date('2026-09-07T08:00:00.000Z'),
    id: '2f9b7c1e-1b2c-4d3e-9f0a-1a2b3c4d5e6f',
  };

  it('round-trips as opaque base64url', () => {
    const encoded = encodeCursor(cursor);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(encoded, 'base64url').toString('utf8')).toBe(
      '2026-09-07T08:00:00.000Z|2f9b7c1e-1b2c-4d3e-9f0a-1a2b3c4d5e6f',
    );
    expect(decodeCursor(encoded)).toEqual(cursor);
  });

  it('rejects malformed cursors with 400 VALIDATION_FAILED and field cursor', () => {
    for (const bad of [
      '',
      'not-base64!',
      Buffer.from('no separator').toString('base64url'),
      Buffer.from('2026-09-07T08:00:00Z|2f9b7c1e-1b2c-4d3e-9f0a-1a2b3c4d5e6f').toString(
        'base64url',
      ),
      Buffer.from('2026-09-07T08:00:00.000Z|not-a-uuid').toString('base64url'),
      Buffer.from('later|2f9b7c1e-1b2c-4d3e-9f0a-1a2b3c4d5e6f').toString('base64url'),
      'x'.repeat(201),
    ]) {
      let error: unknown;
      try {
        decodeCursor(bad);
      } catch (err) {
        error = err;
      }
      expect(error, bad).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        details: { field: 'cursor' },
      });
    }
  });
});
