/**
 * Spherical geometry helpers. Distances are haversine on a sphere of radius 6371008.8 m
 * (`plan.md` "Shared Rule Semantics" item 2). Longitude differences are normalised to
 * (-180, 180] so segments spanning the antimeridian are handled; segments longer than half the
 * globe are not meaningful for walks and are not supported.
 */
import type { LatLng } from './types.js';

export const EARTH_RADIUS_M = 6371008.8;

const DEG_TO_RAD = Math.PI / 180;

/** Longitude difference `to - from` normalised to (-180, 180]. */
export function deltaLonDeg(from: number, to: number): number {
  let d = to - from;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

/** Wrap a longitude into [-180, 180]. */
export function normalizeLon(lon: number): number {
  let l = lon;
  while (l > 180) l -= 360;
  while (l < -180) l += 360;
  return l;
}

/** Great-circle distance in metres (haversine, `2R * atan2(sqrt(h), sqrt(1 - h))`). */
export function haversineM(a: LatLng, b: LatLng): number {
  const p1 = a.lat * DEG_TO_RAD;
  const p2 = b.lat * DEG_TO_RAD;
  const dp = p2 - p1;
  const dl = deltaLonDeg(a.lon, b.lon) * DEG_TO_RAD;
  const sdp = Math.sin(dp / 2);
  const sdl = Math.sin(dl / 2);
  const h = sdp * sdp + Math.cos(p1) * Math.cos(p2) * sdl * sdl;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Point at fraction `t` in [0, 1] from `a` to `b`, interpolating linearly in latitude and
 * (normalised) longitude: `a + t * (b - a)`. No bearings involved. This is the interpolation
 * both the TypeScript and the Swift `pathToHexMeters` use, so crossing points agree.
 */
export function interpolate(a: LatLng, b: LatLng, t: number): LatLng {
  return {
    lat: a.lat + t * (b.lat - a.lat),
    lon: normalizeLon(a.lon + t * deltaLonDeg(a.lon, b.lon)),
  };
}

/** Sum of haversine segment lengths along a polyline. */
export function pathLengthM(points: readonly LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineM(points[i - 1]!, points[i]!);
  return total;
}

/** A point in the local equirectangular frame (metres). */
export interface LocalXY {
  x: number;
  y: number;
}

/**
 * Project points to metres in a local equirectangular frame centred on the path: `y` is metres
 * north of the bounding-box mid-latitude, `x` is metres east of the first point's longitude
 * scaled by `cos(midLatitude)`. Accurate to well under the 5 m simplification tolerance for
 * paths a few kilometres long.
 */
export function projectLocal(points: readonly LatLng[]): LocalXY[] {
  if (points.length === 0) return [];
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  const lat0 = (minLat + maxLat) / 2;
  const lon0 = points[0]!.lon;
  const kx = Math.cos(lat0 * DEG_TO_RAD) * EARTH_RADIUS_M * DEG_TO_RAD;
  const ky = EARTH_RADIUS_M * DEG_TO_RAD;
  return points.map((p) => ({ x: deltaLonDeg(lon0, p.lon) * kx, y: (p.lat - lat0) * ky }));
}
