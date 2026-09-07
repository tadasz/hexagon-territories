import { describe, expect, it } from 'vitest';
import { BboxError, bboxAreaKm2, envelopeSql, parseBbox } from '../../src/lib/geo.js';
import { cellAreaKm2 } from '../../src/lib/h3.js';
import { HEX_BBOX_MAX_CELLS } from '../../src/modules/territory/limits.js';

const KAUNAS = '23.85,54.87,23.98,54.93';
const LITHUANIA = '20,53,27,57';

function estimatedCells(bbox: string, res: number): number {
  return bboxAreaKm2(parseBbox(bbox)) / cellAreaKm2(res);
}

describe('bbox parsing, area and cap (research.md R9)', () => {
  it('parses a well-formed box', () => {
    expect(parseBbox(KAUNAS)).toEqual({
      minLon: 23.85,
      minLat: 54.87,
      maxLon: 23.98,
      maxLat: 54.93,
    });
    expect(parseBbox(' -1 , -2 , 3 , 4 ')).toEqual({
      minLon: -1,
      minLat: -2,
      maxLon: 3,
      maxLat: 4,
    });
  });

  it('rejects malformed, inverted, out-of-range and antimeridian-crossing boxes', () => {
    for (const bad of [
      '',
      '1,2,3',
      '1,2,3,4,5',
      'a,b,c,d',
      '23.98,54.87,23.85,54.93', // minLon > maxLon
      '23.85,54.93,23.98,54.87', // minLat > maxLat
      '23.85,54.87,23.85,54.93', // zero width
      '-181,0,0,1',
      '0,-91,1,0',
      '0,0,181,1',
      '0,0,1,91',
      '179,60,-179,61', // crosses the antimeridian
      'NaN,0,1,1',
    ]) {
      expect(() => parseBbox(bad), bad).toThrow(BboxError);
    }
    try {
      parseBbox('1,2,3');
    } catch (err) {
      expect((err as BboxError).field).toBe('bbox');
    }
  });

  it('computes the spherical area of the Kaunas box (about 56 km²)', () => {
    const area = bboxAreaKm2(parseBbox(KAUNAS));
    expect(area).toBeGreaterThan(55);
    expect(area).toBeLessThan(57.5);
    expect(estimatedCells(KAUNAS, 9)).toBeGreaterThan(500);
    expect(estimatedCells(KAUNAS, 9)).toBeLessThan(560);
  });

  it('allows the Kaunas box at every resolution and Lithuania only when coarse', () => {
    for (const res of [5, 6, 7, 8, 9]) {
      expect(estimatedCells(KAUNAS, res), `res ${String(res)}`).toBeLessThan(HEX_BBOX_MAX_CELLS);
    }
    expect(estimatedCells(LITHUANIA, 9)).toBeGreaterThan(HEX_BBOX_MAX_CELLS);
    expect(estimatedCells(LITHUANIA, 8)).toBeGreaterThan(HEX_BBOX_MAX_CELLS);
    expect(estimatedCells(LITHUANIA, 7)).toBeGreaterThan(HEX_BBOX_MAX_CELLS);
    expect(estimatedCells(LITHUANIA, 6)).toBeGreaterThan(HEX_BBOX_MAX_CELLS);
    expect(estimatedCells(LITHUANIA, 5)).toBeLessThan(HEX_BBOX_MAX_CELLS);
  });

  it('builds an ST_MakeEnvelope expression in lon/lat order with SRID 4326', () => {
    const chunk = envelopeSql(parseBbox(KAUNAS));
    const text = JSON.stringify(chunk.queryChunks);
    expect(text).toContain('ST_MakeEnvelope');
    expect(text).toContain('4326');
    const params = chunk.queryChunks.filter((c) => typeof c === 'number');
    expect(params).toEqual([23.85, 54.87, 23.98, 54.93]);
  });
});
