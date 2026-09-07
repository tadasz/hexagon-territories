# ADR 0006: Bird recognition on BirdNET+ V3 (Apache 2.0) with swappable fallbacks

**Status**: accepted · **Date**: 2026-09-07

## Context
BirdNET V2.4 models are CC BY-NC-SA 4.0 (non-commercial). Cornell's BirdNET Live app (MIT code) bundles BirdNET+ V3.0-preview3.1 as ONNX and states the bundled weights are Apache 2.0; the BirdNET Geomodel weights are Apache 2.0. Google Perch v2 is Apache 2.0 as TFLite. Cornell offers no hosted API.

## Decision
Ship BirdNET+ V3 (Global 10K-pruned FP16 ONNX) plus Geomodel 3.0.4 on device through ONNX Runtime with the Core ML execution provider. Run BirdNET FP32 server-side in a Python worker for verification. Hide the model behind a `BirdClassifier` protocol; keep BirdNET V2.4 (only with a written commercial licence from Cornell) and Perch v2 as evaluated fallbacks. Pin model versions and hashes in `ml/models/manifest.json`; show "Powered by BirdNET" attribution.

## Consequences
- No non-commercial weights in App Store builds (Constitution III as amended by ADR 0011; Debug and TestFlight builds may carry them while the product is non-commercial).
- The V3 preview may change labels or format; species are keyed by scientific name and every model update goes through the eval set.
- A licence inquiry to Cornell is drafted in feature 001; sending it is optional until monetisation (see addendum).

## Addendum (2026-09-07): prototype phase is non-commercial

The product owner decided that the app is non-commercial during the prototype phase. Under CC BY-NC-SA 4.0, BirdNET V2.4 **may** therefore be used during that phase, on device and server, as a fallback behind the `BirdClassifier` protocol (manifest role `prototype-fallback`, non-commercial phase only). BirdNET+ V3 (Apache 2.0) remains the primary model, so nothing has to be swapped when monetisation starts; V2.4 must be removed from every build and the worker, or licensed from Cornell, before any paid feature ships. The Cornell inquiry stays in the `docs/licences.md` log marked "optional until monetisation".

## Addendum (2026-09-07, ADR 0011): Debug and TestFlight builds

Constitution Principle III was amended to 1.1.0 by [ADR 0011](0011-noncommercial-prototype-models.md): BirdNET V2.4 may be bundled in **Debug and TestFlight** builds while the product is non-commercial (no subscription, ads, paid features or sponsorship), is **forbidden in App Store builds**, and must be removed or licensed before any monetisation. The manifest records this as `allowed_builds: ["debug", "testflight"]` on `birdnet-v2.4`; BirdNET+ V3 and the Geomodel list all three build types and stay primary in every build. Feature 006 ships tester builds with both models behind `BirdClassifier` and a Debug-menu switch for field comparison; feature 009 carries the release checklist item that strips non-commercial models from the App Store archive.
