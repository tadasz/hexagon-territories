import { MemoryObjectStorage } from '../../src/lib/storage.js';
import type { Clock } from '../../src/lib/time.js';

export { MemoryObjectStorage };

/** A fresh in-memory storage; pass the suite's `FakeClock` so presigned URLs carry its time. */
export function memoryStorage(clock?: Clock): MemoryObjectStorage {
  return new MemoryObjectStorage(clock);
}

/** Parses `memory://<key>?op=get&exp=<unix seconds>` produced by `MemoryObjectStorage`. */
export function parseMemoryUrl(url: string): { key: string; op: string; exp: number } {
  const match = /^memory:\/\/(.+)\?op=(\w+)&exp=(\d+)$/.exec(url);
  if (!match) throw new Error(`not a memory storage url: ${url}`);
  return { key: match[1] as string, op: match[2] as string, exp: Number(match[3]) };
}
