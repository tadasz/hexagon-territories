# ADR 0003: MapLibre Native with self-hosted Protomaps tiles

**Status**: accepted · **Date**: 2026-09-07

## Decision
Render the map with MapLibre Native iOS wrapped in our own `UIViewRepresentable`; serve a Protomaps PMTiles extract of Lithuania from the object-storage bucket with light and dark styles. Hex overlays are GeoJSON sources with data-driven fill layers; walk paths are line layers.

## Rationale
Thousands of hex polygons with faction colours and smooth resolution cross-fades need GPU vector rendering and style expressions. Apple MapKit in SwiftUI offers only per-polygon overlays without data-driven styling. Self-hosted PMTiles cost close to nothing for one country.

## Consequences
- One more dependency and a custom wrapper to maintain; the MapLibre SwiftUI DSL is not used because it is pre-1.0.
- Server-side MVT hex tiles can be added later without changing the client layer model.

## Alternatives
MapKit (rejected), Mapbox (cost, telemetry), MapTiler or Stadia hosted tiles (per-request pricing).
