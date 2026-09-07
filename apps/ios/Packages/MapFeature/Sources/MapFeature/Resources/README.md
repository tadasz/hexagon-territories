# MapFeature resources

No bundled style or tiles: the basemap is **OpenFreeMap** hosted global vector tiles (OpenStreetMap data, free, no
API key), the agreed basemap since the ADR 0003 addendum (worldwide play area). `MapConfig.defaultStyleURL` points at
the `liberty` style; the `bright` style for dark mode is wired to the colour scheme in feature 005.

- Attribution "© OpenStreetMap contributors, © OpenFreeMap" is rendered by `MapScreen` and must stay visible
  (Constitution III; licence row in `docs/licences.md`).
- To point a build at a self-hosted PMTiles style later, set the Info.plist key `MAP_STYLE_URL`
  (`MapConfig.fromBundle`) — no code change needed.
- Hex overlays (`HexOverlayController`) and walk paths (`WalkPathsLayer`) are added by features 003/005; feature 008
  switches the overlay to `MLNVectorTileSource` on `/v1/tiles/hex/{z}/{x}/{y}.mvt`.
