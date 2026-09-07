/** Map zoom -> H3 resolution (`plan.md` "Shared Rule Semantics" item 3; the prototype's table). */

const ZOOM_TABLE: readonly number[] = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 9];

/**
 * z >= 16 -> 9, 14-15 -> 8, 12-13 -> 7, 10-11 -> 6, 8-9 -> 5, 6-7 -> 4, 4-5 -> 3, 2-3 -> 2,
 * 0-1 -> 1. Non-integer zooms are floored; z < 0 -> 1; z > 18 -> 9.
 * @throws RangeError for NaN
 */
export function resolutionForZoom(zoom: number): number {
  if (Number.isNaN(zoom)) throw new RangeError('zoom must be a number');
  const z = Math.floor(zoom);
  if (z < 0) return 1;
  if (z >= ZOOM_TABLE.length) return 9;
  return ZOOM_TABLE[z]!;
}
