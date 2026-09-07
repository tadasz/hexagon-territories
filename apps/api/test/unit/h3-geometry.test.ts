import { loadFixture } from '@nature/h3-fixtures';
import { cellToParent, getResolution, isValidCell } from 'h3-js';
import { describe, expect, it } from 'vitest';
import {
  cellAreaKm2,
  cellCentre,
  cellPolygonWkt,
  cellToBigInt,
  isRes9Cell,
  parentsOf,
} from '../../src/lib/h3.js';

const ANTIMERIDIAN = '890d9100ad7ffff';
const PENTAGON = '89080000003ffff';
const TOWN_HALL = '891f40da99bffff';

function ringOf(wkt: string): [number, number][] {
  const match = /^POLYGON\(\((.+)\)\)$/.exec(wkt);
  if (!match) throw new Error(`not a polygon: ${wkt}`);
  return match[1]!.split(', ').map((pair) => {
    const [lon, lat] = pair.split(' ').map(Number);
    return [lon!, lat!];
  });
}

describe('lib/h3 geometry (research.md R7)', () => {
  it('computes the parents of every latlng-to-cell fixture case', () => {
    const fixture = loadFixture('latlng-to-cell');
    expect(fixture.cases.length).toBe(200);
    for (const c of fixture.cases) {
      expect(parentsOf(c.expected.r9), c.id).toEqual(c.expected.parents);
      expect(isRes9Cell(c.expected.r9), c.id).toBe(true);
      expect(cellToBigInt(parentsOf(c.expected.r9).r5) > 0n).toBe(true);
    }
    expect(parentsOf(TOWN_HALL).r8).toBe(cellToParent(TOWN_HALL, 8));
  });

  it('writes an ST_GeomFromText-ready closed ring that contains the cell centre', () => {
    const wkt = cellPolygonWkt(TOWN_HALL);
    expect(wkt.startsWith('POLYGON((')).toBe(true);
    const ring = ringOf(wkt);
    expect(ring).toHaveLength(7);
    expect(ring[0]).toEqual(ring[6]);
    const centre = cellCentre(TOWN_HALL);
    const lons = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    expect(centre.lon).toBeGreaterThan(Math.min(...lons));
    expect(centre.lon).toBeLessThan(Math.max(...lons));
    expect(centre.lat).toBeGreaterThan(Math.min(...lats));
    expect(centre.lat).toBeLessThan(Math.max(...lats));
  });

  it('unwraps the antimeridian cell of the fixture to a ring spanning under one degree', () => {
    const ring = ringOf(cellPolygonWkt(ANTIMERIDIAN));
    const lons = ring.map((p) => p[0]);
    expect(Math.max(...lons) - Math.min(...lons)).toBeLessThan(1);
    // The raw boundary jumps by ~360°; the unwrapped one stays continuous around the centre.
    const centre = cellCentre(ANTIMERIDIAN);
    for (const lon of lons) expect(Math.abs(lon - centre.lon)).toBeLessThan(1);
  });

  it('keeps the distortion vertices of a class III pentagon (10 + closing point)', () => {
    const ring = ringOf(cellPolygonWkt(PENTAGON));
    expect(ring).toHaveLength(11);
    expect(ring[0]).toEqual(ring[10]);
  });

  it('rejects invalid or non-res-9 cells', () => {
    expect(isRes9Cell(parentsOf(TOWN_HALL).r8)).toBe(false);
    expect(getResolution(parentsOf(TOWN_HALL).r8)).toBe(8);
    expect(isRes9Cell('891F40DA99BFFFF')).toBe(false);
    expect(isRes9Cell('ffffffffffffffff')).toBe(false);
    expect(isRes9Cell('000000000000000')).toBe(false);
    expect(isValidCell('000000000000000')).toBe(false);
    expect(() => cellPolygonWkt('000000000000000')).toThrow(RangeError);
  });

  it('knows the average cell area per resolution', () => {
    expect(cellAreaKm2(9)).toBeCloseTo(0.105, 2);
    expect(cellAreaKm2(5)).toBeGreaterThan(200);
    expect(cellAreaKm2(5)).toBeLessThan(300);
    expect(cellAreaKm2(8) / cellAreaKm2(9)).toBeCloseTo(7, 0);
  });
});
