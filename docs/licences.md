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
| Uber H3 | Apache 2.0 | — | approved |
| MapLibre Native | BSD-2-Clause | — | approved |
| ONNX Runtime | MIT | — | approved |
| GRDB | MIT | — | approved |

## Inquiry log

| Date | To | Subject | Status |
|---|---|---|---|
| (feature 001) | ccb-birdnet@cornell.edu | Commercial licence terms for BirdNET V2.4 as a fallback model | optional until monetisation — draft prepared in feature 001; must be sent (or V2.4 removed) before any paid feature ships |
| (feature 001) | Pl@ntNet API team (my.plantnet.org) | Pro plan for a consumer iOS app (beta in Lithuania, worldwide play) | to be sent |
