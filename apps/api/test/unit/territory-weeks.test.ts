import { weekIdFor } from '@nature/territory-rules';
import { describe, expect, it } from 'vitest';
import {
  compareWeekIds,
  isCompleted,
  isWeekId,
  justEndedWeek,
  nextReckoningAt,
  nextWeekId,
  previousWeekId,
  startOfIsoWeekUtc,
  weekEndUtc,
  weekStartUtc,
} from '../../src/modules/territory/weeks.js';

describe('territory weeks (research.md R2)', () => {
  it('starts and ends weeks at Monday 00:00 UTC', () => {
    expect(weekStartUtc('2026-W37').toISOString()).toBe('2026-09-07T00:00:00.000Z');
    expect(weekEndUtc('2026-W37').toISOString()).toBe('2026-09-14T00:00:00.000Z');
    expect(weekStartUtc('2026-W01').toISOString()).toBe('2025-12-29T00:00:00.000Z');
    expect(weekIdFor(weekStartUtc('2026-W37'))).toBe('2026-W37');
    expect(weekIdFor(new Date(weekEndUtc('2026-W37').getTime() - 1))).toBe('2026-W37');
  });

  it('Monday 00:00:00 UTC belongs to the new week and justEndedWeek is the previous one', () => {
    const monday = new Date('2026-09-07T00:00:00.000Z');
    expect(weekIdFor(monday)).toBe('2026-W37');
    expect(justEndedWeek(monday)).toBe('2026-W36');
    expect(justEndedWeek(new Date('2026-09-06T23:59:59.999Z'))).toBe('2026-W35');
    expect(justEndedWeek(new Date('2026-09-13T23:59:59.999Z'))).toBe('2026-W36');
    expect(startOfIsoWeekUtc(new Date('2026-09-10T15:00:00Z')).toISOString()).toBe(
      '2026-09-07T00:00:00.000Z',
    );
  });

  it('walks the sequence forwards and backwards across ISO-year boundaries', () => {
    expect(nextWeekId('2026-W36')).toBe('2026-W37');
    expect(previousWeekId('2026-W37')).toBe('2026-W36');
    // 2026 has 53 ISO weeks; 2027-W01 starts on 2027-01-04.
    expect(nextWeekId('2026-W52')).toBe('2026-W53');
    expect(nextWeekId('2026-W53')).toBe('2027-W01');
    expect(previousWeekId('2027-W01')).toBe('2026-W53');
    expect(weekStartUtc('2027-W01').toISOString()).toBe('2027-01-04T00:00:00.000Z');
    // 2025 has 52 weeks: 2025-W52 → 2026-W01.
    expect(nextWeekId('2025-W52')).toBe('2026-W01');
    const sequence: string[] = [];
    let week = '2026-W50';
    for (let i = 0; i < 5; i += 1) {
      sequence.push(week);
      week = nextWeekId(week);
    }
    expect(sequence).toEqual(['2026-W50', '2026-W51', '2026-W52', '2026-W53', '2027-W01']);
    expect(compareWeekIds('2026-W53', '2027-W01')).toBeLessThan(0);
    expect(compareWeekIds('2026-W09', '2026-W10')).toBeLessThan(0);
    expect(compareWeekIds('2026-W10', '2026-W10')).toBe(0);
  });

  it('validates week ids including the existence of week 53', () => {
    expect(isWeekId('2026-W37')).toBe(true);
    expect(isWeekId('2026-W53')).toBe(true);
    expect(isWeekId('2025-W53')).toBe(false);
    expect(isWeekId('2026-W00')).toBe(false);
    expect(isWeekId('2026-W54')).toBe(false);
    expect(isWeekId('2026-37')).toBe(false);
    expect(isWeekId('2026-w37')).toBe(false);
    expect(() => weekStartUtc('2025-W53')).toThrow(RangeError);
  });

  it('knows when a week is completed and when the next reckoning is due', () => {
    expect(isCompleted('2026-W36', new Date('2026-09-07T00:00:00.000Z'))).toBe(true);
    expect(isCompleted('2026-W37', new Date('2026-09-07T00:00:00.000Z'))).toBe(false);
    expect(isCompleted('2026-W37', new Date('2026-09-13T23:59:59.999Z'))).toBe(false);
    expect(isCompleted('2026-W37', new Date('2026-09-14T00:00:00.000Z'))).toBe(true);
    expect(nextReckoningAt(new Date('2026-09-07T10:00:00.000Z')).toISOString()).toBe(
      '2026-09-14T00:00:00.000Z',
    );
    expect(nextReckoningAt(new Date('2026-09-07T00:00:00.000Z')).toISOString()).toBe(
      '2026-09-14T00:00:00.000Z',
    );
    expect(nextReckoningAt(new Date('2026-09-06T23:59:59.999Z')).toISOString()).toBe(
      '2026-09-07T00:00:00.000Z',
    );
  });
});
