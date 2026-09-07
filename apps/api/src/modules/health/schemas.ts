import { Type, type Static } from '@sinclair/typebox';
import { StringEnum } from '../../schemas/common.js';

/** Mirrors `components.schemas.HealthResponse` in contracts/openapi.yaml. */
export const HealthResponseSchema = Type.Object(
  {
    status: StringEnum(['ok', 'degraded'], {
      description: 'ok when every dependency check passed',
    }),
    db: StringEnum(['ok', 'error'], { description: 'Result of `SELECT 1` against Postgres' }),
    version: Type.String({ description: 'API package version (from apps/api/package.json)' }),
  },
  { $id: 'HealthResponse', additionalProperties: false },
);

export type HealthResponse = Static<typeof HealthResponseSchema>;

export const HealthResponseRef = Type.Unsafe<HealthResponse>({ $ref: 'HealthResponse#' });
