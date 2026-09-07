# MVP definition

**One sentence**: a Kaunas walker signs in, picks a faction, walks with the app, sees their path and the metres they earned in each hexagon, captures birds by sound along the way, and on Monday morning learns which hexagons their faction won.

The MVP is Spec Kit features **001–006** plus the minimum of 009 needed for a public TestFlight (≈ 14 weeks with three people). Bird capture is in because it is the nature-explorer differentiator and runs on-device; plants come first after the MVP because they depend on a paid third-party API and add a second capture flow.

## In / out

| In the MVP | Not in the MVP (next releases) |
|---|---|
| Sign in with Apple, faction pick (3 factions, placeholder names) | Faction switching, friends, social sharing |
| Walk sessions with background tracking, live path, per-hex metres HUD, offline outbox, walk history with paths | Routes, guided trails, step goals |
| `finishWalk` scoring, weekly reckoning (decay + ownership), contested indicator, parent rollup | Underdog multiplier, seasons/resets, NPC seeding |
| Hex map (res 5–9), own-paths layer, hex detail with weekly history | Server MVT tiles, heatmaps, other players' paths |
| Bird listening + on-device ID (BirdNET+ V3), capture + cloud verification, bird field guide, capture bonus metres | Plant capture (007), on-device plant model (010) |
| Basic profile: explored / flipped / held, distance, birds captured; Monday results push | XP levels, streaks, leaderboards, achievements, admin panel, App Attest (008) |
| PostHog analytics + crash reporting, privacy policy, account deletion | Localisation beyond English, accessibility pass, App Store listing polish |

## Success criteria (4 weeks of public TestFlight in Kaunas)

| Metric | Target |
|---|---|
| Testers | ≥ 50 |
| Walks per tester per week (median) | ≥ 3 |
| Testers with ≥ 1 verified bird capture | ≥ 60 % |
| Week-2 retention | ≥ 40 % |
| Reckonings run without manual intervention | 4 consecutive |
| Battery during a walk (iPhone 13) | < 6 % per hour |
| Crash-free sessions | > 99 % |

## Alternative cut

If speed matters more than identity: an internal "walk & conquer only" beta after features 001–005 (≈ 9 weeks) before adding birds. The roadmap supports this cut without rework.
