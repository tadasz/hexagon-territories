import { loadFixture } from '@nature/h3-fixtures';
import { describe, expect, it } from 'vitest';
import { resolutionForZoom } from '../src/index.js';

describe('zoom-resolution.json', () => {
  const fixture = loadFixture('zoom-resolution');

  it('has 23 cases', () => {
    expect(fixture.cases).toHaveLength(23);
  });

  for (const c of fixture.cases) {
    it(`${fixture.name}: ${c.id} -> res ${c.expected.resolution}`, () => {
      expect(resolutionForZoom(c.input.zoom)).toBe(c.expected.resolution);
    });
  }
});

describe('resolutionForZoom edge cases', () => {
  it('clamps extremes', () => {
    expect(resolutionForZoom(Number.NEGATIVE_INFINITY)).toBe(1);
    expect(resolutionForZoom(Number.POSITIVE_INFINITY)).toBe(9);
    expect(resolutionForZoom(-0.5)).toBe(1);
    expect(resolutionForZoom(15.999)).toBe(8);
  });

  it('rejects NaN', () => {
    expect(() => resolutionForZoom(Number.NaN)).toThrow(RangeError);
  });
});
