import { loadFixture } from '@nature/h3-fixtures';
import { deriveParentOwner, type ReckonResult } from '@nature/territory-rules';
import { cellToParent } from 'h3-js';
import { describe, expect, it } from 'vitest';
import type { CellOutcome } from '../../src/modules/territory/reckoning/cells.js';
import {
  ParentCountError,
  applyDeltasToRows,
  claimedOf,
  collectParentDeltas,
  normalizeCounts,
  ownerFromCounts,
  type ParentCounts,
  type ParentRow,
} from '../../src/modules/territory/reckoning/parents.js';

function countsOf(children: readonly (number | null)[]): ParentCounts {
  const counts: ParentCounts = {};
  for (const owner of children) {
    if (owner === null) continue;
    counts[String(owner)] = (counts[String(owner)] ?? 0) + 1;
  }
  return counts;
}

/** Deterministic PRNG so the 200 random count maps are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function outcome(cell: string, from: number | null, to: number | null): CellOutcome {
  const result: ReckonResult = { strengths: [], owner: to, flipped: true, captain: null };
  result.event = { from, to };
  return {
    cell,
    isNew: false,
    owner: from,
    captainBefore: null,
    result,
    contributions: [],
    hadContributions: true,
    ownerSinceWeek: to === null ? null : '2026-W36',
    lastActivityWeek: '2026-W36',
  };
}

describe('parent ownership over counts (research.md R6)', () => {
  it('equals deriveParentOwner for every parentCase of reckoning-weeks.json', () => {
    const fixture = loadFixture('reckoning-weeks');
    expect(fixture.parentCases.length).toBe(8);
    for (const c of fixture.parentCases) {
      expect(ownerFromCounts(countsOf(c.input.childOwners)), c.id).toBe(c.expected.owner);
      expect(deriveParentOwner(c.input.childOwners), c.id).toBe(c.expected.owner);
    }
  });

  it('equals deriveParentOwner for 200 seeded-random count maps', () => {
    const random = mulberry32(20260907);
    for (let i = 0; i < 200; i += 1) {
      const size = Math.floor(random() * 8);
      const children: (number | null)[] = [];
      for (let j = 0; j < size; j += 1) {
        const pick = Math.floor(random() * 4);
        children.push(pick === 0 ? null : pick);
      }
      expect(ownerFromCounts(countsOf(children)), JSON.stringify(children)).toBe(
        deriveParentOwner(children),
      );
    }
  });

  it('normalises counts (drops zeros, sorts keys) and sums the claimed children', () => {
    expect(normalizeCounts({ '3': 2, '1': 0, '2': 1 })).toEqual({ '2': 1, '3': 2 });
    expect(Object.keys(normalizeCounts({ '10': 1, '2': 1 }))).toEqual(['2', '10']);
    expect(claimedOf({ '1': 3, '2': 4 })).toBe(7);
    expect(claimedOf({})).toBe(0);
  });

  it('collects one delta per level for a 1 → 2 flip (exactly four parents)', () => {
    const cell = '891f40da99bffff';
    const deltas = collectParentDeltas([outcome(cell, 1, 2)]);
    expect(deltas.size).toBe(4);
    for (const res of [8, 7, 6, 5]) {
      const delta = deltas.get(cellToParent(cell, res));
      expect(delta?.res).toBe(res);
      expect([...delta!.deltas.entries()]).toEqual([
        [1, -1],
        [2, 1],
      ]);
    }
    // a flip to unclaimed only decrements; a first claim only increments
    const toNull = collectParentDeltas([outcome(cell, 3, null)]);
    expect([...toNull.get(cellToParent(cell, 8))!.deltas.entries()]).toEqual([[3, -1]]);
    const fromNull = collectParentDeltas([outcome(cell, null, 3)]);
    expect([...fromNull.get(cellToParent(cell, 5))!.deltas.entries()]).toEqual([[3, 1]]);
    // cells without an event touch nothing; siblings share the same parent delta
    const sibling = '891f40da993ffff';
    const shared = collectParentDeltas([
      outcome(cell, null, 1),
      outcome(sibling, null, 1),
      {
        ...outcome(cell, 1, 1),
        result: { strengths: [], owner: 1, flipped: false, captain: null },
      },
    ]);
    expect(shared.get(cellToParent(cell, 8))!.deltas.get(1)).toBe(2);
  });

  it('applies deltas, re-derives the owner with the shared rule and reports parent flips', () => {
    const parent = cellToParent('891f40da99bffff', 8);
    const rows = new Map<string, ParentRow>([
      [
        parent,
        {
          h3: parent,
          res: 8,
          owner: 1,
          counts: { '1': 3, '2': 2, '3': 2 },
          claimed: 7,
          exists: true,
        },
      ],
    ]);
    // the coarser levels hold the same cell once (a first claim seeded them)
    for (const res of [7, 6, 5]) {
      const h3 = cellToParent('891f40da99bffff', res);
      rows.set(h3, { h3, res, owner: null, counts: { '1': 1 }, claimed: 1, exists: true });
    }
    const deltas = collectParentDeltas([outcome('891f40da99bffff', 1, null)]);
    const { rows: updated, flips } = applyDeltasToRows(rows, deltas);
    const row = updated.find((r) => r.h3 === parent)!;
    expect(row.counts).toEqual({ '1': 2, '2': 2, '3': 2 });
    expect(row.claimed).toBe(6);
    expect(row.owner).toBe(deriveParentOwner([1, 1, 2, 2, 3, 3]));
    expect(row.owner).toBeNull();
    expect(flips).toEqual([{ h3: parent, res: 8, from: 1, to: null }]);
    expect(updated.find((r) => r.res === 5)).toMatchObject({ counts: {}, claimed: 0, owner: null });
    // parents absent from the map are created from empty counts on a first claim
    const first = applyDeltasToRows(
      new Map(),
      collectParentDeltas([outcome('891f40da993ffff', null, 2)]),
    );
    expect(first.rows).toHaveLength(4);
    expect(first.rows.every((r) => !r.exists && r.claimed === 1 && r.owner === null)).toBe(true);
    expect(first.flips).toEqual([]);
  });

  it('fails loudly when a count would go negative', () => {
    const rows = new Map<string, ParentRow>();
    const deltas = collectParentDeltas([outcome('891f40da99bffff', 2, 1)]);
    expect(() => applyDeltasToRows(rows, deltas)).toThrow(ParentCountError);
  });
});
