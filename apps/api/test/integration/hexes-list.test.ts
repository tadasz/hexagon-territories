import { RULES } from '@nature/territory-rules';
import { cellToLatLng, cellToParent, gridDisk, polygonToCells } from 'h3-js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { hexFactionStrength, hexWeekContribution } from '../../src/db/schema/index.js';
import { cellToBigInt } from '../../src/lib/h3.js';
import { HEX_BBOX_MAX_CELLS, HEXES_RATE_PER_MIN } from '../../src/modules/territory/limits.js';
import type { HexList } from '../../src/modules/territory/schemas.js';
import { bearerFor } from '../helpers/auth.js';
import { describeWithDb } from '../helpers/db.js';
import { createIntegrationHarness, type IntegrationHarness } from '../helpers/integration.js';
import { seedParents, seedStates, seedUser } from '../helpers/reckoning.js';

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/** The bounding box of the cell centres, padded a little. */
function boxAround(cells: readonly string[], pad = 0.0005): string {
  const centres = cells.map((c) => cellToLatLng(c));
  const lats = centres.map((c) => c[0]);
  const lons = centres.map((c) => c[1]);
  return [
    Math.min(...lons) - pad,
    Math.min(...lats) - pad,
    Math.max(...lons) + pad,
    Math.max(...lats) + pad,
  ].join(',');
}

describeWithDb('GET /v1/hexes (FR-010, FR-011, SC-004)', () => {
  let h: IntegrationHarness;
  let headers: { authorization: string };
  // 37 cells around Ąžuolynas (k = 3) — nothing else lives in this corner of the database
  const CENTRE = '891f40d1a4fffff';
  const cluster = gridDisk(CENTRE, 3).sort();
  const contested = cluster[5]!;
  const unclaimed = cluster[6]!;
  const parentsR7 = [...new Set(cluster.map((c) => cellToParent(c, 7)))].sort();

  beforeAll(async () => {
    h = await createIntegrationHarness({ now: '2026-09-09T10:00:00.000Z' }); // W37
    const me = await seedUser(h.tdb, 'lister', 1);
    const rival = await seedUser(h.tdb, 'rival', 2);
    headers = await bearerFor(h, me);
    await seedStates(
      h.tdb,
      cluster.map((cell) => ({
        cell,
        owner: cell === unclaimed ? null : cell === contested ? 1 : 2,
        ownerSince: cell === unclaimed ? null : '2026-W35',
      })),
    );
    // contested: owner 1 with strength 1 000, faction 2 earned 700 m this week (700 > 500)
    await h.tdb.db.insert(hexFactionStrength).values([
      { h3R9: cellToBigInt(contested), factionId: 1, strength: 1000, lastReckonedWeek: '2026-W36' },
      {
        h3R9: cellToBigInt(cluster[0]!),
        factionId: 2,
        strength: 800,
        lastReckonedWeek: '2026-W36',
      },
    ]);
    await h.tdb.db.insert(hexWeekContribution).values({
      h3R9: cellToBigInt(contested),
      weekId: '2026-W37',
      factionId: 2,
      userId: rival,
      meters: 700,
      cappedMeters: 700,
      walks: 1,
    });
    await seedParents(
      h.tdb,
      parentsR7.map((h3, i) => {
        const counts: Record<string, number> = i === 0 ? { '2': 5 } : {};
        return { h3, res: 7, owner: i === 0 ? 2 : null, counts };
      }),
    );
  });
  afterAll(async () => {
    await h?.close();
  });

  it('returns exactly the state rows of the box at res 9, sorted, with owner, ownerSince, pressure and contested', async () => {
    const res = await h.app.inject({
      url: `/v1/hexes?res=9&bbox=${boxAround(cluster)}`,
      headers,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=30');
    const body = res.json<HexList>();
    expect(body.weekId).toBe('2026-W37');
    expect(body.res).toBe(9);
    expect(body.items.map((i) => i.h3)).toEqual(cluster);
    const c = body.items.find((i) => i.h3 === contested)!;
    expect(c).toEqual({
      h3: contested,
      res: 9,
      owner: 1,
      ownerSince: '2026-W35',
      pressureLeader: 2,
      contested: true,
    });
    const first = body.items.find((i) => i.h3 === cluster[0])!;
    expect(first).toEqual({
      h3: cluster[0],
      res: 9,
      owner: 2,
      ownerSince: '2026-W35',
      pressureLeader: 2,
      contested: false,
    });
    const empty = body.items.find((i) => i.h3 === unclaimed)!;
    expect(empty).toEqual({
      h3: unclaimed,
      res: 9,
      owner: null,
      ownerSince: null,
      pressureLeader: null,
      contested: false,
    });
    // the pressure of the contested cell is 1000 × DECAY = 500 vs 700
    expect(1000 * RULES.DECAY).toBeLessThan(700);
    // a box away from the cluster is empty
    const elsewhere = await h.app.inject({
      url: '/v1/hexes?res=9&bbox=25.2,55.6,25.3,55.7',
      headers,
    });
    expect(elsewhere.json<HexList>().items).toEqual([]);
  });

  it('answers res 5–8 from the materialised parents with no pressure', async () => {
    const res = await h.app.inject({
      url: `/v1/hexes?res=7&bbox=${boxAround(cluster, 0.02)}`,
      headers,
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<HexList>();
    expect(body.res).toBe(7);
    expect(body.items.map((i) => i.h3)).toEqual(parentsR7);
    expect(body.items[0]).toEqual({
      h3: parentsR7[0],
      res: 7,
      owner: 2,
      ownerSince: null,
      pressureLeader: null,
      contested: false,
    });
    for (const item of body.items.slice(1)) {
      expect(item).toMatchObject({ res: 7, owner: null, pressureLeader: null, contested: false });
    }
    for (const r of [5, 6, 8]) {
      const other = await h.app.inject({
        url: `/v1/hexes?res=${String(r)}&bbox=${boxAround(cluster)}`,
        headers,
      });
      expect(other.statusCode, other.body).toBe(200);
      expect(other.json<HexList>().items).toEqual([]);
    }
  });

  it('refuses a box estimated to hold more than the cap, naming the limit and the estimate', async () => {
    const res = await h.app.inject({ url: '/v1/hexes?res=9&bbox=20,53,27,57', headers });
    expect(res.statusCode).toBe(400);
    const body = res.json<ErrorBody>();
    expect(body.error.code).toBe('BBOX_TOO_LARGE');
    expect(body.error.details).toMatchObject({ res: 9, maxCells: HEX_BBOX_MAX_CELLS });
    expect(Number(body.error.details?.estimatedCells)).toBeGreaterThan(HEX_BBOX_MAX_CELLS);
    expect(body.error.message).toContain(String(HEX_BBOX_MAX_CELLS));
    // the same box at res 5 is a few hundred cells and allowed
    const coarse = await h.app.inject({ url: '/v1/hexes?res=5&bbox=20,53,27,57', headers });
    expect(coarse.statusCode, coarse.body).toBe(200);
  });

  it('validates the resolution and the box shape naming the field', async () => {
    const cases: [string, string][] = [
      ['res=4&bbox=23.85,54.87,23.98,54.93', 'res'],
      ['res=10&bbox=23.85,54.87,23.98,54.93', 'res'],
      ['bbox=23.85,54.87,23.98,54.93', 'res'],
      ['res=9', 'bbox'],
      ['res=9&bbox=23.98,54.87,23.85,54.93', 'bbox'],
      ['res=9&bbox=23.85,54.93,23.98,54.87', 'bbox'],
      ['res=9&bbox=179,60,-179,61', 'bbox'],
      ['res=9&bbox=0,-91,1,0', 'bbox'],
      ['res=9&bbox=a,b,c,d', 'bbox'],
      ['res=9&bbox=1,2,3', 'bbox'],
    ];
    for (const [query, field] of cases) {
      const res = await h.app.inject({ url: `/v1/hexes?${query}`, headers });
      expect(res.statusCode, query).toBe(400);
      const body = res.json<ErrorBody>();
      expect(body.error.code, query).toBe('VALIDATION_FAILED');
      expect(body.error.details?.field, query).toBe(field);
    }
  });

  it('needs a bearer token and is rate limited per player', async () => {
    const anonymous = await h.app.inject({ url: `/v1/hexes?res=9&bbox=${boxAround(cluster)}` });
    expect(anonymous.statusCode).toBe(401);
    const limited = await bearerFor(h, await seedUser(h.tdb, 'rate-limited', 3));
    let last = 0;
    for (let i = 0; i < HEXES_RATE_PER_MIN; i += 1) {
      const res = await h.app.inject({
        url: '/v1/hexes?res=9&bbox=25.2,55.6,25.3,55.7',
        headers: limited,
      });
      last = res.statusCode;
    }
    expect(last).toBe(200);
    const over = await h.app.inject({
      url: '/v1/hexes?res=9&bbox=25.2,55.6,25.3,55.7',
      headers: limited,
    });
    expect(over.statusCode).toBe(429);
    expect(over.json<ErrorBody>().error.code).toBe('RATE_LIMITED');
    expect(over.headers['retry-after']).toBeDefined();
    // other players are not affected
    const mine = await h.app.inject({ url: '/v1/hexes?res=9&bbox=25.2,55.6,25.3,55.7', headers });
    expect(mine.statusCode).toBe(200);
  });

  it('answers a full box of about 3 000 cells in under 300 ms (SC-004)', async () => {
    // a box of ~300 km² north of Kaunas: ~2 900 res-9 cells, all seeded with owners and pressure
    const box = { minLon: 23.8, minLat: 55.05, maxLon: 24.1, maxLat: 55.17 };
    const ring = [
      [box.minLat, box.minLon],
      [box.minLat, box.maxLon],
      [box.maxLat, box.maxLon],
      [box.maxLat, box.minLon],
    ];
    const cells = polygonToCells(ring, 9);
    expect(cells.length).toBeGreaterThan(2500);
    expect(cells.length).toBeLessThanOrEqual(HEX_BBOX_MAX_CELLS);
    const walker = await seedUser(h.tdb, 'big-walker', 3);
    await seedStates(
      h.tdb,
      cells.map((cell, i) => ({ cell, owner: (i % 3) + 1, ownerSince: '2026-W36' })),
    );
    const ids = cells.map((c) => cellToBigInt(c));
    await h.tdb.db.insert(hexFactionStrength).values(
      ids.flatMap((h3R9, i) => [
        { h3R9, factionId: (i % 3) + 1, strength: 900, lastReckonedWeek: '2026-W36' },
        { h3R9, factionId: ((i + 1) % 3) + 1, strength: 300, lastReckonedWeek: '2026-W36' },
      ]),
    );
    await h.tdb.db.insert(hexWeekContribution).values(
      ids.map((h3R9) => ({
        h3R9,
        weekId: '2026-W37',
        factionId: 3,
        userId: walker,
        meters: 600,
        cappedMeters: 600,
        walks: 1,
      })),
    );
    const url = `/v1/hexes?res=9&bbox=${box.minLon},${box.minLat},${box.maxLon},${box.maxLat}`;
    const durations: number[] = [];
    let count = 0;
    for (let i = 0; i < 5; i += 1) {
      const started = performance.now();
      const res = await h.app.inject({ url, headers });
      durations.push(performance.now() - started);
      expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
      count = res.json<HexList>().items.length;
    }
    durations.sort((a, b) => a - b);
    const median = durations[Math.floor(durations.length / 2)]!;
    console.info(
      `SC-004: GET /v1/hexes ${String(count)} cells — median ${median.toFixed(0)} ms, max ${durations[durations.length - 1]!.toFixed(0)} ms`,
    );
    expect(count).toBe(cells.length);
    expect(median).toBeLessThan(300);
  });
});
