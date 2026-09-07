/**
 * The walk endpoints' wire shapes (specs/003-walk-tracking/contracts/openapi.yaml), mirrored
 * here because the API package depends on this one, not the other way round.
 */
export interface WalkCreated {
  walkId: string;
  clientWalkId: string;
  startedAt: string;
  status: 'active';
  supersededWalkId: string | null;
}

export interface SampleBatchResult {
  stored: number;
  duplicates: number;
  accepted: number[];
  rejected: { seq: number; reason: 'accuracy' | 'speed' | 'non_monotonic' }[];
  sampleCount: number;
}

export interface WeekStanding {
  leader: number | null;
  myFactionShare: number;
  owner: number | null;
}

export interface WalkHex {
  h3: string;
  meters: number;
  cappedMeters: number;
  weekStanding: WeekStanding;
}

export interface LineString {
  type: 'LineString';
  coordinates: [number, number][];
}

export interface WalkSummary {
  walkId: string;
  clientWalkId: string;
  status: 'active' | 'finished' | 'flagged' | 'abandoned';
  finishReason: 'client' | 'autofinish' | 'superseded' | null;
  startedAt: string;
  endedAt: string | null;
  finishedAt: string | null;
  weekId: string | null;
  distanceM: number;
  durationS: number;
  steps: number | null;
  sampleCount: number;
  hexCount: number;
  xp: number;
  scored: boolean;
  flags: ('teleport' | 'speed' | 'distance' | 'no_steps')[];
  hexes: WalkHex[];
  path: LineString | null;
}

export interface ErrorEnvelope {
  error: { code: string; message: string; details?: Record<string, unknown> };
  requestId: string;
}
