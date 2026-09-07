# Licences and attribution

Every model, dataset, tile source, reference recording and species image must be listed here or in `ml/models/manifest.json` before code references it (Constitution III).

| Asset | Licence | Attribution required in app | Status |
|---|---|---|---|
| BirdNET+ V3 preview weights (ONNX) | Apache 2.0 (as bundled in BirdNET Live) | "Powered by BirdNET" | approved for release builds |
| BirdNET Geomodel 3.0.4 weights | Apache 2.0 | included in BirdNET credit | approved |
| Google Perch v2 | Apache 2.0 | "Bird classification by Google Perch" if used | evaluated fallback |
| BirdNET V2.4 models | CC BY-NC-SA 4.0 | "Powered by BirdNET" (shared with V3) | **allowed while the app is non-commercial** (prototype phase, on device and server, as a fallback behind `BirdClassifier`); **must be removed or licensed before any monetisation**. BirdNET+ V3 stays the primary model so nothing needs swapping (ADR 0006 addendum) |
| Pl@ntNet API | Free tier: 500 id/day with mandatory attribution sentence + logo; Pro plan for commercial volume | Pl@ntNet attribution in Collection footer and species pages | free tier for development; Pro before public TestFlight (inquiry to be sent in feature 001) |
| OpenFreeMap hosted vector tiles (OpenStreetMap data) | ODbL (data); OpenFreeMap free tier terms (public tiles, no API key, no usage fee, attribution required); styles `liberty` / `bright` BSD | "© OpenStreetMap contributors, © OpenFreeMap" on the map | approved — global basemap |
| Protomaps PMTiles (OpenStreetMap data), self-hosted | ODbL (data), Protomaps basemap styles BSD | "© OpenStreetMap contributors, © Protomaps" on the map | not in use; kept as a later self-hosting option (ADR 0003 addendum) |
| Xeno-canto reference recordings | per-recording CC licences (mostly CC BY-NC-SA / CC BY-SA) | per-recording credit on species pages | link out or use only CC BY / CC BY-SA clips with credit |
| Wikimedia Commons species images | per-image CC licences | per-image credit on species pages | use only CC0 / CC BY / CC BY-SA |
| GBIF occurrence and image data (for species seed and feature 010 training) | CC0 / CC BY / CC BY-NC per record | dataset citation | filter to CC0 / CC BY for training |
| Uber H3 (h3-js; H3 C core vendored in the `H3Kit` Swift package, Apache 2.0 LICENSE file committed alongside the sources) | Apache 2.0 | — | approved |
| MapLibre Native (iOS distribution via Swift Package Manager) | BSD-2-Clause | — | approved |
| ONNX Runtime | MIT | — | approved |
| GRDB | MIT | — | approved |
| XcodeGen (tooling, generates the Xcode project; not shipped) | MIT | — | approved |

## Inquiry log

| Date | To | Subject | Status |
|---|---|---|---|
| 2026-09-07 (draft) | ccb-birdnet@cornell.edu | Commercial licence terms for BirdNET V2.4 as a fallback model | optional until monetisation — draft ready in `ml/licensing/birdnet-v24-inquiry.md`, to be sent by the owner (or V2.4 removed) before any paid feature ships; sent date: — |
| 2026-09-07 (draft) | Pl@ntNet API team (my.plantnet.org) | Pro plan for a consumer iOS app (beta in Lithuania, worldwide play) | draft ready in `ml/licensing/plantnet-pro-inquiry.md` — to be sent by the owner before the public TestFlight; sent date: — |
