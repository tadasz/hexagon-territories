# ADR 0007: Pl@ntNet as the plant identification provider

**Status**: accepted · **Date**: 2026-09-07

## Context
iNaturalist has no public computer-vision endpoint and no species-level open model for Baltic flora. Pl@ntNet offers 500 free identifications per day (with attribution) and a Pro plan (about €1 000 per year plus a small per-request fee) with GBIF ids, Lithuanian common names, organ tags and regional floras. Kindwise plant.id is 5–10× the per-request cost.

## Decision
Plant capture is cloud-only through Pl@ntNet in the MVP (free tier with attribution during development, Pro before public TestFlight). Photos queue offline in the outbox. An on-device Core ML classifier for common Lithuanian taxa is feature 010, post-launch, with the cloud remaining the verifier.

## Consequences
- Plant capture needs connectivity to resolve; the UI shows pending entries.
- Species are mapped by GBIF key; unknown taxa are inserted inactive for review.
