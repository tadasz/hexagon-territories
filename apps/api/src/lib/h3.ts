/**
 * H3 cells travel as 15-character lowercase hex strings in JSON (the `h3-js` / fixtures form)
 * and are stored as `bigint` columns (docs/architecture.md §6: no h3-pg dependency).
 */
const CELL_PATTERN = /^[0-9a-f]{15}$/;

export function isH3Cell(value: string): boolean {
  return CELL_PATTERN.test(value);
}

/** `'891f40d1a4fffff'` → `0x891f40d1a4fffffn`; throws on anything but 15 lowercase hex chars. */
export function cellToBigInt(cell: string): bigint {
  if (!CELL_PATTERN.test(cell)) throw new RangeError(`not an H3 cell string: ${cell}`);
  return BigInt(`0x${cell}`);
}

/** Inverse of `cellToBigInt`; accepts the `string` form node-postgres uses for `int8`. */
export function bigIntToCell(value: bigint | string): string {
  const big = typeof value === 'bigint' ? value : BigInt(value);
  if (big < 0n) throw new RangeError(`not an H3 cell: ${String(value)}`);
  const hex = big.toString(16);
  if (hex.length > 15) throw new RangeError(`not an H3 cell: ${String(value)}`);
  return hex.padStart(15, '0');
}
