# Location

Walk recording for feature `003-walk-tracking` (`docs/architecture.md` §4 "Walk tracking and path recording",
`specs/003-walk-tracking/research.md` R16). Everything the spec asks to unit-test lives in Foundation-only code that
`swift test` runs on Linux (FR-020); the two Apple-framework files are compiled only where they can be.

| File | Runs on Linux | Role |
|---|---|---|
| `LocationFix`, `LocationSource`, `PedometerSource`, `LocationPermission`, `WalkStore` | yes | value types and the protocols the app target and `Persistence` implement |
| `PathRecorder` | yes | 5 s / 10 m throttle, incremental `acceptSamples` (shared filter), `seq` numbering |
| `HexMetersEstimator` | yes | per-accepted-sample `pathToHexMeters([prev, cur])` summed per res-9 cell (the estimate) |
| `AutoPauseDetector` | yes | paused after 180 s without a ≥ 10 m move, resumed on the first one, moving time |
| `WalkTracker` (actor) | yes | the state machine: `start` / `ingest` / `tick` / `stop` / `recover`, 6 h auto-end |
| `LivePath`, `HUDState`, `ProvisionalSummary` | yes | the observable model (feature 005 draws it) and HUD values |
| `Platform/CoreLocationSource` | **device / simulator only** | `CLLocationUpdate.liveUpdates(.fitness)` + `CLBackgroundActivitySession`; `CoreLocationPermission` (When-In-Use only) |
| `Platform/PedometerBridge` | **device only** | `CMPedometer.queryPedometerData` (nil in the simulator or without motion permission) |

## `LivePath` contract for feature 005

`LivePath` is an `@Observable @MainActor` object owned by `AppContainer` and written only by `WalkTracker`:

- `points: [LatLng]` — accepted samples in path order (raw, not simplified);
- `hexEstimates: [HexMeters]` — estimated metres per res-9 cell, sorted by cell;
- `currentCell`, `currentCellMeters`, `distanceM`, `movingSeconds`, `hexCount`, `isPaused`, `isRecording`, `waitingForGPS`.

The map layer observes it and redraws the polyline; every number is an estimate until the server's `WalkSummary`
replaces it (Constitution I). Nothing here scores anything.

## Semantics fixed by plan.md "Shared Semantics"

- A fix is kept when ≥ 5 s passed since the last kept fix **or** it moved ≥ 10 m; kept fixes are numbered `seq` 0, 1, 2 …
  whether the filter accepts or rejects them; throttled fixes consume no `seq` and are never stored.
- The filter is `TerritoryRules.acceptSamples` applied to `[lastAccepted, candidate]` — the same verdict the server
  reaches over the full list.
- Auto-pause: 180 s without an accepted sample ≥ 10 m from the last anchor; resumed by the first such sample; moving
  time counts up to the moment the pause is detected and resumes on the resume sample.
- Auto-end: 6 h of wall time since `start` → finish with `endedAt = now` (`WalkFinishInput.Reason.autoEnd`).
- Recovery: `recover()` finishes a walk the store still holds as recording with `endedAt` = its last kept sample.
