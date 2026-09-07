/**
 * Tunable game constants. Mirrors the "Constants summary" of `docs/territory-rules.md` one-to-one
 * (`test/config.test.ts` parses that code block and asserts equality) plus the walk-acceptance
 * thresholds of the "Walk acceptance" table. Change the doc and this file together
 * (Constitution: Development Workflow), fixtures first (Constitution II).
 */
export const RULES = {
  /** H3 resolution at which all scoring happens. */
  RES: 9,
  /** Douglas-Peucker tolerance applied to the accepted path before splitting. */
  SIMPLIFY_TOLERANCE_M: 5,
  /** Max walking metres credited per player per cell per ISO week. */
  WEEKLY_CAP_M_PER_PLAYER_PER_CELL: 2000,
  BONUS_BIRD_M: 300,
  BONUS_PLANT_M: 200,
  BONUS_CAP_PER_PLAYER_PER_CELL_PER_WEEK: 5,
  /** Strength multiplier applied at every reckoning (halves each week). */
  DECAY: 0.5,
  /** Minimum strength to own a cell. */
  MIN_STRENGTH_M: 500,
  /** A challenger needs `incumbent * (1 + HYSTERESIS)` to flip a cell. */
  HYSTERESIS: 0.1,
  /** Parent owner needs `> PARENT_PLURALITY` of the claimed children. */
  PARENT_PLURALITY: 0.4,
  PARENT_MIN_CLAIMED_CHILDREN: 2,
  /** Monday 00:00 UTC, one global cutoff. */
  RECKONING_CRON: '0 0 * * 1',
  /** Week ids and the reckoning use UTC; only streaks use the player's local zone. */
  TZ: 'UTC',

  // Walk acceptance ("Walk acceptance" table)
  /** Samples with `horizontalAccuracy > 50 m` are dropped. */
  MAX_SAMPLE_HACC_M: 50,
  /** Samples reporting `speed > 5 m/s` are dropped. */
  MAX_SAMPLE_SPEED_MPS: 5,
  /** Implied speed between consecutive accepted samples above this flags `teleport`. */
  TELEPORT_SPEED_MPS: 8,
  /** Median implied speed above this flags `speed`. */
  MAX_WALK_MEDIAN_SPEED_MPS: 3.5,
  /** Walk length above this flags `distance`. */
  MAX_WALK_DISTANCE_M: 30000,
  /** Walk duration above this (6 h) flags `distance`. */
  MAX_WALK_DURATION_S: 21600,
  /** `steps / distance` below this flags `no_steps` ... */
  MIN_STEPS_PER_M: 0.5,
  /** ... but only for walks longer than this. */
  NO_STEPS_MIN_DISTANCE_M: 500,
} as const;

export type Rules = typeof RULES;
