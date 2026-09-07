import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { expected } from '../src/expected.js';
import { parseGpx } from '../src/gpx.js';
import {
  SAMPLE_TRACK_SPECS,
  assertSampleTrack,
  generateSampleFiles,
} from '../src/sample-tracks.js';
import { SAMPLES_DIR, SAMPLE_TRACKS } from '../src/samples.js';
import { simulate } from '../src/simulate.js';

describe('sample tracks (research.md R15)', () => {
  it('regenerate byte-identically into a temporary directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'walk-sim-samples-'));
    try {
      const reports = generateSampleFiles(dir);
      expect(reports.map((r) => r.file)).toEqual(SAMPLE_TRACK_SPECS.map((s) => s.file));
      for (const spec of SAMPLE_TRACK_SPECS) {
        expect(readFileSync(join(dir, spec.file), 'utf8'), spec.file).toBe(
          readFileSync(join(SAMPLES_DIR, spec.file), 'utf8'),
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('SAMPLE_TRACKS resolve to the committed files', () => {
    expect(Object.values(SAMPLE_TRACKS).sort()).toEqual(
      SAMPLE_TRACK_SPECS.map((s) => join(SAMPLES_DIR, s.file)).sort(),
    );
  });

  for (const spec of SAMPLE_TRACK_SPECS) {
    it(`${spec.file} has the asserted flags and cell count`, () => {
      const gpx = readFileSync(join(SAMPLES_DIR, spec.file), 'utf8');
      const report = assertSampleTrack(spec, gpx);
      expect(report.flags).toEqual(spec.flags);
      expect(report.cells).toBeGreaterThanOrEqual(spec.minCells);
      const track = parseGpx(gpx);
      expect(track.name).toBe(spec.name);
      const sim = simulate(track);
      // The GPX points are the 5 s samples, so replaying by time reproduces them exactly.
      expect(sim.samples.map((s) => [s.lat, s.lon])).toEqual(
        track.points.map((p) => [p.lat, p.lon]),
      );
      expect(expected(sim.samples, sim.pedometerSteps).flags).toEqual(spec.flags);
    });
  }

  it('the car track hides its speed and reports 60 steps', () => {
    const track = parseGpx(readFileSync(SAMPLE_TRACKS.carA1, 'utf8'));
    expect(track.hints).toEqual({ pedometerSteps: 60, reportSpeed: false });
    const sim = simulate(track);
    expect(sim.pedometerSteps).toBe(60);
    expect(sim.samples.every((s) => s.speed === null)).toBe(true);
  });

  it('the walking tracks report their pace and plausible steps', () => {
    for (const file of [SAMPLE_TRACKS.azuolynasLoop, SAMPLE_TRACKS.laisvesAlejaStraight]) {
      const sim = simulate(parseGpx(readFileSync(file, 'utf8')));
      expect(sim.samples.slice(1).every((s) => typeof s.speed === 'number' && s.speed < 5)).toBe(
        true,
      );
      expect(sim.pedometerSteps).toBeGreaterThan(sim.distanceM);
    }
  });
});
