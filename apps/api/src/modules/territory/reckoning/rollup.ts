import { sql } from 'drizzle-orm';
import type { DbLike } from '../../../db/client.js';
import { LEADERBOARD_TOP_N } from '../limits.js';

/**
 * Stage `rollup` (specs/004-weekly-reckoning/research.md R14, plan.md Shared Semantics 7):
 * delete-then-insert per week so the stage is idempotent and resumable.
 */

/**
 * `leaderboard_snapshots` for the week: scope `global` (`scope_id = ''`) and one `faction` scope
 * per faction (players ranked by the metres they earned for that faction). `meters` = Σ
 * `capped_meters`, ties by `user_id` ascending, `points` = Σ `points_ledger.points` of the week
 * (all kinds). Returns the number of rows written.
 */
export async function snapshotLeaderboards(
  db: DbLike,
  weekId: string,
  now: Date,
  topN: number = LEADERBOARD_TOP_N,
): Promise<number> {
  await db.execute(sql`
    delete from leaderboard_snapshots where week_id = ${weekId} and scope in ('global', 'faction')
  `);
  const result = await db.execute(sql`
    with points as (
      select user_id, sum(points)::integer as points from points_ledger
      where week_id = ${weekId} group by user_id
    ),
    global_meters as (
      select user_id, sum(capped_meters)::real as meters from hex_week_contribution
      where week_id = ${weekId} group by user_id having sum(capped_meters) > 0
    ),
    global_ranked as (
      select 'global'::text as scope, ''::text as scope_id, user_id, meters,
             row_number() over (order by meters desc, user_id asc) as rank
      from global_meters
    ),
    faction_meters as (
      select faction_id, user_id, sum(capped_meters)::real as meters from hex_week_contribution
      where week_id = ${weekId} group by faction_id, user_id having sum(capped_meters) > 0
    ),
    faction_ranked as (
      select 'faction'::text as scope, faction_id::text as scope_id, user_id, meters,
             row_number() over (partition by faction_id order by meters desc, user_id asc) as rank
      from faction_meters
    ),
    ranked as (
      select * from global_ranked union all select * from faction_ranked
    )
    insert into leaderboard_snapshots (week_id, scope, scope_id, rank, user_id, meters, points, computed_at)
    select ${weekId}, r.scope, r.scope_id, r.rank, r.user_id, r.meters, coalesce(p.points, 0), ${now}
    from ranked r left join points p on p.user_id = r.user_id
    where r.rank <= ${topN}
  `);
  return result.rowCount ?? 0;
}

/**
 * `faction_stats_weekly` for the week, one row per faction: hexes owned at res 9 and res 7
 * (current state after the cells stage), Σ `capped_meters`, distinct contributors, verified
 * captures of the week (0 until feature 006).
 */
export async function snapshotFactionStats(db: DbLike, weekId: string): Promise<number> {
  await db.execute(sql`delete from faction_stats_weekly where week_id = ${weekId}`);
  const result = await db.execute(sql`
    insert into faction_stats_weekly (week_id, faction_id, hexes_owned_r9, hexes_owned_r7, meters, active_users, captures)
    select
      ${weekId},
      f.id,
      (select count(*) from hex_state s where s.owner_faction_id = f.id),
      (select count(*) from hex_parent_state p where p.res = 7 and p.owner_faction_id = f.id),
      coalesce((select sum(c.capped_meters) from hex_week_contribution c
                where c.week_id = ${weekId} and c.faction_id = f.id), 0),
      (select count(distinct c.user_id) from hex_week_contribution c
       where c.week_id = ${weekId} and c.faction_id = f.id),
      (select count(*) from captures x
       where x.week_id = ${weekId} and x.status = 'verified' and x.faction_id = f.id)
    from factions f
    order by f.id
  `);
  return result.rowCount ?? 0;
}
