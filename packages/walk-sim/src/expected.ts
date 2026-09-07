import {
  acceptSamples,
  pathLengthM,
  pathToHexMeters,
  simplifyPath,
  walkFlags,
  type RejectedSample,
  type Sample,
  type WalkFlag,
} from '@nature/territory-rules';

/** What the server must compute for a sample set (the oracle of the API integration tests). */
export interface Expected {
  acceptedSeqs: number[];
  rejected: RejectedSample[];
  flags: WalkFlag[];
  /** Haversine length of the simplified accepted path. */
  distanceM: number;
  simplifiedPointCount: number;
  /** Sorted by cell ascending. */
  hexes: { cell: string; meters: number }[];
}

/**
 * The `finishWalk` pipeline of `packages/territory-rules/README.md`, computed with the rules
 * package and nothing else: `acceptSamples` → `walkFlags` → `simplifyPath` → `pathLengthM` →
 * `pathToHexMeters`. Never contacts the network.
 */
export function expected(samples: readonly Sample[], pedometerSteps?: number | null): Expected {
  const { accepted, rejected } = acceptSamples(samples);
  const flags = walkFlags(accepted, pedometerSteps);
  const simplified = simplifyPath(accepted.map((s) => ({ lat: s.lat, lon: s.lon })));
  const path = simplified.length >= 2 ? simplified : [];
  return {
    acceptedSeqs: accepted.map((s) => s.seq),
    rejected,
    flags,
    distanceM: pathLengthM(path),
    simplifiedPointCount: path.length,
    hexes: pathToHexMeters(path).map((h) => ({ cell: h.cell, meters: h.meters })),
  };
}
