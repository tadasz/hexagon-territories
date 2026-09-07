#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { Command, InvalidArgumentError, type Command as CommandType } from 'commander';
import { expected } from './expected.js';
import { ReplayError, replay } from './replay.js';
import { generateSampleFiles } from './sample-tracks.js';
import { deltaToEndAt, shiftSamples, simulate, type SimulateOptions } from './simulate.js';
import { detectFormat, parseTrack, type Track } from './track.js';

const VERSION = '0.1.0';

function num(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new InvalidArgumentError('expected a number');
  return n;
}

interface DistortionFlags {
  speed?: number;
  jitter?: number;
  accuracy?: number;
  teleport?: boolean;
  spoofNoSteps?: boolean;
  steps?: number;
  reportSpeed?: boolean;
  seed?: number;
  startAt?: string;
  sampleEvery?: number;
}

function withDistortionFlags(cmd: CommandType): CommandType {
  return cmd
    .option(
      '--speed <mps>',
      'resample at a constant pace in m/s (default: the track timestamps, else 1.4)',
      num,
    )
    .option('--jitter <m>', 'Gaussian GPS jitter σ in metres (default 0)', num)
    .option('--accuracy <m>', 'reported horizontal accuracy in metres (default 8)', num)
    .option('--teleport', 'insert one 400 m jump at the midpoint')
    .option('--spoof-no-steps', 'report 0 pedometer steps')
    .option('--steps <n>', 'pedometer total (default: 1.3 per metre, or the track hint)', num)
    .option('--no-report-speed', 'hide the device speed (a spoofed device)')
    .option('--seed <n>', 'PRNG seed for jitter (default 20260907)', num)
    .option('--start-at <iso>', 'timestamp of the first sample')
    .option('--sample-every <s>', 'seconds between samples (default 5)', num);
}

export function simulateOptionsFromFlags(flags: DistortionFlags): SimulateOptions {
  const opts: SimulateOptions = {};
  if (flags.speed !== undefined) opts.speedMps = flags.speed;
  if (flags.jitter !== undefined) opts.jitterM = flags.jitter;
  if (flags.accuracy !== undefined) opts.accuracyM = flags.accuracy;
  if (flags.teleport) opts.teleport = true;
  if (flags.spoofNoSteps) opts.spoofNoSteps = true;
  if (flags.steps !== undefined) opts.pedometerSteps = flags.steps;
  if (flags.reportSpeed === false) opts.reportSpeed = false;
  if (flags.seed !== undefined) opts.seed = flags.seed;
  if (flags.startAt !== undefined) opts.startAt = flags.startAt;
  if (flags.sampleEvery !== undefined) opts.sampleEveryS = flags.sampleEvery;
  return opts;
}

/**
 * `pnpm --filter @nature/walk-sim …` runs in the package directory; a relative path that does
 * not exist there is retried against `INIT_CWD` (where pnpm was invoked), so repository-relative
 * paths such as `packages/walk-sim/samples/azuolynas-loop.gpx` work from the root.
 */
export function resolveTrackPath(file: string, env: NodeJS.ProcessEnv = process.env): string {
  if (isAbsolute(file) || existsSync(file)) return file;
  const initCwd = env.INIT_CWD;
  if (initCwd) {
    const candidate = resolve(initCwd, file);
    if (existsSync(candidate)) return candidate;
  }
  return file;
}

function loadTrack(file: string): Track {
  const path = resolveTrackPath(file);
  return parseTrack(readFileSync(path, 'utf8'), detectFormat(path));
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function buildProgram(): CommandType {
  const program = new Command();
  program
    .name('walk-sim')
    .description(
      'Replay GPX/GeoJSON tracks as Nature Explorer walks, or print the expected scoring',
    )
    .version(VERSION);

  withDistortionFlags(
    program
      .command('dry-run')
      .argument('<file>', 'GPX or GeoJSON track')
      .description(
        'Print the expected accepted samples, flags, distance and per-hex metres (no network)',
      )
      .option('--json', 'print JSON (default: a short summary)'),
  ).action((file: string, flags: DistortionFlags & { json?: boolean }) => {
    const sim = simulate(loadTrack(file), simulateOptionsFromFlags(flags));
    const exp = expected(sim.samples, sim.pedometerSteps);
    const out = { ...exp, sampleCount: sim.samples.length, pedometerSteps: sim.pedometerSteps };
    if (flags.json) {
      print(out);
      return;
    }
    process.stdout.write(
      [
        `samples ${String(out.sampleCount)} (accepted ${String(out.acceptedSeqs.length)}, rejected ${String(out.rejected.length)})`,
        `flags ${out.flags.length ? out.flags.join(',') : 'none'}; steps ${String(out.pedometerSteps)}`,
        `distance ${out.distanceM.toFixed(1)} m over ${String(out.hexes.length)} cells`,
        ...out.hexes.map((h) => `  ${h.cell} ${h.meters.toFixed(1)} m`),
        '',
      ].join('\n'),
    );
  });

  withDistortionFlags(
    program
      .command('replay')
      .argument('<file>', 'GPX or GeoJSON track')
      .description('Create a walk, upload the samples in batches and finish it against an API')
      .requiredOption('--base-url <url>', 'API base URL, e.g. http://localhost:3000')
      .requiredOption('--token <token>', 'bearer access token')
      .option('--no-finish', 'leave the walk active (no finish request)')
      .option('--rate <n>', '0 = as fast as possible, 1 = real time, N = N× faster', num, 0)
      .option('--batch-size <n>', 'samples per batch (≤ 200)', num, 200)
      .option('--client-walk-id <uuid>', 'idempotency key (random by default)')
      .option('--json', 'print the result as JSON'),
  ).action(
    async (
      file: string,
      flags: DistortionFlags & {
        baseUrl: string;
        token: string;
        finish: boolean;
        rate: number;
        batchSize: number;
        clientWalkId?: string;
        json?: boolean;
      },
    ) => {
      const sim = simulate(loadTrack(file), simulateOptionsFromFlags(flags));
      // Unless --start-at pins the clock, re-time the track to end a second ago: the server
      // clamps startedAt to the last 12 h and refuses an endedAt before it.
      const samples =
        flags.startAt === undefined
          ? shiftSamples(sim.samples, deltaToEndAt(sim.samples, new Date(Date.now() - 1_000)))
          : sim.samples;
      const exp = expected(samples, sim.pedometerSteps);
      try {
        const result = await replay(samples, sim.pedometerSteps, {
          baseUrl: flags.baseUrl,
          token: flags.token,
          batchSize: flags.batchSize,
          rate: flags.rate,
          finish: flags.finish,
          ...(flags.clientWalkId ? { clientWalkId: flags.clientWalkId } : {}),
          deviceInfo: { model: 'walk-sim', appVersion: VERSION },
          onProgress: flags.json ? undefined : (line) => process.stderr.write(`${line}\n`),
        });
        if (flags.json) {
          print({ ...result, expected: exp });
          return;
        }
        const s = result.summary;
        process.stdout.write(
          [
            `walk ${result.walkId} (${result.created.status}${result.created.supersededWalkId ? `, superseded ${result.created.supersededWalkId}` : ''})`,
            `batches ${String(result.batches.length)}: stored ${String(result.batches.reduce((a, b) => a + b.stored, 0))}, duplicates ${String(result.batches.reduce((a, b) => a + b.duplicates, 0))}`,
            s
              ? `summary: ${s.status} (${s.finishReason ?? '-'}) week ${s.weekId ?? '-'}, ${s.distanceM.toFixed(1)} m, ${String(s.durationS)} s, ${String(s.hexCount)} hexes, ${String(s.xp)} XP, flags ${s.flags.length ? s.flags.join(',') : 'none'}`
              : 'not finished (--no-finish)',
            ...(s
              ? s.hexes.map(
                  (h) =>
                    `  ${h.h3} ${h.meters.toFixed(1)} m (counted ${h.cappedMeters.toFixed(1)} m, leader ${String(h.weekStanding.leader ?? '-')}, share ${h.weekStanding.myFactionShare.toFixed(3)})`,
                )
              : []),
            `expected (dry-run): ${exp.distanceM.toFixed(1)} m over ${String(exp.hexes.length)} cells, flags ${exp.flags.length ? exp.flags.join(',') : 'none'}`,
            '',
          ].join('\n'),
        );
      } catch (err) {
        if (err instanceof ReplayError) {
          process.stderr.write(`${err.request} failed with ${String(err.status)}\n`);
          process.stderr.write(`${JSON.stringify(err.body, null, 2)}\n`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
    },
  );

  program
    .command('samples:generate')
    .description('Regenerate the checked-in sample tracks (seed 20260907) into samples/')
    .option('--dir <dir>', 'target directory (default: the package samples/ directory)')
    .action((flags: { dir?: string }) => {
      const reports = generateSampleFiles(flags.dir);
      for (const r of reports) {
        process.stdout.write(
          `${r.file}: ${String(r.sampleCount)} samples, ${String(r.distanceM)} m, ${String(r.cells)} cells, flags ${r.flags.length ? r.flags.join(',') : 'none'}\n`,
        );
      }
    });

  return program;
}

const isMain = process.argv[1] !== undefined && /cli\.(ts|js)$/.test(process.argv[1]);
if (isMain) {
  await buildProgram().parseAsync(process.argv);
}
