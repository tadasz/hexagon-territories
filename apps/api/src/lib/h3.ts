import type { LatLng } from '@nature/territory-rules';
import {
  UNITS,
  cellToBoundary,
  cellToLatLng,
  cellToParent,
  getHexagonAreaAvg,
  getResolution,
  isValidCell,
} from 'h3-js';

/**
 * H3 cells travel as 15-character lowercase hex strings in JSON (the `h3-js` / fixtures form)
 * and are stored as `bigint` columns (docs/architecture.md §6: no h3-pg dependency). Every H3
 * computation the API needs (parents, polygons, areas) happens here with `h3-js`
 * (specs/004-weekly-reckoning/research.md R7).
 */
const CELL_PATTERN = /^[0-9a-f]{15}$/;

export function isH3Cell(value: string): boolean {
  return CELL_PATTERN.test(value);
}

/** `'891f40d1a4fffff'` → `0x891f40d1a4fffffn`; throws on anything but 15 lowercase hex chars. */
export function cellToBigInt(cell: string): bigint {
  if (!CELL_PATTERN.test(cell)) throw new RangeError(`not an H3 cell string: ${cell}`);
  return BigInt(`0x${cell}`);
}

/** Inverse of `cellToBigInt`; accepts the `string` form node-postgres uses for `int8`. */
export function bigIntToCell(value: bigint | string): string {
  const big = typeof value === 'bigint' ? value : BigInt(value);
  if (big < 0n) throw new RangeError(`not an H3 cell: ${String(value)}`);
  const hex = big.toString(16);
  if (hex.length > 15) throw new RangeError(`not an H3 cell: ${String(value)}`);
  return hex.padStart(15, '0');
}

/** A valid H3 cell of resolution 9 in the JSON string form. */
export function isRes9Cell(value: string): boolean {
  return CELL_PATTERN.test(value) && isValidCell(value) && getResolution(value) === 9;
}

export interface CellParents {
  r8: string;
  r7: string;
  r6: string;
  r5: string;
}

/** The res 8–5 parents of a res-9 cell (precomputed for `hex_state`). */
export function parentsOf(cell: string): CellParents {
  return {
    r8: cellToParent(cell, 8),
    r7: cellToParent(cell, 7),
    r6: cellToParent(cell, 6),
    r5: cellToParent(cell, 5),
  };
}

/** Centre of a cell in WGS84. */
export function cellCentre(cell: string): LatLng {
  const [lat, lon] = cellToLatLng(cell);
  return { lat, lon };
}

/**
 * `POLYGON((lon lat, …))` of the cell boundary in WGS84, ring closed, longitudes unwrapped so
 * every vertex lies within ±180° of the cell centre's longitude (a cell straddling the
 * antimeridian stays one continuous ring for PostGIS `&&`; research.md R7). Pentagons at
 * class III resolutions carry distortion vertices, so a ring may hold more than 6 + 1 points.
 */
export function cellPolygonWkt(cell: string): string {
  if (!isValidCell(cell)) throw new RangeError(`not an H3 cell: ${cell}`);
  const centreLon = cellToLatLng(cell)[1];
  const ring = cellToBoundary(cell, true).map(([lon, lat]) => {
    let unwrapped = lon;
    while (unwrapped - centreLon > 180) unwrapped -= 360;
    while (unwrapped - centreLon < -180) unwrapped += 360;
    return [unwrapped, lat] as const;
  });
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push(first);
  return `POLYGON((${ring.map(([lon, lat]) => `${String(lon)} ${String(lat)}`).join(', ')}))`;
}

/** Average hexagon area of a resolution in km² (`h3-js` `getHexagonAreaAvg`). */
export function cellAreaKm2(res: number): number {
  return getHexagonAreaAvg(res, UNITS.km2);
}
