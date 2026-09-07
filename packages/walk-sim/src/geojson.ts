import type { Track, TrackHints, TrackPoint } from './track.js';

interface GeoJsonLineString {
  type: 'LineString';
  coordinates: unknown[];
}

interface GeoJsonFeature {
  type: 'Feature';
  geometry?: unknown;
  properties?: Record<string, unknown> | null;
}

interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features?: unknown[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function findLineString(doc: unknown): {
  geometry: GeoJsonLineString;
  properties: Record<string, unknown>;
} {
  if (!isObject(doc)) throw new Error('GeoJSON: not an object');
  if (doc.type === 'LineString' && Array.isArray(doc.coordinates)) {
    return { geometry: doc as unknown as GeoJsonLineString, properties: {} };
  }
  if (doc.type === 'Feature') {
    const feature = doc as unknown as GeoJsonFeature;
    const geometry = feature.geometry;
    if (
      isObject(geometry) &&
      geometry.type === 'LineString' &&
      Array.isArray(geometry.coordinates)
    ) {
      return {
        geometry: geometry as unknown as GeoJsonLineString,
        properties: isObject(feature.properties) ? feature.properties : {},
      };
    }
    throw new Error('GeoJSON: the Feature geometry is not a LineString');
  }
  if (doc.type === 'FeatureCollection') {
    const features = (doc as unknown as GeoJsonFeatureCollection).features ?? [];
    for (const feature of features) {
      try {
        return findLineString(feature);
      } catch {
        // try the next feature
      }
    }
    throw new Error('GeoJSON: no LineString feature in the collection');
  }
  throw new Error(`GeoJSON: unsupported type ${String(doc.type)}`);
}

/**
 * A GeoJSON `LineString`, `Feature<LineString>` or the first LineString of a `FeatureCollection`.
 * Positions are `[lon, lat, ele?]`; optional `properties.coordTimes` (ISO strings, one per
 * position) give timestamps, `properties.name` the name, `properties.pedometerSteps` /
 * `properties.reportSpeed` the simulation hints.
 */
export function parseGeoJson(text: string): Track {
  const { geometry, properties } = findLineString(JSON.parse(text) as unknown);
  const coordTimes = Array.isArray(properties.coordTimes)
    ? (properties.coordTimes as unknown[])
    : undefined;
  if (coordTimes && coordTimes.length !== geometry.coordinates.length) {
    throw new Error('GeoJSON: coordTimes length differs from the coordinate count');
  }
  const points: TrackPoint[] = geometry.coordinates.map((position, i) => {
    if (!Array.isArray(position) || position.length < 2) {
      throw new Error(`GeoJSON: malformed position at index ${String(i)}`);
    }
    const lon = Number(position[0]);
    const lat = Number(position[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error(`GeoJSON: non-numeric position at index ${String(i)}`);
    }
    const point: TrackPoint = { lat, lon };
    if (position.length > 2 && Number.isFinite(Number(position[2])))
      point.ele = Number(position[2]);
    const ts = coordTimes?.[i];
    if (typeof ts === 'string') {
      if (Number.isNaN(Date.parse(ts)))
        throw new Error(`GeoJSON: invalid coordTimes[${String(i)}]`);
      point.ts = ts;
    }
    return point;
  });
  if (points.length === 0) throw new Error('GeoJSON: the LineString has no positions');
  const hints: TrackHints = {};
  if (typeof properties.pedometerSteps === 'number')
    hints.pedometerSteps = properties.pedometerSteps;
  if (typeof properties.reportSpeed === 'boolean') hints.reportSpeed = properties.reportSpeed;
  const track: Track = {
    name: typeof properties.name === 'string' ? properties.name : 'track',
    points,
  };
  if (Object.keys(hints).length > 0) track.hints = hints;
  return track;
}
