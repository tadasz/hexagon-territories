import { loadFixture } from '@nature/h3-fixtures';
import { cellToLatLng, cellToLocalIj, gridDistance, latLngToCell, localIjToCell } from 'h3-js';
import { describe, expect, it } from 'vitest';
import {
  acceptSamples,
  haversineM,
  pathLengthM,
  pathToHexMeters,
  simplifyPath,
  type HexMeters,
  type LatLng,
} from '../src/index.js';

const fixture = loadFixture('walk-paths');
const TOLERANCE_M = 0.5;

function pipeline(c: (typeof fixture.cases)[number]): {
  distanceM: number;
  simplified: LatLng[];
  hexMeters: HexMeters[];
} {
  const { accepted } = acceptSamples(c.input.samples);
  const simplified = simplifyPath(
    accepted.map((s) => ({ lat: s.lat, lon: s.lon })),
    c.input.simplifyToleranceM,
  );
  return {
    distanceM: pathLengthM(simplified),
    simplified,
    hexMeters: pathToHexMeters(simplified, { resolution: c.input.resolution }),
  };
}

describe('walk-paths.json: simplifyPath and pathToHexMeters', () => {
  for (const c of fixture.cases) {
    describe(`${fixture.name}: ${c.id}`, () => {
      const actual = pipeline(c);

      it(`distanceM ${c.expected.distanceM} (±${TOLERANCE_M} m)`, () => {
        expect(Math.abs(actual.distanceM - c.expected.distanceM)).toBeLessThanOrEqual(TOLERANCE_M);
      });

      it(`simplifiedPointCount ${c.expected.simplifiedPointCount}`, () => {
        expect(actual.simplified).toHaveLength(c.expected.simplifiedPointCount);
      });

      it(`hexMeters: ${c.expected.hexMeters.length} cells, each within ±${TOLERANCE_M} m`, () => {
        expect(actual.hexMeters.map((h) => h.cell)).toEqual(
          c.expected.hexMeters.map((h) => h.cell),
        );
        for (const expected of c.expected.hexMeters) {
          const got = actual.hexMeters.find((h) => h.cell === expected.cell);
          expect(got, `${c.id}: cell ${expected.cell} missing`).toBeDefined();
          expect(
            Math.abs(got!.meters - expected.meters),
            `${c.id}: cell ${expected.cell} expected ${expected.meters} got ${got!.meters}`,
          ).toBeLessThanOrEqual(TOLERANCE_M);
        }
      });

      it('conserves metres: sum of hexMeters equals the path length', () => {
        const sum = actual.hexMeters.reduce((a, h) => a + h.meters, 0);
        expect(Math.abs(sum - actual.distanceM)).toBeLessThan(0.01);
      });

      it('is sorted by cell ascending', () => {
        const cells = actual.hexMeters.map((h) => h.cell);
        expect(cells).toEqual(cells.slice().sort());
      });
    });
  }

  it('straight-line crosses at least four cells and its sparse segment crosses two boundaries', () => {
    const c = fixture.cases.find((x) => x.id === 'straight-line')!;
    expect(c.expected.hexMeters.length).toBeGreaterThanOrEqual(4);
    const a = c.input.samples[50]!;
    const b = c.input.samples[51]!;
    expect(haversineM(a, b)).toBeGreaterThan(390);
    expect(pathToHexMeters([a, b]).length).toBeGreaterThanOrEqual(3);
  });

  it('edge-hugging credits both neighbours; loop-inside-one-cell credits exactly one', () => {
    const byId = new Map(fixture.cases.map((c) => [c.id, c]));
    expect(byId.get('edge-hugging')!.expected.hexMeters).toHaveLength(2);
    expect(byId.get('loop-inside-one-cell')!.expected.hexMeters).toHaveLength(1);
  });
});

describe('pathToHexMeters unit cases', () => {
  /** Centres of three cells in a straight row (local i axis) around Kaunas: ~600 m end to end. */
  function threeCellRow(): { a: LatLng; b: LatLng; cells: [string, string, string] } {
    const origin = latLngToCell(54.8985, 23.9036, 9);
    const { i, j } = cellToLocalIj(origin, origin);
    const middle = localIjToCell(origin, { i: i + 1, j });
    const far = localIjToCell(origin, { i: i + 2, j });
    expect(gridDistance(origin, far)).toBe(2);
    const [alat, alon] = cellToLatLng(origin);
    const [blat, blon] = cellToLatLng(far);
    return {
      a: { lat: alat, lon: alon },
      b: { lat: blat, lon: blon },
      cells: [origin, middle, far],
    };
  }

  it('splits a single ~600 m segment crossing three cells into three entries', () => {
    const { a, b, cells } = threeCellRow();
    const length = haversineM(a, b);
    expect(length).toBeGreaterThan(500);
    expect(length).toBeLessThan(800);
    const result = pathToHexMeters([a, b]);
    expect(result).toHaveLength(3);
    expect(result.map((h) => h.cell).sort()).toEqual([...cells].sort());
    const sum = result.reduce((s, h) => s + h.meters, 0);
    expect(Math.abs(sum - length)).toBeLessThan(1e-6);
    const middle = result.find((h) => h.cell === cells[1])!;
    // the middle cell is crossed centre to centre: about one cell width, and the two halves match
    expect(middle.meters).toBeGreaterThan(length / 3 - 5);
    const first = result.find((h) => h.cell === cells[0])!;
    const last = result.find((h) => h.cell === cells[2])!;
    expect(Math.abs(first.meters - last.meters)).toBeLessThan(0.5);
  });

  it('credits a segment inside one cell entirely to that cell', () => {
    const cell = latLngToCell(54.8985, 23.9036, 9);
    const [lat, lon] = cellToLatLng(cell);
    const a = { lat: lat, lon: lon };
    const b = { lat: lat + 0.0002, lon: lon + 0.0002 };
    const result = pathToHexMeters([a, b]);
    expect(result).toEqual([{ cell, meters: haversineM(a, b) }]);
  });

  it('ignores degenerate zero-length segments and paths with fewer than two points', () => {
    const p = { lat: 54.8985, lon: 23.9036 };
    expect(pathToHexMeters([])).toEqual([]);
    expect(pathToHexMeters([p])).toEqual([]);
    expect(pathToHexMeters([p, { ...p }])).toEqual([]);
    const q = { lat: 54.8986, lon: 23.9036 };
    const withDuplicates = pathToHexMeters([p, p, q, q]);
    expect(withDuplicates).toEqual(pathToHexMeters([p, q]));
  });

  it('handles a segment spanning the antimeridian', () => {
    const a = { lat: 66, lon: 179.9995 };
    const b = { lat: 66, lon: -179.9995 };
    const length = haversineM(a, b);
    expect(length).toBeLessThan(100); // ~45 m, not half the globe
    const result = pathToHexMeters([a, b]);
    const sum = result.reduce((s, h) => s + h.meters, 0);
    expect(Math.abs(sum - length)).toBeLessThan(1e-6);
    expect(result.every((h) => h.meters > 0 && h.meters <= length)).toBe(true);
  });

  it('respects the resolution option', () => {
    const { a, b } = threeCellRow();
    const r7 = pathToHexMeters([a, b], { resolution: 7 });
    expect(r7.length).toBeLessThanOrEqual(2);
    expect(
      r7.every(
        (h) => h.cell === latLngToCell(a.lat, a.lon, 7) || h.cell === latLngToCell(b.lat, b.lon, 7),
      ),
    ).toBe(true);
  });
});

describe('simplifyPath unit cases', () => {
  it('keeps endpoints and removes collinear points', () => {
    const pts = [0, 1, 2, 3, 4].map((i) => ({ lat: 54.9 + i * 0.0001, lon: 23.9 }));
    expect(simplifyPath(pts)).toEqual([pts[0], pts[4]]);
    expect(simplifyPath(pts.slice(0, 2))).toEqual(pts.slice(0, 2));
    expect(simplifyPath([])).toEqual([]);
  });

  it('keeps a point that deviates by more than the tolerance', () => {
    const pts = [
      { lat: 54.9, lon: 23.9 },
      { lat: 54.9005, lon: 23.9 + 0.0001 }, // ~6.4 m east of the chord
      { lat: 54.901, lon: 23.9 },
    ];
    expect(simplifyPath(pts, 5)).toHaveLength(3);
    expect(simplifyPath(pts, 7)).toHaveLength(2);
  });
});
