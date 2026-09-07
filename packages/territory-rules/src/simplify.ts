/**
 * Douglas-Peucker simplification (`plan.md` "Shared Rule Semantics" item 6): perpendicular
 * distance to the chord (point-to-segment, so a degenerate chord falls back to point distance)
 * measured in the local equirectangular frame of `projectLocal`; a point is kept when its
 * distance is strictly greater than the tolerance; endpoints are always kept.
 */
import { RULES } from './config.js';
import { projectLocal, type LocalXY } from './geo.js';
import type { LatLng } from './types.js';

function segmentDistance(p: LocalXY, a: LocalXY, b: LocalXY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const qx = a.x + t * dx;
  const qy = a.y + t * dy;
  return Math.hypot(p.x - qx, p.y - qy);
}

/** Returns a new array of the kept points (same objects), in order. */
export function simplifyPath<P extends LatLng>(
  points: readonly P[],
  toleranceM: number = RULES.SIMPLIFY_TOLERANCE_M,
): P[] {
  if (points.length < 3) return points.slice();
  const xy = projectLocal(points);
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDistance = -1;
    let maxIndex = -1;
    for (let i = start + 1; i < end; i++) {
      const d = segmentDistance(xy[i]!, xy[start]!, xy[end]!);
      if (d > maxDistance) {
        maxDistance = d;
        maxIndex = i;
      }
    }
    if (maxIndex >= 0 && maxDistance > toleranceM) {
      keep[maxIndex] = true;
      stack.push([start, maxIndex], [maxIndex, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
