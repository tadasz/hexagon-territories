import { loadFixture } from '@nature/h3-fixtures';
import { describe, expect, it } from 'vitest';
import { bigIntToCell, cellToBigInt, isH3Cell } from '../../src/lib/h3.js';

describe('lib/h3', () => {
  it('round-trips every cell of the walk-paths fixture', () => {
    const fixture = loadFixture('walk-paths');
    const cells = fixture.cases.flatMap((c) => c.expected.hexMeters.map((h) => h.cell));
    expect(cells.length).toBeGreaterThan(10);
    for (const cell of cells) {
      expect(isH3Cell(cell)).toBe(true);
      const big = cellToBigInt(cell);
      expect(big > 0n).toBe(true);
      expect(bigIntToCell(big)).toBe(cell);
      expect(bigIntToCell(big.toString())).toBe(cell);
    }
  });

  it('matches the bigint literals used by the 001 tests', () => {
    expect(cellToBigInt('891f1d4a2c3ffff')).toBe(BigInt('0x891f1d4a2c3ffff'));
    expect(bigIntToCell(BigInt('0x891f1d4a2c3ffff'))).toBe('891f1d4a2c3ffff');
  });

  it('rejects anything but 15 lowercase hex characters', () => {
    for (const bad of ['', '891F40D1A4FFFFF', '891f40d1a4ffff', '891f40d1a4fffff0', 'xyz', '0x8']) {
      expect(isH3Cell(bad)).toBe(false);
      expect(() => cellToBigInt(bad)).toThrow(RangeError);
    }
    expect(() => bigIntToCell(-1n)).toThrow(RangeError);
    expect(() => bigIntToCell(BigInt('0x1000000000000000'))).toThrow(RangeError);
  });
});
