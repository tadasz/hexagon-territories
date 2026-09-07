/** Parent (res 8-5) ownership from child owners (`docs/territory-rules.md` "Parent ownership"). */
import { RULES } from './config.js';

/**
 * Owner = faction owning the most children if that count is `> PARENT_PLURALITY` (40 %) of the
 * claimed (non-null) children and at least `PARENT_MIN_CLAIMED_CHILDREN` (2) are claimed.
 * Ties for the most children -> `null`. No claimed children -> `null`.
 */
export function deriveParentOwner(childOwners: readonly (number | null)[]): number | null {
  const counts = new Map<number, number>();
  let claimed = 0;
  for (const owner of childOwners) {
    if (owner === null) continue;
    claimed++;
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  if (claimed < RULES.PARENT_MIN_CLAIMED_CHILDREN) return null;
  let leader: number | null = null;
  let leaderCount = 0;
  let tied = false;
  for (const [faction, count] of counts) {
    if (count > leaderCount) {
      leader = faction;
      leaderCount = count;
      tied = false;
    } else if (count === leaderCount) {
      tied = true;
    }
  }
  if (tied || leader === null) return null;
  return leaderCount / claimed > RULES.PARENT_PLURALITY ? leader : null;
}
