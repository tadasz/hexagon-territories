# Feature Specification: Auth and Factions

**Feature Branch**: `002-auth-and-factions`

**Created**: 2026-09-07

**Status**: Implemented on Linux (API, Swift packages, docs, CI) — macOS, Docker and owner follow-ups open in `tasks.md` Phase 4 (T032–T035); becomes `Implemented` when they close

**Input**: User description: "Sign in with Apple, JWT sessions, faction pick with smallest-faction suggestion, profile, account deletion and export"

Feature 002 of `docs/roadmap.md` (depends on 001). It gives Nature Explorer its first real players: a person signs in with their Apple ID, is recognised on every later launch, picks one of the three factions (Owls 🦉, Foxes 🦊, Deer 🦌) with the smallest faction suggested, manages a short profile, and can delete their account or take their data with them. Everything later in the roadmap (walks, reckoning, captures) hangs off the account and faction created here.

## Clarifications

### Session 2026-09-07

Non-interactive session: every ambiguity was resolved by the planner from `docs/architecture.md`, `docs/territory-rules.md`, `docs/mvp.md`, the constitution and the product decisions handed over with the feature, and is recorded here so the spec is self-contained. The usual five-question cap was deliberately exceeded so that no decision lives only in a chat transcript.

- Q: Which sign-in methods exist? → A: Sign in with Apple only. No email/password, no other identity providers. Apple's identity token is verified on the server; the account is keyed by Apple's stable user identifier.
- Q: What personal data is stored from Apple, and when? → A: The Apple user identifier always; the e-mail address (possibly Apple's private relay address) and the name only as delivered with the **first** sign-in. Later sign-ins never overwrite them. E-mail addresses are never written to logs.
- Q: What is the player's display name before they choose one? → A: Apple's given name if Apple supplied one and it fits the 2–24 character rule; otherwise "Explorer" followed by four random digits (e.g. "Explorer 4821"). Display names need not be unique.
- Q: How long does a session last and how is it kept alive? → A: A short-lived access credential (15 minutes) and a long-lived refresh credential (60 days) that is rotated on every use; a returning player is not asked to sign in again for 60 days of inactivity. Presenting an already-rotated refresh credential is treated as theft: every session of that player is revoked and they must sign in again.
- Q: Is the faction list visible before signing in? → A: Yes. `GET /v1/factions` needs no session (it carries only aggregate numbers), so onboarding screens can show it; every `/v1/me*` endpoint needs a session.
- Q: What does "fewest active players" mean? → A: Players whose account is not deleted, who have a faction, and who used the app in the last **14 days**. The suggested faction is the one with the fewest such players; a tie goes to the lowest faction id (Owls before Foxes before Deer). With nobody active yet, Owls is suggested. The suggestion is only a pre-selection; the player may pick any faction.
- Q: Does the first faction pick start the 30-day lock? → A: No. The first pick is free and does not start the clock. The first *change* starts the 30-day lock; each further change needs 30 days since the previous change. Re-selecting the current faction is a no-op and does not consume anything. XP is kept on a change; past hex contributions stay with the old faction (`docs/territory-rules.md` "Other rules").
- Q: Which faction statistics are shown? → A: Per faction: total members, active members (14-day window), hexes owned at resolution 9 and at resolution 7. All values may be zero in an empty world; the screen must look right with zeros.
- Q: What does the profile show and what can be edited? → A: Shows display name, faction (with emoji and colour), XP and level, "member since" date and a sign-out action. Only the display name is editable (2–24 characters after trimming, no line breaks or control characters; profanity filtering is out of scope). The e-mail address is not shown in the app; it appears only in the data export.
- Q: What happens on account deletion? → A: The account is marked deleted immediately: every session is revoked, the player is signed out everywhere, and the player is told the account will be erased in 30 days. A background job erases the account and every row keyed to it 30 days later. Signing in with the same Apple ID inside those 30 days restores the account unchanged (the pending erasure is skipped). After erasure the same Apple ID creates a brand-new account.
- Q: How does data export work? → A: The player asks for an export; the system builds a single JSON bundle in the background and, when it is ready, gives the player a time-limited download link (valid for one hour per request; the bundle itself is kept for 7 days, after which a new request builds a fresh one). Asking again while a build is pending or a fresh bundle exists returns the existing one instead of starting another. The bundle contains everything stored about the player that this feature introduces (account, profile, faction choice, sessions metadata) and is extended by later features with their own sections.
- Q: Is the game "gated" behind a faction pick? → A: Yes. After signing in, a player without a faction sees only the faction pick screen; the six tabs (Map · Walk · Capture · Collection · Factions · Profile) appear once a faction is chosen. The server accepts a session without a faction only for the endpoints of this feature.
- Q: Are Apple-side session tokens revoked when the account is deleted? → A: Not in this feature. Apple asks apps that offer account deletion to also revoke the Sign in with Apple tokens; that needs Apple developer credentials the owner has not created yet and is scheduled with the App Store submission work (feature 009). The sign-in request already carries the field Apple's revocation flow will need so no client change is required later.
- Q: How is abuse of the sign-in endpoints limited? → A: Per-client-address throttling on every authentication endpoint (20 requests per minute); throttled calls get a "try again later" answer with the wait time. Other endpoints are not throttled in this feature.
- Q: Does analytics tracking start here? → A: No. No analytics or crash-reporting SDK is added in this feature (PostHog arrives with 003/008).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sign in with Apple and stay signed in (Priority: P1)

A new player taps "Sign in with Apple", approves the Apple prompt, and lands in the app with an account. From then on the app opens straight into the game on every launch; the player is never asked to sign in again unless they sign out, delete the account, or have not used the app for 60 days.

**Why this priority**: Nothing else in the product exists without an identity. Sign in with Apple is also an App Store requirement for an app whose only login is a third-party identity.

**Independent Test**: With the API and a stubbed Apple identity, sign in twice with the same Apple identity and once with a new one: the first creates an account, the second returns the same account, the third creates a different one. Close and reopen the app: the player is still signed in. Wait past the access credential's lifetime and make a request: it succeeds without any prompt.

**Acceptance Scenarios**:

1. **Given** a person who has never used the app, **When** they complete Sign in with Apple, **Then** an account is created with their Apple identifier, the name and e-mail Apple supplied (if any), a default display name, and the app shows the faction pick screen.
2. **Given** a person with an existing account, **When** they sign in with the same Apple ID (even if Apple no longer supplies name or e-mail), **Then** they get the same account with the display name, faction and XP they had.
3. **Given** a signed-in player whose short-lived credential has expired, **When** the app makes any request, **Then** the request succeeds without the player noticing (the session is renewed silently).
4. **Given** a refresh credential that has already been used once, **When** it is presented again, **Then** every session of that player is revoked and the app returns to the sign-in screen.
5. **Given** a signed-in player, **When** they tap "Sign out", **Then** the app returns to the sign-in screen and the stored credentials are removed from the device; the same refresh credential cannot be used afterwards.
6. **Given** an identity token that is expired, forged, or issued for another app, **When** it is presented, **Then** sign-in is refused with a clear error and no account is created or changed.

---

### User Story 2 - Pick a faction with the smallest faction suggested (Priority: P1)

Right after the first sign-in the player sees the three factions with their live numbers (members, active members, hexes held at two zoom levels). The faction with the fewest active players is pre-selected and labelled as the suggestion. The player confirms it or picks another and is taken into the game.

**Why this priority**: Every walk and capture is credited to a faction; the MVP balances the game only by nudging new players towards the smallest faction (`docs/territory-rules.md` "Balance").

**Independent Test**: Seed three factions with different active-player counts; open the pick screen: the smallest faction is pre-selected and labelled. Confirm it: the player's faction is stored and the app shows the tabs. Repeat with two factions tied: the lower id is suggested. Repeat with an empty world: Owls is suggested and all numbers read zero.

**Acceptance Scenarios**:

1. **Given** a signed-in player without a faction, **When** the pick screen opens, **Then** all three factions are listed with emoji, colour, members, active members and hexes held (res 9 and res 7), and exactly one is marked "suggested" and pre-selected.
2. **Given** Foxes have 10 active players, Owls 12 and Deer 3, **When** the suggestion is computed, **Then** Deer is suggested.
3. **Given** Owls and Deer both have the fewest active players, **When** the suggestion is computed, **Then** Owls (the lower id) is suggested.
4. **Given** the player picks a faction, **When** they confirm, **Then** the choice is saved, the pick screen is replaced by the six tabs, and the profile shows the chosen faction.
5. **Given** a player who already has a faction, **When** the app launches, **Then** the pick screen is not shown.
6. **Given** nobody has been active for 14 days, **When** the suggestion is computed, **Then** Owls is suggested and the numbers shown are zero.

---

### User Story 3 - See and edit my profile (Priority: P2)

A player opens the Profile tab, sees their display name, faction, XP and level and when they joined, and can change the display name.

**Why this priority**: Players need to recognise themselves and each other (leaderboards and captains come later); the profile is also where sign-out, deletion and export live.

**Independent Test**: Open the profile of a fresh account: default display name, chosen faction, 0 XP, level 1, today's date. Change the name to "Ąžuolas" and reopen the app: the new name persists. Try "A" and a 25-character name: both are refused with an inline message.

**Acceptance Scenarios**:

1. **Given** a signed-in player, **When** they open Profile, **Then** they see display name, faction emoji and name, XP, level, member-since date, and the actions Edit name, Sign out, Export my data, Delete account.
2. **Given** the edit-name form, **When** the player enters 2–24 characters (after trimming), **Then** the name is saved and shown everywhere the player is named.
3. **Given** the edit-name form, **When** the player enters fewer than 2 or more than 24 characters, or a name containing a line break, **Then** the save is refused with a message naming the rule and nothing changes.
4. **Given** a name with surrounding spaces, **When** it is saved, **Then** it is stored trimmed.

---

### User Story 4 - Change faction, once every 30 days (Priority: P2)

A player who regrets their choice can switch faction from the Factions tab. The first change is immediate; afterwards the screen tells them when the next change is possible.

**Why this priority**: Prevents lock-in mistakes while stopping faction-hopping that would break the weekly reckoning (`docs/territory-rules.md`: once per 30 days, XP kept, past contributions stay).

**Independent Test**: Change faction once: succeeds, XP unchanged. Change again the same day: refused with the date when it becomes possible; the Factions tab shows the same date. Move the clock 30 days ahead: the change succeeds.

**Acceptance Scenarios**:

1. **Given** a player who has never changed faction, **When** they pick a different faction, **Then** the change is applied immediately and their XP and level are unchanged.
2. **Given** a player who changed faction 10 days ago, **When** they try to change again, **Then** the change is refused and the message states the exact date and time when the next change is allowed (20 days from now).
3. **Given** a player who changed faction 30 or more days ago, **When** they change again, **Then** it succeeds.
4. **Given** the Factions tab, **When** the player is locked, **Then** the faction cards are shown with the lock notice and the confirm action is disabled; the live numbers and the suggestion are still visible.
5. **Given** the player re-selects their current faction, **When** they confirm, **Then** nothing changes and no lock is started.

---

### User Story 5 - Delete my account (Priority: P2)

A player can delete their account from the Profile tab. They are warned that the account and all its data will be erased after 30 days, are signed out everywhere immediately, and can change their mind by signing in again within 30 days.

**Why this priority**: Required by the App Store for any app with account creation and by Constitution IV ("Account deletion and data export MUST keep working in every release"); the mechanism must exist before any player data accumulates.

**Independent Test**: Delete an account: the app signs out, the old credentials no longer work. Sign in again with the same Apple ID the next day: the account is back with its faction and name. Delete again and run the erasure job with the clock moved 30 days ahead: the account and every row that referenced it are gone, and a fresh sign-in creates a new account.

**Acceptance Scenarios**:

1. **Given** the Profile tab, **When** the player chooses Delete account, **Then** they must confirm in a second step that explains the 30-day grace period and that walks, captures and faction history will be erased.
2. **Given** the player confirms, **When** the request completes, **Then** the account is marked for erasure, every session is revoked, the device forgets its credentials and shows the sign-in screen.
3. **Given** an account marked for erasure, **When** the same Apple ID signs in within 30 days, **Then** the account is restored with its data and the pending erasure is cancelled.
4. **Given** an account marked for erasure 30 days ago, **When** the erasure job runs, **Then** the account row and every row belonging to the player are deleted (or, where the game's aggregate record requires it, anonymised) and the job reports what it removed.
5. **Given** an account that was erased, **When** the same Apple ID signs in, **Then** a brand-new account is created.
6. **Given** the erasure job runs for an account that was restored in the meantime, **When** it checks the account, **Then** it does nothing.

---

### User Story 6 - Export my data (Priority: P3)

A player can ask for a copy of everything the game stores about them and download it as a single file.

**Why this priority**: GDPR right of access and Constitution IV; low daily use but must exist before public TestFlight.

**Independent Test**: Request an export: the app shows "preparing". Within a few minutes the app shows a download button; the downloaded file is a JSON document containing the account details. Request again immediately: the same bundle is returned. Request after the bundle expired: a new one is built.

**Acceptance Scenarios**:

1. **Given** a signed-in player, **When** they tap Export my data, **Then** the app shows the export as pending and, when it is ready, a download action.
2. **Given** a ready export, **When** the player downloads it, **Then** they receive a JSON file with the account identifier, Apple user identifier, e-mail (if stored), display name, faction and when it was chosen, XP, level, join date, last-seen date, and the export's own timestamp and format version.
3. **Given** a pending or fresh (less than 7 days old) export, **When** the player asks again, **Then** no second bundle is built and the same status/download is returned.
4. **Given** a download link older than one hour, **When** it is opened, **Then** it no longer works; reopening the export screen provides a fresh link for the same bundle.
5. **Given** a bundle older than 7 days, **When** the player asks for an export, **Then** a new bundle is built.
6. **Given** the export build fails, **When** the player reopens the screen, **Then** the failure is shown and a retry builds a new bundle.

---

### Edge Cases

- Apple's key service is unreachable: sign-in fails with a "try again later" answer (no account change); the app shows a retry. Keys are cached so a brief outage does not affect sign-in.
- Apple supplies no e-mail (user hid it) or no name: the account is created with only the identifier and a generated display name.
- Two refresh requests race with the same credential (app restarted mid-refresh): the first wins and the second is treated as reuse — the client must retry the whole sign-in; the app handles this by returning to the sign-in screen, not by crashing.
- A request arrives with a valid access credential for an account marked for erasure: it is refused as unauthenticated; the app signs out.
- The player picks an unknown faction id: refused; nothing changes.
- Display name consisting only of whitespace: refused (length after trimming is 0).
- The export bundle cannot be written to storage: the export is marked failed, the player can retry.
- The erasure job runs twice for the same account (retry after crash): the second run finds nothing and succeeds.
- A player signs in on a second device: both devices hold independent refresh credentials; signing out on one does not affect the other; deleting the account revokes both.
- Rate limit hit on sign-in (20 requests per minute from one client address): the answer says how long to wait; the app shows it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST let a person create or resume an account with Sign in with Apple only, verifying Apple's identity token on the server (signature against Apple's published keys, issuer, audience = the app's bundle identifier(s), expiry) before creating or looking up the account by Apple's stable user identifier.
- **FR-002**: On first sign-in the system MUST store the Apple identifier, the e-mail and name if supplied, a default display name (Apple given name if it satisfies FR-009, else "Explorer NNNN"), the join timestamp; later sign-ins MUST NOT overwrite e-mail or name.
- **FR-003**: The system MUST issue a 15-minute access credential and a 60-day refresh credential; refresh MUST rotate the credential (old one invalid after use); reuse of a rotated refresh credential MUST revoke every refresh credential of the account; sign-out MUST revoke the presented refresh credential. Refresh credentials MUST be stored only as one-way hashes.
- **FR-004**: The app MUST keep credentials in the device keychain, restore the session at launch, renew the access credential silently when it expires or a request is refused as unauthenticated, and return to the sign-in screen when renewal fails.
- **FR-005**: Every authentication endpoint MUST be throttled per client address (20 requests per minute); throttled requests MUST receive the shared error envelope with a machine-readable code and the wait time.
- **FR-006**: The system MUST expose the three factions (id, slug, name, emoji, colours, sort order) with live statistics — members, active members (used within 14 days, not deleted, has a faction), hexes owned at resolution 9 and resolution 7 — without requiring a session, plus the suggested faction id (fewest active members; tie → lowest id).
- **FR-007**: A signed-in player MUST be able to set their faction; the first pick is free and starts no lock; each later change requires at least 30 days since the previous change, otherwise the request is refused with the timestamp when a change becomes possible; re-selecting the current faction is a no-op; XP and level are never altered by a faction change.
- **FR-008**: The app MUST show the faction pick screen after sign-in until a faction is set, with the suggested faction pre-selected and visibly labelled, and MUST show the six tabs Map · Walk · Capture · Collection · Factions · Profile once a faction is set.
- **FR-009**: The player MUST be able to read their profile (id, display name, faction, faction-changed timestamp, next-change-allowed timestamp, XP, level, role, join date, suggested faction id) and update the display name; a display name MUST be 2–24 characters after trimming, contain no line breaks or control characters, and is stored trimmed. E-mail is not returned by the profile.
- **FR-010**: The player MUST be able to delete their account: the account is marked deleted at once, all refresh credentials are revoked, subsequent requests with old credentials are refused, and a background erasure runs 30 days later removing the account and every row keyed to it (later features register their own tables with the erasure so that Constitution IV holds in every release; a test MUST fail when a table referencing players is not covered).
- **FR-011**: Signing in with an Apple ID whose account is marked deleted but not yet erased MUST restore the account and cancel the erasure; after erasure the same Apple ID gets a new account.
- **FR-012**: The player MUST be able to request a data export; the system builds a JSON bundle in the background, stores it in object storage, keeps it for 7 days, and hands out time-limited (1 hour) download links; repeated requests while pending or fresh return the existing export; failures are reported and retryable; later features add their own sections to the bundle.
- **FR-013**: Every `/v1/me*` endpoint MUST require a valid access credential; requests for deleted accounts MUST be refused; the server MUST record the player's last-seen time (at most once per 15 minutes per player) so the active-member counts stay current.
- **FR-014**: All new endpoints MUST be described in the API's generated OpenAPI document, which MUST be snapshotted into a shared schema package with a test that fails when the snapshot is stale; the iOS client for these endpoints MUST be generated from that snapshot, never hand-written (constitution "Development Workflow").
- **FR-015**: Logs MUST never contain e-mail addresses, identity tokens, access or refresh credentials.
- **FR-016**: Pure iOS logic introduced by this feature (session state machine, credential refresh, display-name validation, faction suggestion/lock presentation) MUST live in packages that build and test on Linux without UIKit or SwiftUI.

### Key Entities

- **Player (user)**: an account keyed by the Apple user identifier; has display name, optional e-mail and name from first sign-in, faction (optional until picked), faction-changed timestamp, XP, level, role, join, last-seen and deleted-at timestamps. Existing table from 001.
- **Faction**: one of the three seeded teams (id, slug, name, emoji, light/dark colour, sort). Existing table from 001. Statistics are derived, not stored, from players and hex ownership.
- **Session credentials**: an access credential (short-lived, self-contained) and a refresh credential (long-lived, stored hashed with expiry, revocation timestamp and the owning player). Existing `refresh_tokens` table from 001.
- **Account export**: a request by a player to bundle their data; has status (pending, ready, failed), request/ready/expiry timestamps, storage location, error. New.
- **Scheduled erasure**: the pending 30-day job for a deleted account; not a table — derived from the player's deleted-at timestamp and enforced by the job's own check.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new player gets from tapping "Sign in with Apple" to seeing the game tabs (including the faction pick) in under 2 minutes with at most three taps after Apple's prompt.
- **SC-002**: A returning player who used the app within the last 60 days reaches the game without any sign-in prompt in 100 % of launches with connectivity; silent renewal adds no visible delay beyond the request itself.
- **SC-003**: The suggested faction equals the faction with the fewest active players (tie → lowest id) in 100 % of computed cases across the seeded test scenarios (distinct counts, ties, empty world).
- **SC-004**: 100 % of forged, expired, wrong-audience identity tokens and reused refresh credentials are refused; a reused refresh credential leaves zero valid sessions for that player.
- **SC-005**: An account deleted 30 days ago has zero rows left in any table that references players after the erasure job runs; the job is idempotent (second run removes nothing and succeeds).
- **SC-006**: A data export is downloadable within 5 minutes of the request in local and CI environments; the bundle validates as JSON and contains every field listed in User Story 6.
- **SC-007**: The OpenAPI snapshot test fails when any endpoint of this feature changes without the snapshot being regenerated; the iOS client compiles from the snapshot without hand-written request code.
- **SC-008**: The Linux-testable iOS package for this feature passes `swift test` on the Swift 6 toolchain with no UIKit/SwiftUI imports; its session state machine tests cover renewal success, renewal failure, concurrent renewals and restore-from-keychain.

## Assumptions

- The three factions from feature 001's seed (Owls/Foxes/Deer, ids 1–3) are the only factions; names, emoji and colours come from the server, the app keeps only fallback colours.
- The app's bundle identifier is still the placeholder `com.natureexplorer.app` (`TODO(owner)`); the server's accepted audience list is configuration and must be updated when the owner names the brand and enables the Sign in with Apple capability on the App ID.
- Sign in with Apple works in the iOS Simulator with a signed-in Apple ID; server-side tests use a stubbed Apple key set, never Apple's live service.
- Apple's token revocation on deletion is deferred to feature 009 (see Clarifications); the sign-in request already accepts Apple's authorization code so the client will not change.
- Hex ownership counts come from the territory tables of 001 (`hex_state`, `hex_parent_state`), which are empty until feature 004 writes them; the statistics read zero until then.
- Push notification device registration (`POST /v1/devices`) is feature 008; this feature does not store device records.
- Object storage is MinIO locally and an S3-compatible bucket in production (`docs/architecture.md`); export bundles use a dedicated key prefix with a 7-day lifecycle rule.
- The API runs as a single instance for now; per-address throttling keeps its counters in memory and is documented as such (a shared store is a later operational change).
- No analytics (PostHog) in this feature; no localisation beyond English (009).
