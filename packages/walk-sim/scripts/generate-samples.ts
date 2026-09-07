/**
 * Writes packages/walk-sim/samples/*.gpx deterministically (seed 20260907; research.md R15):
 *
 *   pnpm --filter @nature/walk-sim samples:generate
 *
 * The geometry and the assertions (loop ≥ 4 cells and no flags, straight walk ≥ 5 cells and no
 * flags, car track flags teleport/speed/no_steps) live in src/sample-tracks.ts so the CLI's
 * `samples:generate` subcommand and test/samples.test.ts share them; this script is the entry
 * point named by tasks.md T005. It refuses to write when an assertion fails.
 */
import { generateSampleFiles } from '../src/sample-tracks.js';

for (const r of generateSampleFiles()) {
  console.log(
    `${r.file}: ${String(r.sampleCount)} samples, ${String(r.distanceM)} m, ${String(r.cells)} cells, flags ${r.flags.length ? r.flags.join(',') : 'none'}`,
  );
}
