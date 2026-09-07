import { EARTH_RADIUS_M, deltaLonDeg, normalizeLon, type LatLng } from '@nature/territory-rules';

const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

/** The point `distM` metres from `p` along `bearingDeg` (spherical forward geodesic). */
export function destination(p: LatLng, bearingDeg: number, distM: number): LatLng {
  const d = distM / EARTH_RADIUS_M;
  const b = rad(bearingDeg);
  const p1 = rad(p.lat);
  const l1 = rad(p.lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 =
    l1 +
    Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: deg(p2), lon: normalizeLon(deg(l2)) };
}

/** Initial bearing from `a` to `b` in degrees `[0, 360)`. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const dl = rad(deltaLonDeg(a.lon, b.lon));
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function round(x: number, places: number): number {
  const f = 10 ** places;
  return Math.round(x * f) / f;
}
