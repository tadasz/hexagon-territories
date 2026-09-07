import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { users } from '../../src/db/schema/index.js';
import type { Me } from '../../src/modules/me/schemas.js';
import { bearerFor, signInTestUser, type SignedInUser } from '../helpers/auth.js';
import { describeWithDb } from '../helpers/db.js';
import { createIntegrationHarness, type IntegrationHarness } from '../helpers/integration.js';

describeWithDb('/v1/me profile and faction routes', () => {
  let h: IntegrationHarness;
  let user: SignedInUser;

  beforeAll(async () => {
    h = await createIntegrationHarness();
    user = await signInTestUser(h.app, h.apple, {
      sub: 'me-user',
      email: 'me@example.com',
      name: 'Tadas',
      clock: h.clock,
    });
  });
  afterAll(async () => {
    await h?.close();
  });

  const headers = () => bearerFor(h, user.userId);

  async function me(): Promise<Me> {
    const res = await h.app.inject({ url: '/v1/me', headers: await headers() });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<Me>();
  }

  async function selectFaction(factionId: number) {
    return h.app.inject({
      method: 'POST',
      url: '/v1/me/faction',
      headers: await headers(),
      payload: { factionId },
    });
  }

  async function patchName(displayName: string) {
    return h.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: await headers(),
      payload: { displayName },
    });
  }

  it('returns the profile without the e-mail and requires a session', async () => {
    const profile = await me();
    expect(profile).toEqual({
      id: user.userId,
      displayName: 'Tadas',
      factionId: null,
      factionChangedAt: null,
      factionChangeAvailableAt: null,
      xp: 0,
      level: 1,
      role: 'player',
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as string,
      suggestedFactionId: 1,
    });
    expect(JSON.stringify(profile)).not.toContain('email');
    expect(JSON.stringify(profile)).not.toContain('me@example.com');

    const anonymous = await h.app.inject({ url: '/v1/me' });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('updates the display name trimmed and rejects rule violations with field and rule', async () => {
    const ok = await patchName('  Ąžuolas  ');
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json<Me>().displayName).toBe('Ąžuolas');
    expect((await me()).displayName).toBe('Ąžuolas');

    for (const [input, rule] of [
      ['A', 'tooShort'],
      ['   ', 'tooShort'],
      ['ž'.repeat(25), 'tooLong'],
      ['Ta\nDas', 'controlCharacter'],
    ] as const) {
      const res = await patchName(input);
      expect(res.statusCode, input).toBe(400);
      expect(res.json()).toMatchObject({
        error: { code: 'VALIDATION_FAILED', details: { field: 'displayName', rule } },
      });
    }
    expect((await me()).displayName).toBe('Ąžuolas');

    const empty = await patchName('');
    expect(empty.statusCode).toBe(400); // JSON schema minLength 1
    const tooLongRaw = await patchName('x'.repeat(65));
    expect(tooLongRaw.statusCode).toBe(400);
  });

  it('applies the faction rules: first pick free, first change starts the 30-day lock', async () => {
    const unknown = await selectFaction(9);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ error: { code: 'FACTION_NOT_FOUND' } });

    await h.tdb.db.update(users).set({ xp: 250, level: 2 }).where(eq(users.id, user.userId));

    const first = await selectFaction(3);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json<Me>()).toMatchObject({
      factionId: 3,
      factionChangedAt: null,
      factionChangeAvailableAt: null,
      xp: 250,
      level: 2,
    });

    // re-selecting the current faction is a no-op and starts no lock
    const same = await selectFaction(3);
    expect(same.json<Me>()).toMatchObject({ factionId: 3, factionChangedAt: null });

    h.clock.advanceDays(1);
    const change = await selectFaction(2);
    expect(change.statusCode, change.body).toBe(200);
    const changedAt = h.clock.now().toISOString();
    expect(change.json<Me>()).toMatchObject({
      factionId: 2,
      factionChangedAt: changedAt,
      factionChangeAvailableAt: '2026-10-08T10:00:00.000Z',
      xp: 250,
      level: 2,
    });

    h.clock.advanceDays(10);
    const locked = await selectFaction(1);
    expect(locked.statusCode).toBe(409);
    expect(locked.json()).toMatchObject({
      error: {
        code: 'FACTION_CHANGE_LOCKED',
        details: { nextChangeAt: '2026-10-08T10:00:00.000Z' },
      },
    });
    expect((await me()).factionId).toBe(2);
    expect((await me()).factionChangeAvailableAt).toBe('2026-10-08T10:00:00.000Z');

    // re-selecting the current faction while locked is still a no-op
    expect((await selectFaction(2)).statusCode).toBe(200);

    h.clock.set('2026-10-08T10:00:00.000Z');
    expect((await me()).factionChangeAvailableAt).toBeNull();
    const unlocked = await selectFaction(1);
    expect(unlocked.statusCode, unlocked.body).toBe(200);
    expect(unlocked.json<Me>()).toMatchObject({
      factionId: 1,
      factionChangedAt: '2026-10-08T10:00:00.000Z',
      factionChangeAvailableAt: '2026-11-07T10:00:00.000Z',
      xp: 250,
      level: 2,
    });

    const [row] = await h.tdb.db
      .select({ xp: users.xp, level: users.level })
      .from(users)
      .where(eq(users.id, user.userId));
    expect(row).toEqual({ xp: 250, level: 2 });
  });

  it('validates the faction id shape', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/me/faction',
      headers: await headers(),
      payload: { factionId: 'owls' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });
});
