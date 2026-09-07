import { fileURLToPath } from 'node:url';

/** Absolute directory of the checked-in sample tracks (works from `src/` and from `dist/`). */
export const SAMPLES_DIR: string = fileURLToPath(new URL('../samples/', import.meta.url));

/** The three Kaunas tracks of specs/003-walk-tracking/research.md R15, as absolute paths. */
export const SAMPLE_TRACKS = {
  azuolynasLoop: `${SAMPLES_DIR}azuolynas-loop.gpx`,
  laisvesAlejaStraight: `${SAMPLES_DIR}laisves-aleja-straight.gpx`,
  carA1: `${SAMPLES_DIR}car-a1.gpx`,
} as const;

export type SampleTrackKey = keyof typeof SAMPLE_TRACKS;
