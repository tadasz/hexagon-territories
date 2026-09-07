import { ERROR_CODES } from '../../../errors.js';

/**
 * The three refusals of `runReckoning` (specs/004-weekly-reckoning/research.md R2, R3, R12).
 * The admin route maps them to the `Error` envelope; the CLI to exit code 1.
 */
export class WeekNotEndedError extends Error {
  readonly code = ERROR_CODES.WEEK_NOT_ENDED;
  readonly statusCode = 400;

  constructor(
    readonly weekId: string,
    readonly endsAt: Date,
  ) {
    super(`week ${weekId} has not ended (ends at ${endsAt.toISOString()})`);
    this.name = 'WeekNotEndedError';
  }
}

export class OutOfOrderError extends Error {
  readonly code = ERROR_CODES.RECKONING_OUT_OF_ORDER;
  readonly statusCode = 409;

  constructor(
    readonly weekId: string,
    readonly expectedWeekId: string,
  ) {
    super(`week ${weekId} is out of sequence; the next reckoning is for ${expectedWeekId}`);
    this.name = 'OutOfOrderError';
  }
}

export class ReckoningRunningError extends Error {
  readonly code = ERROR_CODES.RECKONING_RUNNING;
  readonly statusCode = 409;

  constructor(readonly weekId: string | null) {
    super('another reckoning is running');
    this.name = 'ReckoningRunningError';
  }
}

export type ReckoningError = WeekNotEndedError | OutOfOrderError | ReckoningRunningError;

export function isReckoningError(err: unknown): err is ReckoningError {
  return (
    err instanceof WeekNotEndedError ||
    err instanceof OutOfOrderError ||
    err instanceof ReckoningRunningError
  );
}
