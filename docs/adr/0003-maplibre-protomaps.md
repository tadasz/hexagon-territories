# ADR 0003: MapLibre Native with hosted OpenFreeMap vector tiles (self-hosted Protomaps as an option)

**Status**: accepted · **Date**: 2026-09-07

## Decision
Render the map with MapLibre Native iOS wrapped in our own `UIViewRepresentable`; ~~serve a Protomaps PMTiles extract of Lithuania from the object-storage bucket with light and dark styles~~ (tile source superseded by the addendum below: hosted OpenFreeMap global tiles, self-hosted PMTiles kept as an option). Hex overlays are GeoJSON sources with data-driven fill layers; walk paths are line layers.

## Rationale
Thousands of hex polygons with faction colours and smooth resolution cross-fades need GPU vector rendering and style expressions. Apple MapKit in SwiftUI offers only per-polygon overlays without data-driven styling. Self-hosted PMTiles cost close to nothing for one country.

## Consequences
- One more dependency and a custom wrapper to maintain; the MapLibre SwiftUI DSL is not used because it is pre-1.0.
- Server-side MVT hex tiles can be added later without changing the client layer model.

## Alternatives
MapKit (rejected), Mapbox (cost, telemetry), MapTiler or Stadia hosted tiles (per-request pricing).

## Addendum (2026-09-07): global play area, OpenFreeMap basemap

The product owner decided that the play area is anywhere in the world; Lithuania (Kaunas) is the beta test market, not a boundary. A Lithuania PMTiles extract therefore no longer fits. The basemap is **OpenFreeMap** hosted global vector tiles (OpenStreetMap data, free, no API key; styles `liberty` and `bright` for light/dark), which feature 001 already uses as `MapConfig.styleURL`. Attribution "© OpenStreetMap contributors, © OpenFreeMap" is shown on the map; the licence row is in `docs/licences.md`.

Self-hosting a Protomaps PMTiles extract (or a planet build) from our bucket remains an option if OpenFreeMap's terms, uptime or performance become a problem; the style URL is a single configuration value, so the switch is a one-line change plus a bucket. The file name of this ADR is kept for link stability.
