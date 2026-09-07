import type { Clock } from '../../src/lib/time.js';

/** A clock that only moves when a test tells it to. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date | string = '2026-09-07T10:00:00.000Z') {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(date: Date | string): void {
    this.current = new Date(date);
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  advanceSeconds(seconds: number): void {
    this.advanceMs(seconds * 1_000);
  }

  advanceMinutes(minutes: number): void {
    this.advanceMs(minutes * 60_000);
  }

  advanceDays(days: number): void {
    this.advanceMs(days * 86_400_000);
  }
}
