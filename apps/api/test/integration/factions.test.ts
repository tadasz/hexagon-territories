import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { hexParentState, hexState, users } from '../../src/db/schema/index.js';
import type { FactionsResponse } from '../../src/modules/factions/schemas.js';
import { describeWithDb } from '../helpers/db.js';
import { createIntegrationHarness, type IntegrationHarness } from '../helpers/integration.js';

const POLYGON_WKT =
  'POLYGON((23.884 54.895,23.888 54.895,23.888 54.898,23.884 54.898,23.884 54.895))';

describeWithDb('GET /v1/factions (SC-003 scenarios)', () => {
  let h: IntegrationHarness;

  beforeAll(async () => {
    h = await createIntegrationHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  beforeEach(async () => {
    await h.tdb.db.delete(hexState);
    await h.tdb.db.delete(hexParentState);
    await h.tdb.db.delete(users);
  });

  async function seedUser(
    sub: string,
    factionId: number | null,
    lastSeenDaysAgo: number | null,
    deleted = false,
  ) {
    const now = h.clock.now();
    await h.tdb.db.insert(users).values({
      appleSub: sub,
      displayName: sub,
      factionId,
      lastSeenAt:
        lastSeenDaysAgo === null ? null : new Date(now.getTime() - lastSeenDaysAgo * 86_400_000),
      deletedAt: deleted ? now : null,
    });
  }

  async function factions(): Promise<FactionsResponse> {
    const res = await h.app.inject({ url: '/v1/factions' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    return res.json<FactionsResponse>();
  }

  it('needs no session and answers zeros with Owls suggested in an empty world', async () => {
    const body = await factions();
    expect(body.suggestedFactionId).toBe(1);
    expect(body.activeWindowDays).toBe(14);
    expect(body.factions.map((f) => [f.id, f.slug, f.name, f.emoji, f.sort])).toEqual([
      [1, 'owls', 'Owls', '🦉', 1],
      [2, 'foxes', 'Foxes', '🦊', 2],
      [3, 'deer', 'Deer', '🦌', 3],
    ]);
    for (const faction of body.factions) {
      expect(faction.stats).toEqual({
        members: 0,
        activeMembers: 0,
        hexesOwnedR9: 0,
        hexesOwnedR7: 0,
      });
      expect(faction.colorLight).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(faction.colorDark).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('suggests the faction with the fewest active players', async () => {
    // Owls 2 active, Foxes 3 active, Deer 1 active (+ 1 inactive, + 1 deleted)
    await seedUser('o1', 1, 0);
    await seedUser('o2', 1, 13);
    await seedUser('f1', 2, 1);
    await seedUser('f2', 2, 2);
    await seedUser('f3', 2, 3);
    await seedUser('d1', 3, 5);
    await seedUser('d2', 3, 15); // inactive: outside the 14-day window
    await seedUser('d3', 3, 0, true); // deleted: neither member nor active
    await seedUser('none', null, 0); // no faction: counted nowhere

    const body = await factions();
    expect(body.suggestedFactionId).toBe(3);
    expect(body.factions.map((f) => [f.id, f.stats.members, f.stats.activeMembers])).toEqual([
      [1, 2, 2],
      [2, 3, 3],
      [3, 2, 1],
    ]);
  });

  it('breaks ties by the lowest faction id', async () => {
    await seedUser('o1', 1, 1);
    await seedUser('f1', 2, 1);
    await seedUser('f2', 2, 1);
    await seedUser('d1', 3, 1);
    const body = await factions();
    expect(body.suggestedFactionId).toBe(1);
    expect(body.factions.map((f) => f.stats.activeMembers)).toEqual([1, 2, 1]);
  });

  it('treats members seen exactly 14 days ago as active and null last_seen as inactive', async () => {
    await seedUser('edge', 2, 14);
    await seedUser('never', 2, null);
    const body = await factions();
    expect(body.factions[1]?.stats).toMatchObject({ members: 2, activeMembers: 1 });
  });

  it('suggests Owls when nobody was active for 14 days', async () => {
    await seedUser('o1', 1, 20);
    await seedUser('f1', 2, 30);
    await seedUser('d1', 3, 40);
    const body = await factions();
    expect(body.suggestedFactionId).toBe(1);
    expect(body.factions.map((f) => f.stats.activeMembers)).toEqual([0, 0, 0]);
  });

  it('counts hexes owned at resolution 9 and 7 per faction', async () => {
    const base = BigInt('0x891f1d4a2c3ffff');
    for (let i = 0; i < 3; i += 1) {
      await h.tdb.db.insert(hexState).values({
        h3R9: base + BigInt(i),
        h3R8: BigInt('0x881f1d4a2dfffff'),
        h3R7: BigInt('0x871f1d4a2ffffff'),
        h3R6: BigInt('0x861f1d4afffffff'),
        h3R5: BigInt('0x851f1d4bfffffff'),
        geom: POLYGON_WKT,
        ownerFactionId: i === 2 ? 3 : 2,
      });
    }
    await h.tdb.db.insert(hexParentState).values([
      { h3: BigInt('0x871f1d4a2ffffff'), res: 7, geom: POLYGON_WKT, ownerFactionId: 2 },
      { h3: BigInt('0x861f1d4afffffff'), res: 6, geom: POLYGON_WKT, ownerFactionId: 2 },
      { h3: BigInt('0x871f1d4a3ffffff'), res: 7, geom: POLYGON_WKT, ownerFactionId: null },
    ]);

    const body = await factions();
    expect(body.factions.map((f) => [f.id, f.stats.hexesOwnedR9, f.stats.hexesOwnedR7])).toEqual([
      [1, 0, 0],
      [2, 2, 1],
      [3, 1, 0],
    ]);
    // nothing here writes hex_state.owner_faction_id (Constitution II): the seeded rows are untouched
    const rows = await h.tdb.db
      .select({ owner: hexState.ownerFactionId })
      .from(hexState)
      .where(eq(hexState.h3R9, base));
    expect(rows[0]?.owner).toBe(2);
  });
});
