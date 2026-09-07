import { describe, expect, it } from 'vitest';
import { geoJsonLineString, lineStringSql } from '../../src/lib/geo.js';

describe('lib/geo', () => {
  it('builds an ST_MakeLine geography expression with lon/lat order', () => {
    const chunk = lineStringSql([
      { lat: 54.9035, lon: 23.932 },
      { lat: 54.9041, lon: 23.9331 },
    ]);
    const parts = chunk.queryChunks.map((c) => (typeof c === 'object' && 'value' in c ? c : c));
    const text = JSON.stringify(parts);
    expect(text).toContain('ST_MakeLine');
    expect(text).toContain('ST_MakePoint');
    expect(text).toContain('::geography');
    expect(() => lineStringSql([{ lat: 1, lon: 2 }])).toThrow(RangeError);
  });

  it('parses ST_AsGeoJSON output and passes null through', () => {
    expect(geoJsonLineString(null)).toBeNull();
    expect(geoJsonLineString(undefined)).toBeNull();
    expect(
      geoJsonLineString('{"type":"LineString","coordinates":[[23.932,54.9035],[23.9331,54.9041]]}'),
    ).toEqual({
      type: 'LineString',
      coordinates: [
        [23.932, 54.9035],
        [23.9331, 54.9041],
      ],
    });
    expect(() => geoJsonLineString('{"type":"Point","coordinates":[1,2]}')).toThrow(TypeError);
  });
});
