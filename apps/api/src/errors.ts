/**
 * Stable, machine-readable error codes shared with the iOS client (contracts/openapi.yaml of
 * features 001 and 002; specs/002-auth-and-factions/data-model.md §2.6).
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DB_UNAVAILABLE: 'DB_UNAVAILABLE',
  // feature 002
  UNAUTHORIZED: 'UNAUTHORIZED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  ACCOUNT_DELETED: 'ACCOUNT_DELETED',
  INVALID_APPLE_TOKEN: 'INVALID_APPLE_TOKEN',
  APPLE_UNAVAILABLE: 'APPLE_UNAVAILABLE',
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  REFRESH_REUSED: 'REFRESH_REUSED',
  FORBIDDEN: 'FORBIDDEN',
  FACTION_NOT_FOUND: 'FACTION_NOT_FOUND',
  FACTION_CHANGE_LOCKED: 'FACTION_CHANGE_LOCKED',
  RATE_LIMITED: 'RATE_LIMITED',
  EXPORT_FAILED: 'EXPORT_FAILED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Every code, in a stable order, for the `Error` schema's `examples`. */
export const ERROR_CODE_LIST: readonly ErrorCode[] = Object.values(ERROR_CODES);

/**
 * An error a route can throw to produce a specific HTTP status and `Error` envelope. Any other
 * thrown value is reported as 500 `INTERNAL_ERROR` by the error-handler plugin.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    statusCode: number,
    code: ErrorCode | (string & {}),
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
