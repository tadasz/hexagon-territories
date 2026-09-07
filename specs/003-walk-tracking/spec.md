# Feature Specification: Walk Tracking

**Feature Branch**: `003-walk-tracking`

**Created**: 2026-09-07

**Status**: Implemented (2026-09-07; owner/macOS follow-ups in `tasks.md` Phase 4)

**Input**: User description: "Walk sessions with background location, path recording, live per-hex metres estimate, offline outbox, authoritative finishWalk scoring, walk history, GPX replay tool"

Feature 003 of `docs/roadmap.md` (depends on 002). It turns a signed-in player with a faction into a walker: they start a walk, put the phone in a pocket, and the app records their path in the background while showing how many metres they have earned in the hexagon they are in. When they stop, the server recomputes everything from the raw samples, credits the metres to the player's faction for this week, awards XP, and shows a summary. Walks are recorded and finished with or without connectivity. Testers and the API test-suite replay recorded GPX tracks through the same pipeline so the scoring can be checked without leaving a desk. Nothing about who *owns* a hexagon changes here — that is the weekly reckoning (feature 004).

## Clarifications

### Session 2026-09-07

Non-interactive session: every ambiguity was resolved by the planner from `docs/architecture.md` §4/§5/§6, `docs/territory-rules.md`, `docs/mvp.md`, the constitution and the binding decisions handed over with the feature. Each decision is recorded here and reflected in the requirements below so that nothing lives only in a chat transcript. The five-question cap was deliberately exceeded for the same reason as in 002.

- Q: Where are metres scored? → A: Only when a walk is finished, on the server, from the raw samples the server stored itself (`docs/territory-rules.md` "Scoring at walk finish"). Uploading samples never scores anything; the app's live per-hex metres are an estimate, labelled provisional, and replaced by the server's answer at finish. No client-reported total is trusted.
- Q: Which week does a walk count for? → A: The ISO week (UTC) of the walk's **end** time, one global cutoff at Monday 00:00 UTC. A walk that starts Sunday 23:50 UTC and ends Monday 00:05 UTC counts entirely for the new week. The end time is the client-reported end, but never later than the moment the server receives the finish request and never earlier than the last accepted sample.
- Q: What happens to a walk the app never finishes (crash, phone lost, app deleted)? → A: The server finishes it automatically once it has been active for more than 12 hours, using the last accepted sample's time as the end time; it is scored like any other walk and marked as auto-finished. The app itself ends a walk after 6 hours of recording and pauses recording after 3 minutes without movement.
- Q: Can a player run two walks at once? → A: No. Starting a new walk while another is still active on the server ends the old one automatically (as "superseded", scored normally) when the new walk starts after the old walk's last sample; if the time ranges genuinely overlap the new walk is refused and the app must finish the old one first. The app never has two walks recording at once.
- Q: What does "flagged" mean for the player? → A: A walk that fails a walk-level plausibility check (implausible jump, median speed too high, longer than 30 km or 6 h, too few steps for the distance — `docs/territory-rules.md` "Walk acceptance") is stored with its path and per-hex metres so the player can see it, but it earns **no** faction metres and **no** XP and is excluded from the reckoning. The summary says so plainly. Clearing flags is an admin/8 feature; nothing in 003 un-flags a walk.
- Q: What is capped and where? → A: A player earns at most 2 000 walking metres per hexagon per week for their faction; the cap is applied on the server across all the player's walks that week. The finish summary shows both the raw metres of this walk in each hexagon and how many of them counted. XP is 1 per 100 m of accepted path, capped at 300 XP per player per UTC day (the equivalent of the 30 km walk limit); the cap is an abuse limit, not a territory rule.
- Q: What does the "week standing" in the finish summary show? → A: For every hexagon the walk touched: which faction currently leads this week (by last reckoning strength halved plus this week's capped metres and capture bonuses) and what share of this week's total the player's faction holds. It is a read model; it never changes ownership.
- Q: Who can see a walk's path? → A: Only the player who walked it. Walks are listed and opened only by their owner; another player's walk id answers "not found". Other players and the map see only aggregated metres per faction (feature 004/005). Raw samples are kept 30 days on the server, then removed; the simplified path and per-hex metres are kept with the walk.
- Q: Are samples sent when no walk is running? → A: Never. Location is read only during an explicitly started walk (When-In-Use authorisation with a visible background session, never "Always"); samples are uploaded in batches while the walk runs and drained from the local outbox afterwards. No analytics or crash-reporting SDK is added in this feature.
- Q: What is stored on the device, and for how long? → A: The walk, its raw samples (until the walk is finished and fully uploaded, then at most 7 days), the simplified path for the history list (kept), and an outbox of pending uploads (create, sample batches, finish) that survives app restarts and is drained in order with exponential back-off whenever connectivity returns.
- Q: What does a batch upload answer? → A: Which of the sent samples were stored and, provisionally, which passed or failed the shared sample filter (accuracy > 50 m, speed > 5 m/s, non-monotonic timestamp) with the reason. Re-sending a batch, or sending batches out of order, never creates duplicates and never changes the final score: the finish step re-runs the filter over everything.
- Q: How fast may a client upload? → A: At most 200 samples per batch, an average of 2 batches per minute per player (bursts of up to 30 batches allowed so an offline walk can drain quickly), and at most 8 640 samples per player per UTC day (one every 10 s for 24 h). Exceeding a limit answers "too many requests" with the wait time; the app backs off and retries.
- Q: How is the live per-hex estimate computed on the device? → A: With the same sample filter and the same path-to-hexagon geometry the server uses (mirrored rules package), applied incrementally to every newly accepted sample. It runs on the raw accepted path, whereas the server simplifies the path first, so small differences are expected; the HUD marks the number as an estimate.
- Q: What does the walk history show? → A: The player's own walks, newest first, in pages of 20 with a "load more" cursor: date, distance, duration, number of hexagons, XP, status (finished / flagged / auto-finished / pending upload) and a small drawing of the path. Opening a walk shows the full path and the per-hexagon metres from the server's summary.
- Q: What is the GPX replay tool for? → A: A command-line tool that replays a GPX or GeoJSON track against any API environment as a signed-in player, at real time or accelerated, with optional distortions (pace, GPS jitter, reported accuracy, a teleport jump, no pedometer steps) so testers can create walks without walking, and that can also print the expected per-hexagon metres of a track without contacting the API, which the API integration tests use as their oracle. It ships with 2–3 sample tracks around Kaunas generated by a checked-in script.
- Q: Does the map draw the live path in this feature? → A: No. This feature exposes an observable path model (points + per-hex estimates) that the map feature (005) draws; 003 draws only the small history-list preview and the HUD numbers.
- Q: How are erased accounts and data export affected? → A: This feature registers its tables with the 002 erasure job (walks, samples, per-hex metres, weekly contributions, XP ledger rows, anti-cheat flags) and adds a "walks" section to the 002 export bundle, so Constitution IV keeps holding.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Record a walk and watch metres accumulate (Priority: P1)

A player opens the Walk tab, taps Start, and puts the phone away. The app keeps recording in the background (the system shows the usual location indicator). Whenever the player looks at the screen they see the elapsed time, the distance so far, the hexagon they are in and how many metres they have earned in it, plus the count of hexagons visited. If they stand still for three minutes the walk pauses itself and resumes when they move again.

**Why this priority**: This is the core loop of "walk & conquer"; without recording there is nothing to score. It must work first and must work offline.

**Independent Test**: With a fake location source feeding the walk-path fixtures, start a walk, feed samples, and check that the recorded path matches the fixture's accepted samples and the per-hex estimate matches the fixture's per-hex metres within half a metre; feed a stationary period and check the walk pauses and resumes. On a device: walk a block and watch the HUD count.

**Acceptance Scenarios**:

1. **Given** a signed-in player with a faction and location permission granted, **When** they tap Start, **Then** a walk begins, background recording starts, and the HUD shows 0 m, 00:00, the current hexagon and "≈ 0 m in this hex (estimate)".
2. **Given** a recording walk, **When** a location sample with accuracy worse than 50 m or speed above 5 m/s arrives, **Then** it is dropped from the path and the HUD does not move.
3. **Given** a recording walk, **When** the player crosses into a neighbouring hexagon, **Then** the HUD switches to the new hexagon with its own running estimate and the hexagon count increases by one.
4. **Given** a recording walk, **When** the player does not move for 3 minutes, **Then** the walk shows "Paused" and stops adding time and distance; **When** they move again, **Then** it resumes automatically.
5. **Given** a recording walk, **When** 6 hours have elapsed, **Then** the walk ends by itself and the finish flow runs.
6. **Given** location permission denied or restricted, **When** the player taps Start, **Then** the app explains what is needed and offers to open Settings; no walk is created.
7. **Given** the app is killed by the system during a walk, **When** it is relaunched, **Then** the walk is recovered from local storage in a finished-pending state (no samples lost that were already recorded) and the player is offered to finish it.

---

### User Story 2 - Finish a walk and get the authoritative result (Priority: P1)

The player taps Stop. The app sends the remaining samples and the finish request; the server recomputes the path from everything it stored, splits it into hexagons, credits the metres to the player's faction for this week (capped), awards XP, and answers with a summary the app shows as a sheet: distance, duration, XP, and each hexagon with metres earned, metres that counted, and which faction leads it this week.

**Why this priority**: Constitution I — the server is the only scorer. Everything downstream (reckoning, leaderboards) consumes what this step writes.

**Independent Test**: Replay a sample GPX track through the sample-batch and finish endpoints and compare the stored per-hex metres and weekly contributions with the replay tool's oracle (exact to a few centimetres); re-send batches and send them out of order and check the result is identical; finish across the Monday 00:00 UTC boundary and check the new week id; replay a car-speed track and check the walk is flagged, has per-hex metres but no contributions and no XP; run the auto-finish job on a 13-hour-old active walk and check it is scored.

**Acceptance Scenarios**:

1. **Given** a recorded walk with connectivity, **When** the player taps Stop, **Then** within a few seconds a summary sheet shows distance, duration, XP, hexagons with metres and counted metres, and the week standing per hexagon; the values come from the server, not from the HUD.
2. **Given** the same samples delivered twice or in a different order, **When** the walk is finished, **Then** the per-hex metres, the weekly contribution and the XP are identical to a single in-order delivery.
3. **Given** a player who already has 1 800 counted metres in a hexagon this week, **When** a new walk earns 500 m there, **Then** the summary shows 500 m earned and 200 m counted, and the weekly contribution is 2 000 m.
4. **Given** a walk whose samples trigger a walk-level flag (teleport, speed, distance, no steps), **When** it is finished, **Then** the summary states the walk was flagged and earned nothing, its path and per-hex metres are still shown, and no contribution or XP is written.
5. **Given** a walk ending after Monday 00:00 UTC that started before it, **When** it is finished, **Then** all of its metres are credited to the new week.
6. **Given** a walk still active on the server 12 hours after it started, **When** the hourly auto-finish job runs, **Then** the walk is finished with the last accepted sample's time as end time, scored, and marked auto-finished; the app shows it as such in the history.
7. **Given** the finish request is delivered twice (retry), **When** the second one arrives, **Then** the same summary is returned and nothing is scored twice.
8. **Given** a player without a faction, **When** they try to start a walk, **Then** the request is refused and the app sends them to the faction pick.

---

### User Story 3 - Walk without connectivity (Priority: P2)

The player walks in a forest with no signal. The walk records normally; the HUD works; Stop shows a local, provisional summary and the walk is marked "pending upload". When the phone is back online the app uploads the walk (creation, sample batches, finish) in order and replaces the provisional summary with the server's.

**Why this priority**: Constitution VII — offline is a feature. Nature walks are exactly where coverage is poor.

**Independent Test**: With the API unreachable, start, record and finish a walk; check every step is in the local outbox in order; make the API reachable; check the outbox drains with back-off, the server has the walk with the same samples, and the local walk is updated with the server summary. Kill and relaunch the app mid-drain; the drain resumes without duplicates.

**Acceptance Scenarios**:

1. **Given** no connectivity, **When** the player starts a walk, **Then** recording starts immediately and the creation request is queued.
2. **Given** no connectivity, **When** the player stops the walk, **Then** a provisional summary (estimate) is shown, marked as pending upload, and the walk appears in the history as pending.
3. **Given** queued uploads and connectivity returns, **When** the app is in the foreground, in the background refresh window, or the walk is still running, **Then** the queue is drained in order and the history entry is updated with the server summary.
4. **Given** the server rejects a queued request permanently (for example the walk overlapped another), **When** the queue processes it, **Then** the walk is marked failed with the reason, the remaining items of that walk are dropped, and later walks continue to upload.
5. **Given** the server answers "too many requests", **When** the queue processes the next item, **Then** it waits the indicated time before retrying.

---

### User Story 4 - Review past walks (Priority: P2)

The player opens the history from the Walk tab and sees their walks newest first, each with date, distance, duration, hexagons, XP, status and a small path drawing, and can load older pages. Tapping a walk shows the full server summary with the path and per-hexagon metres.

**Why this priority**: Feedback keeps players walking (`docs/mvp.md`: walk history with paths is in the MVP), and it is the only place a player sees a flagged or auto-finished walk explained.

**Independent Test**: Create 45 walks for a player and 3 for another; list with a page size of 20: three pages, newest first, only the player's own; open one: full path and hexagons; request another player's walk id: not found.

**Acceptance Scenarios**:

1. **Given** a player with walks, **When** they open the history, **Then** walks are listed newest first with date, distance, duration, hexagon count, XP, status and a mini path, 20 per page with "load more".
2. **Given** a walk row, **When** tapped, **Then** the detail shows the full path and the per-hexagon metres and counted metres from the server (or the provisional estimate while pending upload).
3. **Given** another player's walk id, **When** requested, **Then** the answer is "not found".
4. **Given** a flagged or auto-finished walk, **When** listed, **Then** its status is shown with a one-line explanation.

---

### User Story 5 - Replay a recorded track as a walk (Priority: P3)

A tester or a test-suite replays a GPX/GeoJSON file against an API environment as a signed-in player, optionally at accelerated time and with distortions, and can print the expected per-hexagon metres without contacting the API.

**Why this priority**: Roadmap phase-1 exit criterion ("two simulated reckonings match expected owners from replayed GPX") and the API integration tests both need a repeatable way to produce walks; testers need walks without walking.

**Independent Test**: Run the tool in dry-run mode on the Ąžuolynas sample: it prints the accepted sample count, flags, distance and per-hexagon metres. Run it against a local API with a tester's token at 60× speed: the created walk's summary matches the dry-run output. Add `--teleport`: the walk is flagged.

**Acceptance Scenarios**:

1. **Given** a GPX file and a bearer token, **When** the tool replays it, **Then** the API receives a walk creation, sample batches of at most 200 in order at the chosen rate, and (unless disabled) a finish request, and the tool prints the server summary.
2. **Given** `--dry-run`, **When** run on a track, **Then** the tool prints, without any network access, the expected accepted samples, flags, distance and per-hexagon metres as JSON.
3. **Given** `--speed`, `--jitter`, `--accuracy`, `--teleport`, `--spoof-no-steps`, **When** used, **Then** the generated samples reflect the distortion and the dry-run output shows the resulting rejections or flags.
4. **Given** the checked-in generator script, **When** run, **Then** it reproduces the sample tracks byte-for-byte.

---

### Edge Cases

- The first samples of a walk are inaccurate (cold GPS): they are dropped by the accuracy filter; the walk starts counting from the first accepted sample, and the HUD shows "waiting for GPS" until then.
- A walk with fewer than two accepted samples is finished with 0 m, no hexagons, no XP, and is not flagged.
- Time jumps on the device (clock change mid-walk): samples with non-monotonic timestamps are dropped by the shared filter; the walk continues.
- The player revokes location permission mid-walk: recording stops, the walk is finished with what was recorded, and the player is told why.
- The device runs out of storage or the local database fails: the walk keeps running in memory and the player is warned that it may not be saved.
- The finish request reaches the server but the response is lost: the retry returns the same summary (idempotent finish).
- The auto-finish job and a late client finish race: whichever runs first scores; the other returns the stored summary.
- A sample batch for a walk that is already finished: refused; the app drops the remaining items of that walk and refreshes the walk from the server.
- The server receives a walk creation whose `startedAt` is in the future or more than 12 hours in the past: `startedAt` is clamped to the server's clock window and the walk still starts (the app's clock may be wrong).
- A player's faction changes between start and finish: the contribution goes to the faction the player has at finish time (the faction stored on the walk at creation is updated at finish).
- The pedometer is unavailable (no motion permission, simulator): no step count is sent, and the "no steps" flag is not evaluated.
- Rate limit hit while draining an offline walk: the queue waits and resumes; nothing is lost.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A signed-in player with a faction MUST be able to start a walk from the foreground; the app MUST record location in the background only for the duration of that walk under When-In-Use authorisation with a visible background session, and MUST stop recording when the walk ends. Starting a walk without a faction MUST be refused.
- **FR-002**: The app MUST apply the shared sample filter (accuracy > 50 m dropped, speed > 5 m/s dropped, non-monotonic timestamp dropped) to every incoming location fix, keep roughly one sample per 5 s or per 10 m moved, assign each kept sample an increasing sequence number, and store it locally before anything else happens to it.
- **FR-003**: The app MUST show, while recording, the elapsed (moving) time, the distance of the accepted path, the current res-9 hexagon, an estimated metre count for that hexagon labelled as an estimate, and the number of hexagons touched; the estimate MUST be computed with the mirrored rules package (same sample filter, same path-to-hexagon geometry) incrementally per accepted sample.
- **FR-004**: The app MUST pause a walk automatically after 3 minutes without movement and resume on movement, MUST end a walk automatically after 6 hours, and MUST recover an interrupted walk from local storage on relaunch.
- **FR-005**: The app MUST expose an observable live path model (accepted points and per-hexagon estimates) for the map feature to draw; this feature draws only the HUD and the small history preview.
- **FR-006**: The app MUST queue every server interaction of a walk (create, sample batches of at most 200 every ~60 s while recording, finish) in a durable local outbox, drain it in order with exponential back-off when connectivity is available (foreground, background refresh, during the walk), treat "too many requests" by waiting the indicated time, and mark a walk failed when the server refuses it permanently, dropping that walk's remaining items only.
- **FR-007**: The server MUST create a walk for `(player, clientWalkId)` exactly once (repeating the creation returns the same walk), MUST refuse a creation whose time range overlaps the player's active walk, and MUST auto-finish ("superseded") an active walk whose last sample precedes the new walk's start.
- **FR-008**: The server MUST accept sample batches of at most 200 samples for an active walk owned by the caller, store them idempotently by `(walk, seq)` (re-delivery and reordering never duplicate), answer which samples were stored and which provisionally pass or fail the shared filter with the reason, and MUST NOT score anything at this step.
- **FR-009**: The server MUST finish a walk in one transaction that is the only place walking metres are scored: re-run the shared filter over all stored samples in sequence order, compute flags, simplify the accepted path (5 m), compute metres per res-9 hexagon, store the path, the simplified path and per-hexagon metres; set the week to the ISO week (UTC) of the end time; if unflagged, upsert the player's weekly contribution per hexagon with the 2 000 m cap and award 1 XP per 100 m (capped at 300 XP per UTC day); if flagged, mark the walk flagged, record each flag, and write no contribution and no XP. Repeating the finish request MUST return the stored summary without re-scoring. Ownership MUST NOT change here.
- **FR-010**: The end time used for scoring MUST be the client-reported end clamped to the interval [last accepted sample time, server receive time].
- **FR-011**: The finish summary MUST contain distance, duration, XP awarded, flags, week id, the simplified path, and for every hexagon: raw metres of this walk, metres that counted toward this week's cap, this week's leading faction (last reckoning strength × 0.5 + this week's capped metres + capture bonuses) and the player's faction's share of this week's total.
- **FR-012**: The server MUST auto-finish walks active for more than 12 hours (hourly job), using the last accepted sample time (or the start time when there are none) as end time and marking the walk auto-finished; the job MUST be idempotent and safe to run concurrently with a client finish.
- **FR-013**: The server MUST list a player's own walks newest first with cursor pagination (page size 20) and return a single walk with its path only to its owner; any other walk id MUST answer "not found".
- **FR-014**: The server MUST enforce per-player ingest limits: 200 samples per batch, 30 batches per 15 minutes (2 per minute average), 8 640 stored samples per UTC day; violations MUST answer with the shared error envelope and the wait time.
- **FR-015**: Raw samples MUST be deleted from the server after 30 days (daily job dropping whole partitions and creating the next month's); simplified paths and per-hexagon metres are kept with the walk. The app MUST delete raw samples of an uploaded walk after at most 7 days and keep the simplified path.
- **FR-016**: Walks, samples, per-hexagon metres, weekly contributions, XP ledger rows and anti-cheat flags of a player MUST be registered with the 002 account-erasure job (the FK-coverage test MUST pass) and a "walks" section MUST be added to the 002 export bundle.
- **FR-017**: All new endpoints MUST be described in the generated OpenAPI document and snapshotted into the shared schema package (staleness test), and the iOS client for them MUST be generated from the snapshot.
- **FR-018**: A command-line replay tool MUST replay GPX or GeoJSON tracks as timed sample batches against a base URL with a bearer token, support pace, jitter, reported accuracy, teleport, no-steps, finish on/off and rate options, and MUST offer a dry-run that prints the expected accepted samples, flags, distance and per-hexagon metres computed with the shared rules package and no network; it MUST ship with 2–3 sample tracks around Kaunas produced by a checked-in deterministic script.
- **FR-019**: API integration tests MUST replay the sample tracks through the batch and finish endpoints and assert stored per-hexagon metres and weekly contributions against the replay tool's oracle; they MUST cover re-delivery and reordering, the week boundary, a flagged walk, the cap, idempotent finish and auto-finish.
- **FR-020**: iOS logic that must be unit-tested (tracker state machine, path recorder, estimator, auto-pause, outbox and sync coordinator, local persistence) MUST live in packages that build and test on Linux without UIKit, SwiftUI or CoreLocation.
- **FR-021**: The app's background-mode and usage-description entries (location background mode, location when-in-use and motion usage descriptions) MUST be declared; audio background mode is not added in this feature.

### Key Entities

- **Walk (session)**: one recording by one player; has client id, start/end/finish times, status (active, finished, flagged, abandoned), finish reason (client, auto-finish, superseded), week id, distance, duration, steps, raw and simplified path, sample and hexagon counts, flags, XP awarded, device info. Existing table from 001, extended.
- **Location sample**: one accepted-or-rejected GPS fix of a walk: sequence, time, position, accuracy, speed, course, altitude, accepted flag and reject reason. Existing partitioned table from 001, 30-day retention.
- **Walk hex metres**: raw metres of one walk inside one res-9 hexagon. Existing table from 001.
- **Hex week contribution**: a player's metres (raw and capped) for their faction in one hexagon in one week; the reckoning's input. Existing table from 001; first writer is this feature.
- **XP ledger entry**: points awarded for a walk (`walk_distance`). Existing table from 001; first writer is this feature.
- **Anti-cheat flag**: one flag on one walk with details. Existing table from 001; first writer is this feature.
- **Local walk, local sample, local path, outbox item**: the device-side mirrors and the durable upload queue. New (device only).
- **Replay track**: a GPX/GeoJSON file plus distortion options that the replay tool turns into a sample stream; not stored on the server.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every sample track, the server's per-hexagon metres and weekly contributions equal the replay tool's oracle within 0.05 m per hexagon, and are byte-identical between an in-order delivery, a re-delivered batch and a reversed batch order.
- **SC-002**: The device estimate for every walk-path fixture is within 0.5 m per hexagon of the mirrored rules package's batch computation over the same accepted samples, and the device filter accepts and rejects exactly the fixture's sequence numbers.
- **SC-003**: A walk finished with connectivity shows the server summary within 5 s of tapping Stop on a track of 1 hour (720 samples); a finished offline walk is fully uploaded within 2 minutes of connectivity returning (3 sample batches + finish, no rate-limit hits).
- **SC-004**: An interrupted upload (app killed mid-drain, server down for 10 minutes) completes without any duplicate sample, walk or contribution; 100 % of outbox items are delivered exactly once.
- **SC-005**: A walk active for more than 12 h is finished by the next hourly job run; a walk-level flag on any sample track (teleport, car speed, no steps) results in zero contribution and zero XP in 100 % of cases.
- **SC-006**: Battery use during a 1-hour walk on an iPhone 13 is under 6 % (measured with the Energy Log on a device; recorded in the verification log, not a CI gate).
- **SC-007**: Walk history lists only the owner's walks in 100 % of cases; a foreign walk id answers "not found".
- **SC-008**: The OpenAPI snapshot test fails when any walk endpoint changes without regenerating the snapshot; the iOS client compiles from the snapshot without hand-written request code.

## Assumptions

- Feature 002 is merged before this feature's iOS stream starts: the `Core` and `APIClient` packages, `AuthSession`, the `auth` plugin with `request.user`, the error envelope codes, the purge and export registries and the `@nature/api-schema` snapshot exist as specified in `specs/002-auth-and-factions/`. The API stream can start against 002's contract and merge after it.
- The territory rules used here (`acceptSamples`, `walkFlags`, `simplifyPath`, `pathToHexMeters`, `applyWeeklyCap`, `weekIdFor`, constants) exist in both `@nature/territory-rules` and the Swift `TerritoryRules` package and pass the shared fixtures; no rule changes are needed for this feature.
- Capture bonuses (feature 006) are zero for now; the week-standing formula already includes them so nothing changes later.
- The reckoning (feature 004) will read `hex_week_contribution` as written here; the shape is the 001 schema and is not changed.
- Push notifications, App Attest, analytics and the admin flag-clearing UI are later features (008/009).
- The map draws the live path in feature 005 from the observable model this feature provides.
- No Docker and no macOS in the agent environment: API integration tests run against the local Postgres via `DATABASE_URL`; SwiftUI/CoreLocation code is reviewed by file list and verified on macOS/Xcode Cloud, as in 001 and 002.
