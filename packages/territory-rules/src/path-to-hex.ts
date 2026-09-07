/**
 * Split a path into metres per H3 cell (`plan.md` "Shared Rule Semantics" item 7,
 * `research.md` R4).
 *
 * For each consecutive pair (a, b): a zero-length segment is skipped; if both ends share a cell
 * the whole haversine length is credited to it (cells are convex, so a straight segment cannot
 * leave and re-enter). Otherwise the first exit from the current cell is located by bisection
 * on the segment parameter until the bracketing points are at most 0.05 m apart; the crossing
 * point is the bracket's outer point (the first point known to be outside the current cell),
 * the part before it is credited to the current cell and the loop continues from the crossing
 * point - so a segment that crosses many cells is split at every boundary. Metres are summed
 * per cell, cells below 0.01 m are dropped, and the result is sorted by cell string ascending.
 *
 * Longitudes are interpolated through the normalised difference, so a segment spanning the
 * antimeridian is handled. Near the poles linear lat/lon interpolation is not a great circle;
 * walks there are not a supported case.
 */
import { latLngToCell } from 'h3-js';
import { RULES } from './config.js';
import { haversineM, interpolate } from './geo.js';
import type { HexMeters, LatLng } from './types.js';

/** Bisection stops when the bracket is at most this long. */
export const CROSSING_TOLERANCE_M = 0.05;
/** Cells credited with less than this are dropped from the result. */
export const MIN_CELL_METERS = 0.01;

export interface PathToHexOptions {
  /** H3 resolution; defaults to `RULES.RES` (9). */
  resolution?: number;
}

export function pathToHexMeters(
  points: readonly LatLng[],
  options: PathToHexOptions = {},
): HexMeters[] {
  const res = options.resolution ?? RULES.RES;
  const meters = new Map<string, number>();
  const credit = (cell: string, m: number): void => {
    meters.set(cell, (meters.get(cell) ?? 0) + m);
  };
  const cellOf = (p: LatLng): string => latLngToCell(p.lat, p.lon, res);

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (haversineM(a, b) === 0) continue; // degenerate segment
    const cellB = cellOf(b);
    let cur = a;
    let curCell = cellOf(cur);
    while (curCell !== cellB) {
      // cur is inside curCell, b is not: bisect for the exit point
      let lo = 0;
      let hi = 1;
      while (haversineM(interpolate(cur, b, lo), interpolate(cur, b, hi)) > CROSSING_TOLERANCE_M) {
        const mid = (lo + hi) / 2;
        if (cellOf(interpolate(cur, b, mid)) === curCell) lo = mid;
        else hi = mid;
      }
      const crossing = interpolate(cur, b, hi);
      credit(curCell, haversineM(cur, crossing));
      cur = crossing;
      curCell = cellOf(cur);
    }
    credit(curCell, haversineM(cur, b));
  }

  return [...meters.entries()]
    .filter(([, m]) => m >= MIN_CELL_METERS)
    .map(([cell, m]) => ({ cell, meters: m }))
    .sort((x, y) => (x.cell < y.cell ? -1 : x.cell > y.cell ? 1 : 0));
}
