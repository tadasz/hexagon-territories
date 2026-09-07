import { loadFixture } from '@nature/h3-fixtures';
import { describe, expect, it } from 'vitest';
import { deriveParentOwner } from '../src/index.js';

describe('reckoning-weeks.json: parentCases', () => {
  const fixture = loadFixture('reckoning-weeks');

  it('has at least the five cases of data-model.md', () => {
    expect(fixture.parentCases.length).toBeGreaterThanOrEqual(5);
  });

  for (const c of fixture.parentCases) {
    it(`${fixture.name}: ${c.id} -> ${String(c.expected.owner)}`, () => {
      expect(deriveParentOwner(c.input.childOwners)).toBe(c.expected.owner);
    });
  }
});

describe('deriveParentOwner unit cases', () => {
  it('needs at least two claimed children', () => {
    expect(deriveParentOwner([])).toBeNull();
    expect(deriveParentOwner([1])).toBeNull();
    expect(deriveParentOwner([1, 1])).toBe(1);
  });

  it('requires strictly more than 40 % of the claimed children', () => {
    expect(deriveParentOwner([1, 1, 2, 3, 3, 2, null])).toBeNull(); // 2/6 tie anyway
    expect(deriveParentOwner([1, 1, 1, 2, 2, 3, 3])).toBe(1); // 3/7 = 42.9 %
    expect(deriveParentOwner([1, 1, 1, 1, 2, 2, 2, 3, 3, 3])).toBeNull(); // 4/10 = 40 % exactly
    expect(deriveParentOwner([1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3])).toBe(1); // 5/12 = 41.7 %
  });

  it('ignores nulls when counting the share', () => {
    expect(deriveParentOwner([2, 2, 2, null, null, null, null])).toBe(2);
  });
});
