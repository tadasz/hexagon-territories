import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RULES } from '@nature/territory-rules';
import { describe, expect, it } from 'vitest';
import {
  HEX_BBOX_MAX_CELLS,
  HEX_FLIP_XP,
  HEX_HISTORY_WEEKS,
  HEXES_RATE_PER_MIN,
  LEADERBOARD_TOP_N,
  PUSH_START_AFTER_H,
  RECKONING_BATCH_SIZE,
  RECKONING_CONSISTENCY_CRON,
  RECKONING_LOCK_KEY,
  TERRITORY_LIMITS,
} from '../../src/modules/territory/limits.js';

describe('territory limits (research.md R18, plan.md Conventions)', () => {
  it('uses the constants of plan.md', () => {
    expect(HEX_FLIP_XP).toBe(15);
    expect(RECKONING_BATCH_SIZE).toBe(1000);
    expect(HEX_BBOX_MAX_CELLS).toBe(3000);
    expect(LEADERBOARD_TOP_N).toBe(100);
    expect(HEX_HISTORY_WEEKS).toBe(8);
    expect(RECKONING_CONSISTENCY_CRON).toBe('15 3 * * *');
    expect(HEXES_RATE_PER_MIN).toBe(120);
    expect(RECKONING_LOCK_KEY).toBe(1851881589);
    expect(PUSH_START_AFTER_H).toBe(8);
    expect(Object.keys(TERRITORY_LIMITS)).toHaveLength(14);
  });

  it('never duplicates a territory rule (those come from RULES only)', () => {
    const values = Object.values(TERRITORY_LIMITS) as (number | string)[];
    for (const key of ['DECAY', 'MIN_STRENGTH_M', 'HYSTERESIS', 'PARENT_PLURALITY'] as const) {
      expect(values, key).not.toContain(RULES[key]);
    }
    expect(values).not.toContain(RULES.RECKONING_CRON);
  });

  it('is documented in docs/territory-rules.md with the same numbers', () => {
    const doc = readFileSync(resolve(__dirname, '../../../../docs/territory-rules.md'), 'utf8');
    expect(doc).toContain(`hex-flip XP (+${String(HEX_FLIP_XP)})`);
    expect(doc).toContain(`last ${String(HEX_HISTORY_WEEKS)} reckonings`);
  });
});
