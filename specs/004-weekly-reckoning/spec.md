# Feature Specification: Weekly Reckoning

**Feature Branch**: `004-weekly-reckoning`

**Created**: 2026-09-07

**Status**: Implemented (2026-09-07; owner and first-CI-run follow-ups in `tasks.md` Phase 4, T023–T024)

**Input**: User description: "Weekly reckoning job: decay, ownership with hysteresis, captains, ownership events, parent rollup, snapshots; hex read endpoints and contested read model; reckoning results endpoint and push; walk-sim --reckon"

Feature 004 of `docs/roadmap.md` (depends on 003). It closes the "walk & conquer" loop: every Monday at 00:00 UTC the server takes the metres every faction earned in every hexagon during the week that just ended, halves what each faction had before, adds the new metres and capture bonuses, and decides who owns each hexagon — with a 10 % hysteresis so a cell does not flip on a whisker. It names a captain per owned cell, records every flip, rolls ownership up to the coarser hexagons the map shows when zoomed out, snapshots the week's leaderboards and faction statistics, awards flip XP, and queues the Monday results push. Between reckonings, the API answers what the map and the hex detail sheet need: who owns a cell, since when, who is leading this week, whether the cell is contested, the last eight reckonings, the player's own metres. Operators can run a reckoning by hand for a given week, preview the flips it would cause, and replay a whole week from the command line with `walk-sim`. Nothing in this feature touches the iOS app (the map is 005); the API contract snapshot is refreshed so 005 can generate its client from it.

## Clarifications

### Session 2026-09-07

Non-interactive session: every ambiguity was resolved by the planner from `docs/architecture.md` §5/§6/§8, `docs/territory-rules.md` ("Weekly reckoning", "Between reckonings", "Parent ownership", "Player-facing states", "Constants summary"), `packages/territory-rules` (the functions the job must call), `packages/h3-fixtures/README.md` (`reckoning-weeks.json`), the constitution and the binding decisions handed over with the feature. Each decision is recorded here and reflected in the requirements below so that nothing lives only in a chat transcript. The five-question cap was deliberately exceeded for the same reason as in 002 and 003.

- Q: When exactly does a reckoning run, and for which week? → A: Once per week at Monday 00:00 UTC (one global cutoff), for the ISO week (UTC) that just ended. If the server was down at that moment it runs as soon as it is back; if it missed several weeks it runs each missed week **in order**, because decay must be applied once per week. Weeks are reckoned strictly in sequence: the next reckoning is always for the week after the last completed one (the very first reckoning is for the earliest week that has any contribution).
- Q: What does a reckoning do, step by step? → A: Exactly `docs/territory-rules.md` "Weekly reckoning": (1) finish walks that have been active for more than 12 hours so their metres land before anything is read; (2) for every hexagon that has strength or contributions in that week, per faction `strength' = strength × 0.5 + Σ capped metres + Σ capture bonuses`, then the ownership table (500 m minimum, 10 % hysteresis, ties favour the incumbent); (3) captain = the owning faction's top walker that week; (4) one ownership event per flip; (5) +15 XP to every player whose metres that week were part of a flip to their faction; (6) parents (res 8 → 5) re-derived incrementally from the flips; (7) weekly leaderboards (global and per faction, by counted metres) and faction statistics snapshotted; (8) result pushes queued. The rules arithmetic is never re-implemented: the job calls the shared rules package (`applyWeeklyCap`, `reckonWeek`, `deriveParentOwner`, `weekIdFor`, the constants).
- Q: What if the job crashes halfway or is started twice? → A: A reckoning is idempotent per week and resumable. Cells are processed in batches (1 000 per transaction, ordered by cell id); each batch writes its results and advances a cursor in the same transaction, so a crash loses at most one uncommitted batch and the next run continues from the cursor. A week that is already done is a no-op. Two runs can never overlap: the job is a singleton and takes a database lock; a manual run while a job holds the lock is refused.
- Q: Which hexagons are processed? → A: Every res-9 cell that has any faction strength left from earlier weeks **or** any contribution (metres or bonus) in the week being reckoned. A cell seen for the first time gets its state row created with its parents (res 8–5) and its polygon precomputed by the API (no database H3 extension is required). Cells with nothing to decay and nothing new are skipped.
- Q: How is a cell shown "contested" between reckonings? → A: `pressureLeader` = the faction with the highest `strength × 0.5 + this week's capped metres + this week's bonuses` (ties → lowest faction id; none when every score is 0). The cell is **contested** when the pressure leader exists and differs from the owner. This is a read model shared with 003's finish summary (`weekStanding`); it never changes ownership. For res 5–8 hexagons the API returns no pressure leader and `contested = false` in this feature (a materialised parent pressure is a later optimisation).
- Q: What does the map endpoint return? → A: `GET /v1/hexes?res=&bbox=` lists the hexagons of one resolution (5–9) whose polygon intersects the bounding box: cell id, owner, owner-since week, pressure leader, contested. Only hexagons that have a state row are returned (never-walked cells are simply absent). The bounding box is capped so that a request can never ask for more than 3 000 hexagons of the requested resolution (the client's own polyfill cap); a larger box is refused with an error that says the limit. Res 9 comes from the cell state plus the read model; res 5–8 from the materialised parent state. The endpoint requires a signed-in player and is rate limited.
- Q: What does the hex detail endpoint return? → A: For a res-9 cell: owner and since when, captain (id and display name), strength per faction, this week's counted metres and bonuses per faction with the pressure leader and contested flag, the caller's own metres in the cell this week and the caller's states (explored / flipped / held), the last eight reckonings of the cell (owner, strengths, whether it flipped), and a `captures` list that stays empty until feature 006. Any valid res-9 cell answers 200, with empty state if it has never been walked.
- Q: What does "latest reckoning" return? → A: The week id and run time of the last completed reckoning, when the next one is due, per-faction totals for that week (hexes owned at res 9 and res 7, counted metres, active walkers, flips gained and lost), the number of cells the caller helped flip to their faction that week and the ids of those cells. Before the first reckoning the endpoint answers with null week fields and empty totals rather than an error.
- Q: How does the weekly cap interact with the reckoning? → A: The cap (2 000 m per player per cell per week) is applied by the rules package's `applyWeeklyCap` over the raw metres stored per player, at reckoning time; the value 003 stored at walk finish is the same number and is only cross-checked. Bonuses are never capped.
- Q: What is a captain and when does it change? → A: The player of the owning faction with the most counted walking metres in the cell in the reckoned week (ties → lowest player id). It is recomputed at every reckoning; a cell whose owner keeps it without any walk that week has no captain. Bonuses do not make a captain. "Held" in the player-facing states means "is the current captain".
- Q: Who gets flip XP? → A: Every player with counted walking metres > 0 in the cell that week for the faction the cell flipped **to**, +15 XP each, once per flip (idempotent). A flip to "unclaimed" awards nothing. The 15 points are a game constant outside the territory "Constants summary": it lives with the API's territory limits and a test asserts the doc still says "+15".
- Q: How are parents updated? → A: Incrementally at each reckoning: every res-9 flip touches exactly one parent per level (8, 7, 6, 5); the parent's per-faction counts of claimed children are adjusted and its owner re-derived with the shared rule (`> 40 %` of claimed children, at least 2 claimed children, ties unclaimed). A nightly consistency job re-derives every parent from scratch, compares, records and logs any drift (error level so it can be alerted on), and can repair when an operator asks for it; it never repairs on its own.
- Q: What about the results push? → A: Feature 004 only **queues** one push per player who contributed that week (their flips and the cells they were captain of and lost) into the `push.send` queue with an idempotency key per player and week; the worker that delivers pushes arrives in feature 008 (device registration is also 008). Queued rows expire if nobody consumes them.
- Q: How does an operator run a reckoning by hand? → A: Two ways with the same semantics: the API's job runner (`pnpm --filter @nature/api job:reckoning -- --week 2026-W37`, optionally `--dry-run` which prints the flips and writes nothing), and an admin-only endpoint `POST /v1/admin/reckonings/{weekId}` (role `admin`) that runs the same code either synchronously (answering the result) or by enqueuing the job, with the same dry-run option and a status endpoint to poll. `walk-sim reckon <weekId>` calls the admin endpoint, so a tester can replay GPX tracks and then reckon the week from a terminal. A week that has not ended, a week out of sequence, or a run while another is in progress are refused with specific errors.
- Q: What are the performance and scale expectations? → A: 10 000 cells reckoned in under 5 minutes on a developer machine (roadmap phase-4 exit criterion), verified by a timed integration test that can be skipped with `SKIP_PERF=1`. Map list requests answer within 300 ms for a full 3 000-cell box.
- Q: What about erased accounts and export? → A: Leaderboard snapshot rows of an erased player are anonymised (rank and metres kept, player removed) so historical boards keep their shape; ownership events carry no player and are kept; the captain reference and the per-cell history are cleared of the player; queued pushes for the player are deleted; flip XP rows are removed with the player's ledger (003's step). The export bundle gains a `territory` section (flips the player took part in, cells they captain, their leaderboard placements).
- Q: Does anything in the iOS app change? → A: No. The map, the hex detail sheet and the Monday results sheet are feature 005; this feature refreshes the committed OpenAPI snapshot so 005 generates its client from it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The week is reckoned and hexagons change hands (Priority: P1)

Players walk all week; their metres are credited to hexagons at every walk finish. On Monday at 00:00 UTC the reckoning runs: strengths halve, the week's metres and bonuses are added, owners are decided with hysteresis, captains are named, flips are recorded and rewarded, coarser hexagons follow their children, the week's boards and faction statistics are frozen, and result pushes are queued. If the server was down, the reckoning runs on the next start; if it crashed halfway, it continues where it stopped; running it twice changes nothing.

**Why this priority**: This is the only code path that changes ownership (Constitution II). Without it hexagons never flip and the game has no weekly loop.

**Independent Test**: Seed the shared `reckoning-weeks.json` fixture cases as contributions for three consecutive weeks, run three reckonings with a fake clock, and assert that strengths, owners, flip events and captains equal the fixture's expected values for every cell and week, that parents equal the shared parent rule over the children, and that the leaderboard and faction snapshots exist for each week. Kill the run after the first batch and re-run: the end state is identical. Run the same week again: no rows change.

**Acceptance Scenarios**:

1. **Given** a cell with no owner where one faction earned 800 counted metres in week W, **When** W is reckoned, **Then** that faction owns the cell, an ownership event `null → faction` is recorded for W, the cell's `ownerSince` is W, and its captain is the faction's top walker.
2. **Given** an owner with 1 000 strength and a challenger with 0, **When** the owner's players earn 100 m and the challenger's earn 700 m in W, **Then** the owner keeps 600 and the challenger has 700 ≥ 660, so the challenger takes the cell (10 % hysteresis cleared).
3. **Given** an incumbent at 1 250 and a challenger at 1 312.5 after decay and additions, **When** W is reckoned, **Then** the incumbent keeps the cell (the challenger leads but is under 1 375), no event is recorded and the cell shows as contested until the next reckoning if the challenger still leads the pressure.
4. **Given** an owner whose strength decays to 450 with no challenger at or above 500, **When** W is reckoned, **Then** the cell becomes unclaimed with an event `faction → null`, no captain, no XP awarded.
5. **Given** two factions exactly tied at the top, **When** W is reckoned, **Then** the incumbent keeps the cell if it is one of them; if there is no incumbent the cell stays unclaimed.
6. **Given** three players of the winning faction with 400 m, 1 900 m and 2 600 m (capped to 2 000) in a cell that flips, **When** W is reckoned, **Then** each receives +15 XP exactly once and the captain is the 2 600 m walker; a player of the losing faction receives nothing.
7. **Given** a res-8 hexagon whose seven children are owned `[1,1,1,2,2,3,3]`, **When** the reckoning finishes, **Then** the parent is owned by faction 1 (3 of 7 claimed > 40 %); **Given** the children later become `[1,1,2,2,3,3,null]`, **Then** the parent is unclaimed (tie).
8. **Given** a cell that has contributions in W but no state row yet, **When** W is reckoned, **Then** the row is created with its res 8–5 parents and a polygon that contains the cell's centre.
9. **Given** a reckoning that failed after 3 of 10 batches, **When** the job runs again, **Then** it resumes at batch 4, the final state equals a clean run, and no cell is reckoned twice for that week.
10. **Given** the server missed two Mondays, **When** it starts, **Then** it reckons the two missed weeks in order before the current one, applying decay once per week.
11. **Given** a walk active for more than 12 hours at the cutoff, **When** the reckoning starts, **Then** the walk is finished first and its metres count for the week of its end.

---

### User Story 2 - See who owns what, and where the fight is (Priority: P1)

A player opens the map (feature 005) and the app asks the API for the hexagons in view at the current resolution. Each hexagon comes back with its owner, since when, which faction is leading this week's pressure and whether the hexagon is contested. Long-pressing a hexagon shows the detail: owner, captain, strength per faction, this week's metres per faction, the player's own metres and states, and the last eight reckonings.

**Why this priority**: The map is the product's face; without the read endpoints 005 has nothing to draw and the reckoning's results are invisible.

**Independent Test**: With a seeded database (owners, strengths, this week's contributions), call the list endpoint at every resolution 5–9 with boxes inside and above the cap, and the detail endpoint for owned, contested, unclaimed and never-walked cells; assert the fields against the rules (pressure leader, contested, parents) and the errors for bad boxes.

**Acceptance Scenarios**:

1. **Given** res 9 and a bounding box covering 40 state rows, **When** the list is requested, **Then** exactly those 40 cells are returned with `owner`, `ownerSince`, `pressureLeader`, `contested`, sorted by cell id.
2. **Given** a cell owned by faction 1 with strength 1 000 where faction 2 earned 700 m this week, **When** the list is requested, **Then** the cell shows `pressureLeader = 2` and `contested = true` (700 > 500), while its owner stays 1.
3. **Given** res 7 and a box covering materialised parents, **When** the list is requested, **Then** each parent comes with its owner, `pressureLeader = null`, `contested = false`.
4. **Given** a bounding box whose area would contain more than 3 000 hexagons at the requested resolution, **When** the list is requested, **Then** the API refuses with an error naming the limit and the estimated count.
5. **Given** a malformed box (min > max, out-of-range coordinates, crossing the antimeridian) or a resolution outside 5–9, **When** the list is requested, **Then** a validation error names the field.
6. **Given** a res-9 cell with an owner and a captain, **When** the caller opens the detail, **Then** they see the captain's display name, strengths per faction, this week's metres per faction, their own metres (0 if none), `explored`/`flipped`/`held` flags and the last eight reckonings newest first.
7. **Given** a valid res-9 cell nobody has ever walked, **When** the detail is requested, **Then** 200 with no owner, empty strengths, empty history.
8. **Given** a cell id that is not a res-9 cell, **When** the detail is requested, **Then** a validation error.

---

### User Story 3 - Read the Monday results (Priority: P2)

On Monday morning the app shows the player what happened: which week was reckoned, how the factions stand, how many hexagons the player helped flip, and when the next reckoning is. A push notification will bring them there once feature 008 delivers it; 004 queues the message.

**Why this priority**: Closes the loop emotionally ("we took the park") and drives Monday retention; it depends only on the reckoning's outputs.

**Independent Test**: After a seeded reckoning, call the latest-reckoning endpoint as a player who contributed to two flips and as a player who did not; assert the totals, `myFlips` and the next run time; assert one queued push per contributing player with the right counts, and none duplicated on a re-run.

**Acceptance Scenarios**:

1. **Given** the last completed reckoning is W, **When** a player asks for the latest, **Then** they get `weekId = W`, its run time, `nextAt` = the next Monday 00:00 UTC after now, per-faction totals and their own flip count and flipped cell ids.
2. **Given** no reckoning has ever run, **When** a player asks for the latest, **Then** the week fields are null, totals are empty, `myFlips = 0` and `nextAt` is still given.
3. **Given** a reckoning for W completed with 42 contributing players, **When** the push queue is inspected, **Then** it holds 42 queued result messages for W, one per player, each carrying that player's flips and lost captaincies; a re-run of W adds none.

---

### User Story 4 - Run or preview a reckoning by hand (Priority: P2)

An operator or tester wants to reckon a week now (for a demo, a test environment, or after fixing a problem) or to see what a reckoning would do without doing it. They run one command, or `walk-sim` after replaying tracks, and get the result or the list of flips.

**Why this priority**: The roadmap's phase-1 exit criterion ("two simulated reckonings match expected owners from replayed GPX") needs it; it is also the recovery tool when the schedule misfires.

**Independent Test**: Replay two GPX tracks as players of different factions, run `walk-sim reckon` for the week with `--dry-run` and without, and assert the printed flips match the owners the list endpoint returns afterwards; call the admin endpoint as a non-admin and get 403; ask for a week that has not ended and get a specific error.

**Acceptance Scenarios**:

1. **Given** an admin token and a completed week W that is next in sequence, **When** `POST /v1/admin/reckonings/W` is called synchronously, **Then** the reckoning runs and the response carries the counts (cells, flips, parent flips, walks auto-finished, pushes queued, duration).
2. **Given** the same call with `dryRun`, **When** it runs, **Then** nothing is written (no state, events, snapshots, XP, pushes, no reckoning row) and the response lists the flips it would have made.
3. **Given** a week that has not ended, a week that is not the next in sequence, or a reckoning already running, **When** the endpoint is called, **Then** it answers a specific error for each case; a week already done answers its stored result.
4. **Given** a player or tester token, **When** the admin endpoint is called, **Then** 403.
5. **Given** the job runner, **When** `job:reckoning -- --week W --dry-run` is executed, **Then** it prints each would-be flip (cell, from, to) and exits 0 without writing.
6. **Given** two replayed tracks in different factions, **When** `walk-sim reckon W` is run, **Then** the output shows the flips and `GET /v1/hexes` shows the resulting owners.

---

### User Story 5 - Operate with confidence: integrity, privacy, performance (Priority: P3)

The nightly consistency check re-derives every parent from scratch and reports drift so an operator learns about a bug before players do. Erasing an account keeps the boards and history consistent without the player. A reckoning of 10 000 cells fits in the 5-minute budget.

**Why this priority**: Not player-visible, but it is what makes the weekly cadence trustworthy and keeps Constitution IV holding as new per-player rows appear.

**Independent Test**: Corrupt one parent row, run the consistency job, assert it reports one drifted parent (and repairs it only with the repair flag); erase a player and assert their leaderboard rows are anonymised, their captaincy and history references cleared and their queued pushes gone; seed 10 000 cells and time a reckoning.

**Acceptance Scenarios**:

1. **Given** a parent row whose owner disagrees with its children, **When** the consistency job runs, **Then** it records and logs one drift with the parent id, expected and actual owner, and leaves the row unchanged; **When** it runs with repair, **Then** the row is corrected and the report says one repaired.
2. **Given** a player with leaderboard rows, a captaincy and queued pushes, **When** their account is purged, **Then** the leaderboard rows remain with no player, the cell's captain is empty, the cell history no longer names them and their queued pushes are deleted; ownership events are untouched.
3. **Given** 10 000 cells with strengths and contributions, **When** a reckoning runs, **Then** it completes in under 5 minutes (the test records the actual time).
4. **Given** a player's export bundle, **When** it is built, **Then** it contains a `territory` section with their flips, captaincies and leaderboard placements.

---

### Edge Cases

- A walk that ends at 00:00:00.000 UTC Monday counts for the new week; the reckoning of the old week does not see it (003 rule, unchanged).
- A walk still active but younger than 12 hours at the cutoff is not finished; its metres count for the week of its eventual finish.
- A cell whose only remaining strength drops below 0.001 loses its strength rows; the state row stays (owner null) and the history records the week.
- A faction that no longer exists cannot appear (faction ids are seed data; the fixture uses 1–3).
- A player who changed faction mid-week: their contributions stay with the faction they walked for (rows carry the faction); flip XP goes to the faction on the row.
- The fixture's `bonus-only` case: bonuses alone can reach 500 and claim a cell; no captain is named.
- A parent whose claimed children fall to 1 or 0 becomes unclaimed; parent counts never go negative (a delta that would make a count negative is a bug and fails the batch loudly).
- The very first reckoning: no prior strengths, only contributions; every processed cell is created in the same run.
- Manual run for a week older than the last completed one: answered with the stored result (no-op), never re-reckoned.
- Manual run while the cron job holds the lock: refused, not queued twice.
- A bounding box at res 5 covering the whole of Lithuania (~65 000 km²) is ~260 cells and is allowed; the same box at res 9 (~620 000 cells) is refused.
- Cells at the antimeridian or near the poles: polygons are unwrapped to a continuous longitude range before storage; the fixture's antimeridian cells are the test.
- Deleted captain: the FK clears the reference; the next reckoning may name a new captain.
- Dry run does not auto-finish stale walks (it writes nothing), so its flip list may differ from the real run by the metres of those walks; the output says so.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST run a reckoning for the ISO week (UTC) that just ended at Monday 00:00 UTC (one global cutoff), and on start-up MUST run every missed week in order before the current one; reckonings MUST be sequential (each for the week after the last completed one).
- **FR-002**: A reckoning MUST first finish every walk that has been active for more than 12 hours (reusing 003's finish path), then process every res-9 cell that has faction strength or any contribution in the reckoned week.
- **FR-003**: For each processed cell the system MUST compute per-faction strength as `strength × DECAY + Σ capped metres + Σ capture bonuses` and decide the owner by the ownership table of `docs/territory-rules.md` (500 m minimum, 10 % hysteresis, incumbent keeps ties, unclaimed when no faction qualifies) by calling `@nature/territory-rules` (`applyWeeklyCap`, `reckonWeek`) — never by re-implementing the arithmetic.
- **FR-004**: The system MUST persist the new strengths, owner, owner-since week, captain and a per-cell history entry for the week; MUST record one ownership event per flip; MUST create the state row (with res 8–5 parents and polygon computed by the API without a database H3 extension) for a cell seen for the first time.
- **FR-005**: The system MUST award +15 XP, once, to every player with counted walking metres > 0 in the cell that week for the faction the cell flipped to, as a ledger row and an increment of the player's XP; flips to unclaimed award nothing.
- **FR-006**: The system MUST update res 8–5 parents incrementally from the flips (claimed-children counts per faction; owner via `deriveParentOwner`), creating parent rows with polygons on first sight, and MUST fail loudly rather than store a negative count.
- **FR-007**: After all cells, the system MUST snapshot the week's leaderboards (scope global and per faction, top 100 by counted walking metres, with the week's points) and per-faction statistics (hexes owned at res 9 and res 7, counted metres, active walkers, captures), and record the reckoning (counts, timings, status).
- **FR-008**: The system MUST queue one result push per contributing player for the week (flips, lost captaincies) with an idempotency key per player and week, into the queue feature 008 will consume; no push is delivered in this feature.
- **FR-009**: A reckoning MUST be idempotent per week (a completed week is a no-op) and resumable (cells processed in transactional batches of a configurable size, default 1 000, with a cursor persisted in the same transaction; a rerun continues from the cursor); two reckonings MUST never run concurrently (singleton job plus a database lock).
- **FR-010**: `GET /v1/hexes?res=&bbox=` MUST return, for res 5–9, the hexagons with a state row intersecting the box — `h3`, `res`, `owner`, `ownerSince`, `pressureLeader`, `contested` — sorted by cell id; MUST refuse a box estimated to hold more than 3 000 hexagons of that resolution with an error that names the limit and the estimate; MUST validate the box and resolution; MUST require a signed-in player and be rate limited.
- **FR-011**: `pressureLeader` for a res-9 cell MUST be the faction with the highest `strength × DECAY + this week's capped metres + bonuses` (ties → lowest faction id; null when all scores are 0) and `contested` MUST be true exactly when the pressure leader exists and differs from the owner; the computation MUST be shared with 003's `weekStanding`. Res 5–8 rows return `pressureLeader = null`, `contested = false`.
- **FR-012**: `GET /v1/hexes/{h3}` MUST, for any valid res-9 cell, return owner, owner-since, captain (id, display name), strength per faction, this week's per-faction counted metres and bonuses with pressure leader and contested flag, the caller's own metres and states (`explored`, `flipped`, `held`), the last eight reckonings (newest first) and an empty `captures` list; a non-res-9 id is a validation error.
- **FR-013**: `GET /v1/reckonings/latest` MUST return the last completed reckoning's week id and run time, `nextAt` (next Monday 00:00 UTC), per-faction totals (hexes owned r9/r7, metres, active walkers, flips gained/lost), the caller's flip count and flipped cell ids for that week; before any reckoning it MUST answer with null week fields and empty totals.
- **FR-014**: `POST /v1/admin/reckonings/{weekId}` MUST be restricted to role `admin` (403 otherwise), MUST run the same reckoning code synchronously or enqueue it, MUST support a dry run that writes nothing and returns the would-be flips, and MUST refuse a week that has not ended, a week out of sequence, or a run while another is in progress with distinct error codes; a completed week answers its stored result. `GET /v1/admin/reckonings/{weekId}` MUST return the reckoning's status.
- **FR-015**: The job runner MUST accept `job:reckoning -- --week <weekId> [--dry-run]` (dry run prints the flips and writes nothing) and `job:consistency -- [--repair]`; `walk-sim reckon <weekId>` MUST call the admin endpoint and print the result.
- **FR-016**: A nightly consistency job MUST re-derive every parent (res 8–5) from the res-9 state, compare with the stored parent rows, record and log drift at error level, and repair only when explicitly asked.
- **FR-017**: Account erasure MUST anonymise the player's leaderboard rows (keep rank and metres, remove the player), clear captain and history references, delete their queued pushes, and leave ownership events untouched; the export bundle MUST gain a `territory` section (flips, captaincies, leaderboard placements). Both MUST be registered with 002's registries so the FK-coverage test passes.
- **FR-018**: The committed OpenAPI snapshot MUST be refreshed with the new operations so feature 005 can generate its client; the API MUST keep every 001–003 operation unchanged.
- **FR-019**: The feature MUST ship integration tests that replay the `reckoning-weeks.json` fixture semantics through the real job against Postgres (three weeks, strengths, owners, events, captains, parents, snapshots), idempotent rerun, resume after a simulated crash, first-time cell creation, list endpoint at every resolution with cap errors, contested flag, `myFlips`, consistency drift, purge/export; and a timed 10 000-cell test skippable with `SKIP_PERF=1`.
- **FR-020**: No territory rule or constant changes: `packages/territory-rules`, `packages/h3-fixtures`, the Swift mirror and the "Constants summary" of `docs/territory-rules.md` are untouched; non-territory constants of this feature (flip XP 15, batch size, box cap, top-N, history length, consistency schedule) live with the API's territory module with a doc-consistency test.

### Key Entities

- **Reckoning**: one run per ISO week: status (running / done / failed), stage, cursor, counts (cells, flips, parent flips, walks auto-finished, pushes queued), timings, error.
- **Cell state** (res 9): owner, owner-since week, captain, parents, polygon, last reckoned/activity week; **Faction strength**: per cell and faction, decayed accumulation; **Ownership event**: cell, week, from, to, cause; **Cell reckoning history**: per cell and week, owner, strengths, flipped, captain (last eight are shown).
- **Parent state** (res 8–5): owner, per-faction claimed-children counts, claimed children, polygon.
- **Weekly contribution** (003): per cell, week, faction, player: raw metres, capped metres, bonus metres — the reckoning's input, never written here.
- **Leaderboard snapshot**: week, scope (global / faction), rank, player (nullable after erasure), metres, points. **Faction weekly stats**: week, faction, hexes r9/r7, metres, active users, captures.
- **Result push (queued)**: player, week, flips, lost captaincies — a queue row for feature 008.
- **Consistency run**: time, parents checked, drifted, repaired, sample of drifts.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For all 10 cells × 3 weeks of `reckoning-weeks.json`, the reckoning's stored strengths (±0.01), owners, flip events and captains equal the fixture's expectations, and every parent of those cells equals `deriveParentOwner` over its children — proven by an integration test against Postgres.
- **SC-002**: Re-running a completed week changes zero rows; a run interrupted after any batch and resumed produces a state identical to an uninterrupted run (row-for-row comparison in a test).
- **SC-003**: A reckoning of 10 000 cells completes in under 5 minutes on a developer machine (timed test; target well under 60 s).
- **SC-004**: `GET /v1/hexes` answers a 3 000-cell box in under 300 ms p95 locally at every resolution, and refuses over-cap boxes with the documented error 100 % of the time.
- **SC-005**: Two GPX tracks replayed with `walk-sim` for different factions followed by `walk-sim reckon` produce owners on the list endpoint that match the dry-run's printed flips (roadmap phase-1 exit criterion).
- **SC-006**: The consistency job detects an injected parent drift in one nightly run and repairs it only with the repair flag.
- **SC-007**: After erasure, no row of any 004 table references the player, and the 002 FK-coverage test passes; the export bundle validates with the new section.
- **SC-008**: The OpenAPI snapshot test is green and the snapshot contains the five new operations with `operationId`s `listHexes`, `getHex`, `getLatestReckoning`, `runReckoning`, `getReckoning`.

## Assumptions

- Feature 003 is merged (or its contract is final) before 004's API stream starts: `hex_week_contribution` rows with `meters`, `capped_meters`, `capture_bonus_m` are written by `finishWalk`; `walk.autofinish` exposes a callable finish sweep; `weekStanding` lives in `modules/walks/standing.ts` and can be refactored to the shared pressure helper.
- Feature 002's auth plugin (`request.user.role`), rate-limit plugin, purge and export registries, `registerJobs` and `@nature/api-schema` exist as merged code.
- `hex_week_contribution.capture_bonus_m` is 0 until feature 006; the formulas include it now so 006 needs no change here.
- Three factions with ids 1–3 as seeded by 001; faction ids in the fixture map to them.
- Local Postgres 16 + PostGIS without h3-pg; every H3 computation (parents, polygons, area estimates) happens in the API with `h3-js`.
- Push delivery, device registration and the player's local-morning scheduling are feature 008; 004 only queues.
- The Monday results sheet, map overlay and hex detail sheet are feature 005 and are out of scope here.
