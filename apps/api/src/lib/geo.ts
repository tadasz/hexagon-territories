import type { LatLng } from '@nature/territory-rules';
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
