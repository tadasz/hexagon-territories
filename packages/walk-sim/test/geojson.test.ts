import { describe, expect, it } from 'vitest';
import { parseGeoJson } from '../src/geojson.js';

const LINE = {
  type: 'LineString',
  coordinates: [
    [23.9, 54.89, 60],
    [23.9001, 54.8901],
    [23.9002, 54.8902],
    [23.9003, 54.8903],
    [23.9004, 54.8904],
  ],
};

describe('parseGeoJson', () => {
  it('reads a bare LineString', () => {
    const track = parseGeoJson(JSON.stringify(LINE));
    expect(track.name).toBe('track');
    expect(track.points).toHaveLength(5);
    expect(track.points[0]).toEqual({ lat: 54.89, lon: 23.9, ele: 60 });
    expect(track.points[1]).toEqual({ lat: 54.8901, lon: 23.9001 });
  });

  it('reads a Feature with coordTimes, name and hints', () => {
    const coordTimes = [0, 5, 10, 15, 20].map(
      (s) => `2026-09-07T08:00:${String(s).padStart(2, '0')}Z`,
    );
    const track = parseGeoJson(
      JSON.stringify({
        type: 'Feature',
        geometry: LINE,
        properties: { name: 'walk', coordTimes, pedometerSteps: 7, reportSpeed: false },
      }),
    );
    expect(track.name).toBe('walk');
    expect(track.points.map((p) => p.ts)).toEqual(coordTimes);
    expect(track.hints).toEqual({ pedometerSteps: 7, reportSpeed: false });
  });

  it('takes the first LineString of a FeatureCollection', () => {
    const track = parseGeoJson(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} },
          { type: 'Feature', geometry: LINE, properties: { name: 'second' } },
        ],
      }),
    );
    expect(track.name).toBe('second');
    expect(track.points).toHaveLength(5);
  });

  it('rejects other geometries and mismatched coordTimes', () => {
    expect(() => parseGeoJson('{"type":"Point","coordinates":[1,2]}')).toThrow(/unsupported/);
    expect(() =>
      parseGeoJson(
        JSON.stringify({ type: 'Feature', geometry: LINE, properties: { coordTimes: ['x'] } }),
      ),
    ).toThrow(/coordTimes/);
    expect(() => parseGeoJson('{"type":"LineString","coordinates":[]}')).toThrow(/no positions/);
  });
});
