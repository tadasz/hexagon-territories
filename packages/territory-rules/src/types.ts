/** Shared types of the rules package (`specs/001-repo-foundations/data-model.md` section 2). */

/** WGS84 coordinate in decimal degrees. */
export interface LatLng {
  lat: number;
  lon: number;
}

/** One raw location sample as posted by the device. */
export interface Sample extends LatLng {
  seq: number;
  /** ISO 8601 timestamp (UTC). */
  ts: string;
  /** Horizontal accuracy in metres. */
  hAcc: number;
  /** Device-reported speed in m/s; absent or null when unknown. */
  speed?: number | null;
  /** Course over ground in degrees. */
  course?: number | null;
  /** Altitude in metres. */
  alt?: number | null;
}

export type RejectReason = 'accuracy' | 'speed' | 'non_monotonic';

export interface RejectedSample {
  seq: number;
  reason: RejectReason;
}

export interface AcceptResult {
  /** Accepted samples in ascending `seq` order. */
  accepted: Sample[];
  rejected: RejectedSample[];
}

export type WalkFlag = 'teleport' | 'speed' | 'distance' | 'no_steps';

/** Metres of path inside one H3 cell. */
export interface HexMeters {
  /** H3 index string (15 lowercase hex characters). */
  cell: string;
  meters: number;
}

/** Raw walking metres of one player for one faction in one cell (one week). */
export interface Contribution {
  cell: string;
  factionId: number;
  userId: string;
  meters: number;
}

export interface CappedContribution extends Contribution {
  /** `min(sum of meters of this (cell, faction, user), WEEKLY_CAP_M_PER_PLAYER_PER_CELL)`. */
  cappedMeters: number;
}

export interface FactionStrength {
  factionId: number;
  strength: number;
}

export interface ReckonContribution {
  factionId: number;
  cappedMeters: number;
  /** Optional; when present the owning faction's top contributor becomes `captain`. */
  userId?: string;
}

export interface ReckonBonus {
  factionId: number;
  meters: number;
}

/** State of one cell before the reckoning of one week, plus that week's inputs. */
export interface ReckonInput {
  cell: string;
  owner: number | null;
  strengths: FactionStrength[];
  contributions: ReckonContribution[];
  bonuses: ReckonBonus[];
}

export interface OwnershipEvent {
  from: number | null;
  to: number | null;
}

export interface ReckonResult {
  /** New strengths sorted by `factionId`; factions below 0.001 are dropped. */
  strengths: FactionStrength[];
  owner: number | null;
  flipped: boolean;
  /** Present only when `flipped`. */
  event?: OwnershipEvent;
  /**
   * Top contributor by `cappedMeters` among the owning faction's contributions that carry a
   * `userId` (ties broken by `userId` ascending); `null` when unclaimed or no such contribution.
   */
  captain: string | null;
}
