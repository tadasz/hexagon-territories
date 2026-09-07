import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACTIVE_PLAYER_WINDOW_DAYS,
  FACTION_CHANGE_COOLDOWN_DAYS,
  activeSince,
  canChangeFaction,
  factionChangeAvailableAt,
} from '../../src/modules/factions/rules.js';
import { FakeClock } from '../helpers/clock.js';

describe('faction rules', () => {
  const clock = new FakeClock('2026-09-07T10:00:00.000Z');

  it('uses the account constants of research.md R6', () => {
    expect(FACTION_CHANGE_COOLDOWN_DAYS).toBe(30);
    expect(ACTIVE_PLAYER_WINDOW_DAYS).toBe(14);
  });

  it('allows a change when the player never changed', () => {
    expect(factionChangeAvailableAt(null, clock.now())).toBeNull();
    expect(canChangeFaction(null, clock.now())).toBe(true);
  });

  it('locks for exactly 30 days after a change', () => {
    const changedAt = clock.now();
    const now = new FakeClock(changedAt);
    now.advanceDays(10);
    expect(factionChangeAvailableAt(changedAt, now.now())?.toISOString()).toBe(
      '2026-10-07T10:00:00.000Z',
    );
    expect(canChangeFaction(changedAt, now.now())).toBe(false);

    now.set('2026-10-07T09:59:59.999Z');
    expect(canChangeFaction(changedAt, now.now())).toBe(false);
    now.set('2026-10-07T10:00:00.000Z');
    expect(canChangeFaction(changedAt, now.now())).toBe(true);
    expect(factionChangeAvailableAt(changedAt, now.now())).toBeNull();
  });

  it('computes the start of the active window from the clock', () => {
    expect(activeSince(clock).toISOString()).toBe('2026-08-24T10:00:00.000Z');
  });

  it('matches the "Other rules" table of docs/territory-rules.md', () => {
    const doc = readFileSync(resolve(__dirname, '../../../../docs/territory-rules.md'), 'utf8');
    const otherRules = doc.slice(doc.indexOf('## Other rules'));
    expect(otherRules).toContain(`once per ${FACTION_CHANGE_COOLDOWN_DAYS} days`);
    expect(otherRules).toContain('fewest active players');
    // Stream C (tasks.md T029) adds the window wording to the Balance row; the assertion below is
    // enabled with it:
    // expect(otherRules).toContain(`${ACTIVE_PLAYER_WINDOW_DAYS} days`);
  });
});
