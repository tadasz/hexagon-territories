import { describe, expect, it } from 'vitest';
import { parseGpx, renderGpx } from '../src/gpx.js';
import { detectFormat, hasTimestamps, parseTrack } from '../src/track.js';

const FIVE_POINTS = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="hand" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>meta name</name></metadata>
  <trk>
    <name>five</name>
    <trkseg>
      <trkpt lat="54.8900" lon="23.9000"><ele>60</ele><time>2026-09-07T08:00:00Z</time></trkpt>
      <trkpt lat="54.8901" lon="23.9001"><ele>61</ele><time>2026-09-07T08:00:05Z</time></trkpt>
      <trkpt lat="54.8902" lon="23.9002"><time>2026-09-07T08:00:10Z</time></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="54.8903" lon="23.9003"><time>2026-09-07T08:00:15Z</time></trkpt>
      <trkpt lat="54.8904" lon="23.9004"><time>2026-09-07T08:00:20Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;

describe('parseGpx', () => {
  it('reads trk/trkseg/trkpt with time and ele, concatenating segments', () => {
    const track = parseGpx(FIVE_POINTS);
    expect(track.name).toBe('five');
    expect(track.points).toHaveLength(5);
    expect(track.points[0]).toEqual({ lat: 54.89, lon: 23.9, ts: '2026-09-07T08:00:00Z', ele: 60 });
    expect(track.points[2]).toEqual({ lat: 54.8902, lon: 23.9002, ts: '2026-09-07T08:00:10Z' });
    expect(track.points[4]?.ts).toBe('2026-09-07T08:00:20Z');
    expect(track.hints).toBeUndefined();
    expect(hasTimestamps(track)).toBe(true);
  });

  it('accepts a single point without time and falls back to the metadata name', () => {
    const track = parseGpx(
      '<gpx xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>m</name></metadata><trk><trkseg><trkpt lat="1" lon="2"/></trkseg></trk></gpx>',
    );
    expect(track).toEqual({ name: 'm', points: [{ lat: 1, lon: 2 }] });
    expect(hasTimestamps(track)).toBe(false);
  });

  it('reads the ne: simulation hints of a track', () => {
    const track = parseGpx(
      '<gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:ne="https://natureexplorer.app/gpx/walk-sim/1"><trk><extensions><ne:pedometerSteps>60</ne:pedometerSteps><ne:reportSpeed>false</ne:reportSpeed></extensions><trkseg><trkpt lat="1" lon="2"/></trkseg></trk></gpx>',
    );
    expect(track.hints).toEqual({ pedometerSteps: 60, reportSpeed: false });
  });

  it('rejects documents without a track or with bad numbers', () => {
    expect(() => parseGpx('<gpx/>')).toThrow(/no <trk>/);
    expect(() => parseGpx('<nope/>')).toThrow(/no <gpx>/);
    expect(() =>
      parseGpx('<gpx><trk><trkseg><trkpt lat="x" lon="2"/></trkseg></trk></gpx>'),
    ).toThrow(/lat/);
    expect(() =>
      parseGpx(
        '<gpx><trk><trkseg><trkpt lat="1" lon="2"><time>later</time></trkpt></trkseg></trk></gpx>',
      ),
    ).toThrow(/invalid <time>/);
  });

  it('round-trips through renderGpx deterministically', () => {
    const track = parseGpx(FIVE_POINTS);
    track.hints = { pedometerSteps: 12, reportSpeed: false };
    const gpx = renderGpx(track, { creator: 'test', description: 'a <b> & "c"' });
    expect(gpx).toBe(renderGpx(track, { creator: 'test', description: 'a <b> & "c"' }));
    expect(gpx).toContain('<desc>a &lt;b&gt; &amp; &quot;c&quot;</desc>');
    expect(gpx).toContain('<ne:pedometerSteps>12</ne:pedometerSteps>');
    expect(gpx).toContain(
      '<trkpt lat="54.8900000" lon="23.9000000"><ele>60.0</ele><time>2026-09-07T08:00:00Z</time></trkpt>',
    );
    const again = parseGpx(gpx);
    expect(again.name).toBe('five');
    expect(again.hints).toEqual(track.hints);
    expect(again.points.map((p) => [p.lat, p.lon, p.ts])).toEqual(
      track.points.map((p) => [p.lat, p.lon, p.ts]),
    );
  });
});

describe('detectFormat / parseTrack', () => {
  it('picks the parser from the extension', () => {
    expect(detectFormat('a/b.GPX')).toBe('gpx');
    expect(detectFormat('b.geojson')).toBe('geojson');
    expect(detectFormat('c.json')).toBe('geojson');
    expect(() => detectFormat('d.kml')).toThrow(/format/);
    expect(parseTrack(FIVE_POINTS, 'gpx').points).toHaveLength(5);
  });
});
