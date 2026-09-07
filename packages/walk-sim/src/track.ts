import { parseGpx } from './gpx.js';
import { parseGeoJson } from './geojson.js';

/** One recorded point of a track; `ts` is ISO 8601, `ele` metres. */
export interface TrackPoint {
  lat: number;
  lon: number;
  ts?: string;
  ele?: number;
}

/**
 * Track-level simulation defaults a file may carry (GPX `<trk><extensions>` in the `ne`
 * namespace, GeoJSON `properties`): the checked-in car track hides its device speed and reports
 * 60 steps so that `dry-run car-a1.gpx` reproduces the R15 flags without flags on the command line.
 */
export interface TrackHints {
  pedometerSteps?: number;
  reportSpeed?: boolean;
}

export interface Track {
  name: string;
  points: TrackPoint[];
  hints?: TrackHints;
}

export type TrackFormat = 'gpx' | 'geojson';

/** `.gpx` → gpx; `.geojson` / `.json` → geojson. */
export function detectFormat(fileName: string): TrackFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.gpx')) return 'gpx';
  if (lower.endsWith('.geojson') || lower.endsWith('.json')) return 'geojson';
  throw new Error(`cannot tell the track format of ${fileName} (use .gpx, .geojson or .json)`);
}

export function parseTrack(text: string, format: TrackFormat): Track {
  return format === 'gpx' ? parseGpx(text) : parseGeoJson(text);
}

/** True when every point carries a parsable timestamp (the track can be replayed by time). */
export function hasTimestamps(track: Pick<Track, 'points'>): boolean {
  return (
    track.points.length > 0 &&
    track.points.every((p) => typeof p.ts === 'string' && !Number.isNaN(Date.parse(p.ts)))
  );
}
