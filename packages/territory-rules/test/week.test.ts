import { describe, expect, it } from 'vitest';
import { RULES, weekIdFor } from '../src/index.js';

describe('weekIdFor (ISO week in UTC)', () => {
  it('uses UTC as the single global cutoff', () => {
    expect(RULES.TZ).toBe('UTC');
    expect(weekIdFor(new Date('2026-09-06T23:59:59Z'))).toBe('2026-W36'); // Sunday night
    expect(weekIdFor(new Date('2026-09-07T00:00:00Z'))).toBe('2026-W37'); // Monday 00:00 UTC
    expect(weekIdFor(new Date('2026-09-07T02:30:00+03:00'))).toBe('2026-W36'); // still Sunday in UTC
  });

  it('matches the fixture weeks', () => {
    expect(weekIdFor(new Date('2026-08-24T12:00:00Z'))).toBe('2026-W35');
    expect(weekIdFor(new Date('2026-08-31T12:00:00Z'))).toBe('2026-W36');
    expect(weekIdFor(new Date('2026-09-13T23:59:59Z'))).toBe('2026-W37');
  });

  it('handles ISO year boundaries', () => {
    expect(weekIdFor(new Date('2021-01-03T00:00:00Z'))).toBe('2020-W53');
    expect(weekIdFor(new Date('2021-01-04T00:00:00Z'))).toBe('2021-W01');
    expect(weekIdFor(new Date('2024-12-30T00:00:00Z'))).toBe('2025-W01');
    expect(weekIdFor(new Date('2027-01-03T00:00:00Z'))).toBe('2026-W53');
    expect(weekIdFor(new Date('2026-01-01T00:00:00Z'))).toBe('2026-W01');
    expect(weekIdFor(new Date('2025-12-28T00:00:00Z'))).toBe('2025-W52');
  });

  it('rejects invalid dates', () => {
    expect(() => weekIdFor(new Date('nope'))).toThrow(RangeError);
  });
});
