import { EARTH_RADIUS_M, type LatLng } from '@nature/territory-rules';
import { sql, type SQL } from 'drizzle-orm';

/** GeoJSON `LineString` as returned by the walk endpoints (`[lon, lat]` positions). */
export interface LineString {
  type: 'LineString';
  coordinates: [number, number][];
}

/**
 * `ST_MakeLine(ARRAY[ST_MakePoint(lon, lat), …])::geography` for a `geography(LineString,4326)`
 * column (research.md R11). Needs at least two points; callers store null otherwise.
 */
export function lineStringSql(points: readonly LatLng[]): SQL {
  if (points.length < 2) throw new RangeError('a LineString needs at least two points');
  const makePoints = points.map((p) => sql`ST_MakePoint(${p.lon}, ${p.lat})`);
  return sql`ST_SetSRID(ST_MakeLine(ARRAY[${sql.join(makePoints, sql`, `)}]), 4326)::geography`;
}

/** Parses the text of `ST_AsGeoJSON(col)`; null in → null out. */
export function geoJsonLineString(text: string | null | undefined): LineString | null {
  if (!text) return null;
  const parsed = JSON.parse(text) as { type?: unknown; coordinates?: unknown };
  if (parsed.type !== 'LineString' || !Array.isArray(parsed.coordinates)) {
    throw new TypeError(`not a GeoJSON LineString: ${text.slice(0, 40)}`);
  }
  const coordinates = (parsed.coordinates as unknown[]).map((position) => {
    if (!Array.isArray(position) || position.length < 2) {
      throw new TypeError('malformed GeoJSON position');
    }
    return [Number(position[0]), Number(position[1])] as [number, number];
  });
  return { type: 'LineString', coordinates };
}

/** A lon/lat bounding box in WGS84 degrees (`minLon,minLat,maxLon,maxLat`). */
export interface Bbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/** Thrown by `parseBbox`; routes map it to `VALIDATION_FAILED` with `details.field = 'bbox'`. */
export class BboxError extends RangeError {
  readonly field = 'bbox';

  constructor(message: string) {
    super(message);
    this.name = 'BboxError';
  }
}

/**
 * Parses and validates `minLon,minLat,maxLon,maxLat` (specs/004-weekly-reckoning/research.md
 * R9): four finite numbers, longitudes in [−180, 180], latitudes in [−90, 90], `min < max` on
 * both axes — so a box can never cross the antimeridian.
 */
export function parseBbox(text: string): Bbox {
  const parts = text.split(',').map((part) => part.trim());
  if (parts.length !== 4 || parts.some((part) => part.length === 0)) {
    throw new BboxError('bbox must be "minLon,minLat,maxLon,maxLat"');
  }
  const values = parts.map(Number);
  if (values.some((value) => !Number.isFinite(value))) {
    throw new BboxError('bbox coordinates must be finite numbers');
  }
  const [minLon, minLat, maxLon, maxLat] = values as [number, number, number, number];
  if (minLon < -180 || maxLon > 180) throw new BboxError('bbox longitudes must be in [-180, 180]');
  if (minLat < -90 || maxLat > 90) throw new BboxError('bbox latitudes must be in [-90, 90]');
  if (!(minLon < maxLon)) {
    throw new BboxError(
      'bbox minLon must be less than maxLon (boxes cannot cross the antimeridian)',
    );
  }
  if (!(minLat < maxLat)) throw new BboxError('bbox minLat must be less than maxLat');
  return { minLon, minLat, maxLon, maxLat };
}

const DEG = Math.PI / 180;

/**
 * Area of a lon/lat box on the sphere: `R² × |sin(maxLat) − sin(minLat)| × Δlon` (exact for a
 * box bounded by meridians and parallels), in km².
 */
export function bboxAreaKm2(box: Bbox): number {
  const r = EARTH_RADIUS_M / 1000;
  const band = Math.abs(Math.sin(box.maxLat * DEG) - Math.sin(box.minLat * DEG));
  return r * r * band * (box.maxLon - box.minLon) * DEG;
}

/** `ST_MakeEnvelope(minLon, minLat, maxLon, maxLat, 4326)` for `geom && envelope` (GiST). */
export function envelopeSql(box: Bbox): SQL {
  return sql`ST_MakeEnvelope(${box.minLon}, ${box.minLat}, ${box.maxLon}, ${box.maxLat}, 4326)`;
}
