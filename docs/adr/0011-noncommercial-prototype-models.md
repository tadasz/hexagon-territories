# ADR 0011: Non-commercial models in Debug and TestFlight builds while the product is non-commercial

**Status**: accepted · **Date**: 2026-09-07 · amends Constitution Principle III (v1.0.0 → v1.1.0)

## Context

Constitution 1.0.0 said non-commercial weights are "never bundled in a release build", and ADR 0006 keeps BirdNET V2.4 (CC BY-NC-SA 4.0) only as an evaluated fallback pending a commercial licence from Cornell. Feature 006 needs to compare BirdNET+ V3 (Apache 2.0, a developer preview whose labels may still change) against the mature V2.4 on real Kaunas recordings, and the most useful comparison happens on testers' phones in the field, i.e. in TestFlight builds, not only on a developer's Mac.

The product owner decided on 2026-09-07 that the app is non-commercial for the whole prototype phase: no subscription, no ads, no paid features, no sponsorship. Under CC BY-NC-SA 4.0 that use is permitted. "Release build" was never a precise term: a TestFlight build is a Release configuration but not an App Store distribution.

## Decision

1. Non-commercial weights MAY be bundled in **Debug and TestFlight** builds **while the product is non-commercial** (no revenue of any kind).
2. They are **FORBIDDEN in App Store builds** and MUST be removed from every build and from the verification worker, or licensed, before any monetisation.
3. BirdNET+ V3 (Apache 2.0) plus the Geomodel stay the **primary** model in every build; a non-commercial model is a fallback behind the `BirdClassifier` protocol only (manifest role `prototype-fallback`).
4. `ml/models/manifest.json` gains `allowed_builds` per model (`debug`, `testflight`, `appstore`). A model whose licence is non-commercial never lists `appstore` and never has a `primary-*` role; `ml/tests/test_manifest.py` enforces both. The iOS build reads the manifest so an App Store archive cannot contain a model whose `allowed_builds` lacks `appstore` (feature 006 wires the check; feature 009 verifies it).
5. Constitution Principle III is amended accordingly (version 1.1.0).

## Consequences

- Feature 006 tester builds bundle both V3 and V2.4 behind `BirdClassifier` with a Debug-menu switch for field comparison; App Store builds bundle V3 + Geomodel only.
- **Monetisation gate**: the first change that introduces revenue (subscription, ads, paid feature, sponsorship) MUST first remove every model whose `allowed_builds` lacks `appstore` from all build types and the worker, or replace its licence entry with a written commercial licence. Reviewers check this on every pull request that touches pricing, StoreKit, ads or sponsorship.
- **Feature 009 (release) checklist item**: "remove non-commercial models from the App Store build" — the archive contains no file listed under a model without `appstore` in `allowed_builds`, `docs/licences.md` still shows the Cornell inquiry as optional or answered, and `ml/tests` are green. This is an exit criterion of Phase 5 in `docs/roadmap.md`.
- The Cornell inquiry (`ml/licensing/birdnet-v24-inquiry.md`) stays optional until monetisation; sending it earlier is harmless.
- Attribution "Powered by BirdNET" already covers both models.
