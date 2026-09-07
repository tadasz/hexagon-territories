import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import type { Clock } from '../../lib/time.js';
import { ACTIVE_PLAYER_WINDOW_DAYS, activeSince } from './rules.js';
import type { Faction, FactionsResponse } from './schemas.js';

type FactionStatsRow = {
  id: number;
  slug: string;
  name: string;
  emoji: string;
  color_light: string;
  color_dark: string;
  sort: number;
  members: string | number;
  active_members: string | number;
  hexes_owned_r9: string | number;
  hexes_owned_r7: string | number;
};

/**
 * One query for the faction list with live statistics (research.md R5): members and active
 * members from `users` (index-only via `users_faction_active_idx`), hexes owned from
 * `hex_state` / `hex_parent_state` (zero until the first reckoning of feature 004).
 */
export async function listFactionsWithStats(db: Db, clock: Clock): Promise<Faction[]> {
  const since = activeSince(clock);
  const result = await db.execute<FactionStatsRow>(sql`
    select f.id, f.slug, f.name, f.emoji, f.color_light, f.color_dark, f.sort,
           count(u.id) filter (where u.deleted_at is null) as members,
           count(u.id) filter (where u.deleted_at is null and u.last_seen_at >= ${since}) as active_members,
           (select count(*) from hex_state h where h.owner_faction_id = f.id) as hexes_owned_r9,
           (select count(*) from hex_parent_state p where p.res = 7 and p.owner_faction_id = f.id) as hexes_owned_r7
    from factions f
    left join users u on u.faction_id = f.id
    group by f.id
    order by f.sort, f.id
  `);
  return result.rows.map((row) => ({
    id: Number(row.id),
    slug: row.slug,
    name: row.name,
    emoji: row.emoji,
    colorLight: row.color_light,
    colorDark: row.color_dark,
    sort: Number(row.sort),
    stats: {
      members: Number(row.members),
      activeMembers: Number(row.active_members),
      hexesOwnedR9: Number(row.hexes_owned_r9),
      hexesOwnedR7: Number(row.hexes_owned_r7),
    },
  }));
}

/** Fewest active members, ties broken by the lowest id (plan.md Shared Semantics 5). */
export function pickSuggestedFaction(factions: readonly Faction[]): number {
  let best: Faction | undefined;
  for (const faction of factions) {
    if (
      best === undefined ||
      faction.stats.activeMembers < best.stats.activeMembers ||
      (faction.stats.activeMembers === best.stats.activeMembers && faction.id < best.id)
    ) {
      best = faction;
    }
  }
  if (!best) throw new Error('no factions are seeded');
  return best.id;
}

export async function getFactionsResponse(db: Db, clock: Clock): Promise<FactionsResponse> {
  const factions = await listFactionsWithStats(db, clock);
  return {
    factions,
    suggestedFactionId: pickSuggestedFaction(factions),
    activeWindowDays: ACTIVE_PLAYER_WINDOW_DAYS,
  };
}

/** Reused by `GET /v1/me` and the sign-in response. */
export async function suggestedFactionId(db: Db, clock: Clock): Promise<number> {
  return pickSuggestedFaction(await listFactionsWithStats(db, clock));
}
