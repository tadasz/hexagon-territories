/**
 * Non-territory constants of feature 004 (research.md R18, plan.md "Conventions"). These are not
 * territory rules — the client never evaluates them and no fixture consumes them — so they live
 * here rather than in `packages/territory-rules`, as 002 did for its account rules and 003 for
 * its abuse limits. Territory constants (`DECAY`, `MIN_STRENGTH_M`, `HYSTERESIS`, `PARENT_*`,
 * `RECKONING_CRON`, `TZ`) are read from `RULES` only. `test/unit/territory-limits.test.ts`
 * asserts that docs/territory-rules.md still documents the flip XP and the history length.
 */
export const TERRITORY_LIMITS = {
  /** XP awarded to every walker of the winning faction when a cell flips to it. */
  HEX_FLIP_XP: 15,
  /** Cells per reckoning transaction (config `RECKONING_BATCH_SIZE`). */
  RECKONING_BATCH_SIZE: 1000,
  /** `GET /v1/hexes` refuses a box estimated to hold more hexagons (config `HEX_BBOX_MAX_CELLS`). */
  HEX_BBOX_MAX_CELLS: 3000,
  /** Rows per leaderboard scope in `leaderboard_snapshots`. */
  LEADERBOARD_TOP_N: 100,
  /** Reckonings shown in the hex detail. */
  HEX_HISTORY_WEEKS: 8,
  /** Nightly parent consistency check, UTC (config `RECKONING_CONSISTENCY_CRON`). */
  RECKONING_CONSISTENCY_CRON: '15 3 * * *',
  /** `GET /v1/hexes` requests per minute per player. */
  HEXES_RATE_PER_MIN: 120,
  /** `pg_try_advisory_lock` key held for the duration of a reckoning (arbitrary, documented). */
  RECKONING_LOCK_KEY: 1851881589,
  /** Result pushes are queued for Monday 08:00 UTC (feature 008 moves them to the local morning). */
  PUSH_START_AFTER_H: 8,
  /** An active push job expires after this; pg-boss caps `expireInHours` strictly below 24. */
  PUSH_EXPIRE_IN_HOURS: 23,
  /** Unconsumed push rows are kept this long before pg-boss archives them. */
  PUSH_RETENTION_DAYS: 14,
  /** Entries of `flipsPreview` in a dry run result. */
  FLIPS_PREVIEW_MAX: 1000,
  /** Entries of `myFlippedHexes` in `GET /v1/reckonings/latest`. */
  MY_FLIPPED_HEXES_MAX: 200,
  /** Drift entries kept in `reckoning_consistency.sample`. */
  CONSISTENCY_SAMPLE_SIZE: 20,
} as const;

export const {
  HEX_FLIP_XP,
  RECKONING_BATCH_SIZE,
  HEX_BBOX_MAX_CELLS,
  LEADERBOARD_TOP_N,
  HEX_HISTORY_WEEKS,
  RECKONING_CONSISTENCY_CRON,
  HEXES_RATE_PER_MIN,
  RECKONING_LOCK_KEY,
  PUSH_START_AFTER_H,
  PUSH_EXPIRE_IN_HOURS,
  PUSH_RETENTION_DAYS,
  FLIPS_PREVIEW_MAX,
  MY_FLIPPED_HEXES_MAX,
  CONSISTENCY_SAMPLE_SIZE,
} = TERRITORY_LIMITS;
