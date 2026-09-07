/**
 * Weekly reckoning for one cell (`docs/territory-rules.md` "Weekly reckoning",
 * `plan.md` "Shared Rule Semantics" item 9). Pure: idempotency per week is the job's concern.
 */
import { RULES } from './config.js';
import type { FactionStrength, ReckonInput, ReckonResult } from './types.js';

/** Strengths below this are dropped from the result. */
export const MIN_TRACKED_STRENGTH = 0.001;

/**
 * `strength' = strength * DECAY + sum(cappedMeters) + sum(bonus meters)` per faction, then the
 * ownership table (all comparisons use the new strengths):
 *
 * | Situation | Owner |
 * |---|---|
 * | no faction >= MIN_STRENGTH_M | unclaimed |
 * | exact tie at the top (among factions >= MIN) | incumbent if it is still >= MIN, else unclaimed |
 * | no incumbent, or the incumbent leads | the leader |
 * | incumbent < MIN (it no longer holds the cell) | the leader; hysteresis does not apply |
 * | challenger >= incumbent * (1 + HYSTERESIS) | the challenger |
 * | otherwise | incumbent keeps |
 *
 * `captain` is the owning faction's top contributor by `cappedMeters` among contributions that
 * carry a `userId` (ties by `userId` ascending); bonuses do not count.
 */
export function reckonWeek(input: ReckonInput): ReckonResult {
  const totals = new Map<number, number>();
  const add = (factionId: number, value: number): void => {
    totals.set(factionId, (totals.get(factionId) ?? 0) + value);
  };
  for (const s of input.strengths) add(s.factionId, s.strength * RULES.DECAY);
  for (const c of input.contributions) add(c.factionId, c.cappedMeters);
  for (const b of input.bonuses) add(b.factionId, b.meters);

  const strengths: FactionStrength[] = [...totals.entries()]
    .filter(([, strength]) => strength >= MIN_TRACKED_STRENGTH)
    .map(([factionId, strength]) => ({ factionId, strength }))
    .sort((a, b) => a.factionId - b.factionId);

  const strengthOf = (factionId: number | null): number =>
    factionId === null ? 0 : (strengths.find((s) => s.factionId === factionId)?.strength ?? 0);
  const incumbent = input.owner;
  const incumbentHolds = incumbent !== null && strengthOf(incumbent) >= RULES.MIN_STRENGTH_M;

  const eligible = strengths.filter((s) => s.strength >= RULES.MIN_STRENGTH_M);
  let owner: number | null;
  if (eligible.length === 0) {
    owner = null;
  } else {
    let top = eligible[0]!.strength;
    for (const s of eligible) if (s.strength > top) top = s.strength;
    const leaders = eligible.filter((s) => s.strength === top);
    if (leaders.length > 1) {
      owner = incumbentHolds ? incumbent : null;
    } else {
      const leader = leaders[0]!.factionId;
      if (incumbent === null || leader === incumbent || !incumbentHolds) owner = leader;
      else if (top >= strengthOf(incumbent) * (1 + RULES.HYSTERESIS)) owner = leader;
      else owner = incumbent;
    }
  }

  const flipped = owner !== incumbent;
  let captain: string | null = null;
  let captainMeters = 0;
  if (owner !== null) {
    for (const c of input.contributions) {
      if (c.factionId !== owner || c.userId === undefined || c.cappedMeters <= 0) continue;
      if (
        captain === null ||
        c.cappedMeters > captainMeters ||
        (c.cappedMeters === captainMeters && c.userId < captain)
      ) {
        captain = c.userId;
        captainMeters = c.cappedMeters;
      }
    }
  }

  const result: ReckonResult = { strengths, owner, flipped, captain };
  if (flipped) result.event = { from: incumbent, to: owner };
  return result;
}
