import { XMLParser } from 'fast-xml-parser';
import type { Track, TrackHints, TrackPoint } from './track.js';

/** Namespace of the optional per-track simulation hints (`<trk><extensions>`). */
export const HINTS_NAMESPACE = 'https://natureexplorer.app/gpx/walk-sim/1';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => name === 'trk' || name === 'trkseg' || name === 'trkpt',
});

type Node = Record<string, unknown>;

function asNode(value: unknown): Node | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Node)
    : undefined;
}

function asText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  const node = asNode(value);
  const text = node?.['#text'];
  return typeof text === 'string' ? text : undefined;
}

function asNumber(value: unknown, what: string): number {
  const text = asText(value);
  const n = text === undefined ? Number.NaN : Number(text);
  if (!Number.isFinite(n)) throw new Error(`GPX: ${what} is not a number (${String(text)})`);
  return n;
}

function parseHints(extensions: unknown): TrackHints | undefined {
  const node = asNode(extensions);
  if (!node) return undefined;
  const hints: TrackHints = {};
  const steps = asText(node.pedometerSteps);
  if (steps !== undefined) hints.pedometerSteps = asNumber(steps, 'ne:pedometerSteps');
  const reportSpeed = asText(node.reportSpeed);
  if (reportSpeed !== undefined) hints.reportSpeed = reportSpeed === 'true';
  return Object.keys(hints).length > 0 ? hints : undefined;
}

/**
 * GPX 1.1 `trk/trkseg/trkpt` with optional `time` and `ele`; every segment of every track is
 * concatenated in document order. Waypoints and routes are ignored.
 */
export function parseGpx(text: string): Track {
  const doc = asNode(parser.parse(text) as unknown);
  // A self-closing `<gpx/>` parses to an empty string: still a root element, just an empty one.
  const gpx = doc && 'gpx' in doc ? (asNode(doc.gpx) ?? {}) : undefined;
  if (!gpx) throw new Error('GPX: no <gpx> root element');
  const tracks = Array.isArray(gpx.trk) ? (gpx.trk as unknown[]) : [];
  if (tracks.length === 0) throw new Error('GPX: no <trk> element');

  const points: TrackPoint[] = [];
  let name: string | undefined;
  let hints: TrackHints | undefined;
  for (const trkValue of tracks) {
    const trk = asNode(trkValue);
    if (!trk) continue;
    name ??= asText(trk.name);
    hints ??= parseHints(trk.extensions);
    const segments = Array.isArray(trk.trkseg) ? (trk.trkseg as unknown[]) : [];
    for (const segValue of segments) {
      const seg = asNode(segValue);
      const trkpts = seg && Array.isArray(seg.trkpt) ? (seg.trkpt as unknown[]) : [];
      for (const ptValue of trkpts) {
        const pt = asNode(ptValue);
        if (!pt) continue;
        const point: TrackPoint = {
          lat: asNumber(pt['@_lat'], 'trkpt lat'),
          lon: asNumber(pt['@_lon'], 'trkpt lon'),
        };
        const time = asText(pt.time);
        if (time !== undefined) {
          if (Number.isNaN(Date.parse(time))) throw new Error(`GPX: invalid <time> ${time}`);
          point.ts = time;
        }
        const ele = asText(pt.ele);
        if (ele !== undefined) point.ele = asNumber(ele, 'trkpt ele');
        points.push(point);
      }
    }
  }
  if (points.length === 0) throw new Error('GPX: the track has no <trkpt>');
  const metadataName = asText(asNode(gpx.metadata)?.name);
  const track: Track = { name: name ?? metadataName ?? 'track', points };
  if (hints) track.hints = hints;
  return track;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `2026-09-07T08:00:00.000Z` → `2026-09-07T08:00:00Z` (GPX convention; both parse). */
function gpxTime(ts: string): string {
  return new Date(ts).toISOString().replace('.000Z', 'Z');
}

export interface RenderGpxOptions {
  creator?: string;
  description?: string;
}

/**
 * Deterministic GPX 1.1 writer (one `<trk>`, one `<trkseg>`; hints as `<extensions>` in the `ne`
 * namespace): byte-identical output for identical input, so regenerated sample tracks can be
 * diffed against the committed files.
 */
export function renderGpx(track: Track, options: RenderGpxOptions = {}): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="${escapeXml(options.creator ?? '@nature/walk-sim')}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:ne="${HINTS_NAMESPACE}">`,
    '  <metadata>',
    `    <name>${escapeXml(track.name)}</name>`,
  ];
  if (options.description) lines.push(`    <desc>${escapeXml(options.description)}</desc>`);
  lines.push('  </metadata>', '  <trk>', `    <name>${escapeXml(track.name)}</name>`);
  if (track.hints) {
    lines.push('    <extensions>');
    if (track.hints.pedometerSteps !== undefined) {
      lines.push(
        `      <ne:pedometerSteps>${String(track.hints.pedometerSteps)}</ne:pedometerSteps>`,
      );
    }
    if (track.hints.reportSpeed !== undefined) {
      lines.push(
        `      <ne:reportSpeed>${track.hints.reportSpeed ? 'true' : 'false'}</ne:reportSpeed>`,
      );
    }
    lines.push('    </extensions>');
  }
  lines.push('    <trkseg>');
  for (const p of track.points) {
    const inner = [
      p.ele !== undefined ? `<ele>${p.ele.toFixed(1)}</ele>` : '',
      p.ts !== undefined ? `<time>${gpxTime(p.ts)}</time>` : '',
    ].join('');
    lines.push(`      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">${inner}</trkpt>`);
  }
  lines.push('    </trkseg>', '  </trk>', '</gpx>', '');
  return lines.join('\n');
}
