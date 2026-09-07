# Territory rules

Single source of truth for the game's territory mechanics. Constants are mirrored in `packages/territory-rules/src/config.ts`; behaviour is proven by `packages/h3-fixtures`. Change fixtures first, then code, then this file (Constitution II).

## Vocabulary

- **Cell**: an H3 resolution-9 hexagon (~0.105 km², ~174 m edge). All scoring happens at res 9.
- **Parent**: the res 8–5 hexagon containing a cell; parents are materialised for the map, never scored directly.
- **Week**: the ISO week (`YYYY-Www`) computed in UTC. One global cutoff, Monday 00:00 UTC, wherever the player is.
- **Contribution**: metres of a player's accepted walk path inside a cell, credited to the player's faction for the week (UTC) in which the walk finished.
- **Strength**: a faction's accumulated, decayed contribution in a cell. Only the weekly reckoning updates strength.
- **Owner**: the faction that held the highest strength at the most recent reckoning.
- **Reckoning**: the weekly job that applies decay, adds the week's contributions, and decides owners.

## Walk acceptance

| Check | Rule | Effect |
|---|---|---|
| Sample accuracy | `horizontalAccuracy > 50 m` | sample dropped |
| Sample speed | `speed > 5 m/s` | sample dropped |
| Implied speed | > 8 m/s between consecutive accepted samples | walk flagged `teleport` |
| Timestamps | non-monotonic | sample dropped |
| Walk median speed | > 3.5 m/s | walk flagged `speed` |
| Walk length / duration | > 30 km or > 6 h | walk flagged `distance` |
| Pedometer plausibility | `steps / distance < 0.5` over > 500 m | walk flagged `no_steps` |
| Unfinished walk | active > 12 h | auto-finished by the server |

Flagged walks are stored but **excluded from the reckoning** until an admin clears the flag or the nightly review job auto-clears it. The client applies the same sample filters for its live estimate; the server's result is authoritative.

## Scoring at walk finish (`finishWalk`)

1. Build the accepted path as a line string; simplify with Douglas–Peucker (5 m tolerance) to reduce GPS jitter.
2. Split every segment at res-9 cell boundaries and sum the length inside each cell → `[{cell, metres}]`.
3. Credit `metres` to `hex_week_contribution(cell, week, faction, player)`. `capped_metres` = min(cumulative player metres in that cell this week, **2 000 m**).
4. Award player XP: 1 XP per 100 m of accepted path (the API additionally caps walking XP at 300 per player per UTC day — an abuse limit in `apps/api/src/modules/walks/limits.ts`, `WALK_XP_DAILY_CAP`, not a scoring constant; flagged walks award nothing).
5. Return per-cell metres and the current week's standing (leading faction, the player's faction share). **Nothing about ownership changes here.**

The week is the ISO week computed in UTC — one global cutoff, not a per-time-zone one. A walk that finishes at or after Monday 00:00:00 UTC counts for the new week.

## Capture bonuses

Verified captures add metre-equivalents to the capture's cell for the player's faction in the current week:

| Capture | Bonus | Cap |
|---|---|---|
| Bird, verified | +300 m | 5 bonuses per player per cell per week |
| Plant, verified | +200 m | 5 bonuses per player per cell per week |
| Needs user confirmation, then confirmed | half bonus | same cap |
| Rejected / unconfirmed | 0 | — |

Bonuses are not subject to the 2 000 m walking cap.

## Weekly reckoning (`reckoning.weekly`)

Runs once per week at Monday 00:00 UTC (cron `0 0 * * 1`, one global cutoff for all players), for week W that just ended. It is the only code path that changes ownership.

For every cell with existing strength or contributions in W, per faction:

```
strength' = strength × DECAY + Σ capped_metres[W] + Σ capture_bonus[W]
DECAY = 0.5           (strength halves every week)
```

Ownership:

| Situation | Result |
|---|---|
| No faction reaches `MIN_STRENGTH` (500 m) | unclaimed |
| No incumbent, one faction ≥ 500 m | that faction |
| Challenger `strength' ≥ incumbent × 1.10` | challenger takes the cell (10 % hysteresis) |
| Incumbent still ≥ 500 m and no challenger clears hysteresis | incumbent keeps the cell |
| Incumbent below 500 m and no challenger ≥ 500 m | unclaimed |
| Exact tie at the top | incumbent keeps; if none, unclaimed |

Also at reckoning: captain = top contributor (metres) in W among the owning faction; `hex_ownership_events` row per flip; hex-flip XP (+15) to every player whose metres in W were part of a flip to their faction; parent states re-derived incrementally from child flips; weekly leaderboards and faction stats snapshotted; result pushes queued.

The job is idempotent per week: re-running for W is a no-op.

## Between reckonings (read model only)

- `pressureLeader` for a cell = faction with the highest `strength × 0.5 + this week's capped metres + bonuses`. If it differs from the owner, the map shows the cell as **contested**. This never changes the owner.
- The hex detail sheet shows strength per faction, this week's metres per faction, the player's own metres, the captain and the last 8 reckonings.

## Parent ownership (res 8 → 5)

- Owner = faction owning the most children, if that count is `> 40 %` of claimed children and `claimed_children ≥ 2`.
- Ties → unclaimed. No claimed children → unclaimed.
- Updated incrementally at reckoning from child flips (each res-9 flip touches exactly one parent per level); a nightly consistency job re-derives all parents from scratch and alerts on drift.

## Player-facing states

| State | Meaning |
|---|---|
| Explored | the player has any metres in the cell, ever |
| Flipped | the player's metres were part of a reckoning that flipped the cell to their faction |
| Held | the player is the cell's current captain |

## Other rules

| Rule | Default |
|---|---|
| Faction switch | once per 30 days; the first pick after sign-up is free and the first change starts the 30-day lock (`factionChangeAvailableAt`); XP kept; past contributions stay with the old faction |
| Streak | one finished walk ≥ 500 m or one verified capture per local day (the player's own time zone, `streaks.tz`; streaks are the only rule that uses local time — weeks and reckonings use UTC); one freeze per 7-day streak |
| Player XP for captures | bird 30, plant 20, first-of-species +50, rarity multiplier ×1 / ×1.5 / ×2 / ×3 |
| Levels | XP threshold for level L = `100 × L^1.6` |
| Balance | at sign-up the app pre-selects the faction with the fewest active players (the player may pick another); active = used the app in the last 14 days (`last_seen_at`), deleted accounts excluded; tie → lowest faction id. No underdog multiplier in the MVP; a multiplier is a post-launch idea (`docs/roadmap.md`) |

## Constants summary

```
RES = 9
SIMPLIFY_TOLERANCE_M = 5
WEEKLY_CAP_M_PER_PLAYER_PER_CELL = 2000
BONUS_BIRD_M = 300
BONUS_PLANT_M = 200
BONUS_CAP_PER_PLAYER_PER_CELL_PER_WEEK = 5
DECAY = 0.5
MIN_STRENGTH_M = 500
HYSTERESIS = 0.10
PARENT_PLURALITY = 0.40
PARENT_MIN_CLAIMED_CHILDREN = 2
RECKONING_CRON = "0 0 * * 1"    # UTC; Monday 00:00 UTC, one global cutoff
TZ = "UTC"                      # week ids and the reckoning; streaks use the player's local zone (streaks.tz)
```
