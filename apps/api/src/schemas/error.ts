import { Type, type Static } from '@sinclair/typebox';

/**
 * Shared error envelope returned by every non-2xx response of every route. Mirrors
 * `components.schemas.Error` in specs/001-repo-foundations/contracts/openapi.yaml.
 */
export const ErrorSchema = Type.Object(
  {
    error: Type.Object(
      {
        code: Type.String({
          pattern: '^[A-Z][A-Z0-9_]+$',
          examples: ['VALIDATION_FAILED', 'NOT_FOUND', 'INTERNAL_ERROR', 'DB_UNAVAILABLE'],
        }),
        message: Type.String(),
        details: Type.Optional(Type.Object({}, { additionalProperties: true })),
      },
      { additionalProperties: false },
    ),
    requestId: Type.String({
      description: 'Fastify request id, also returned in the `x-request-id` response header',
    }),
  },
  {
    $id: 'Error',
    additionalProperties: false,
    description:
      'Shared error envelope returned by every non-2xx response. `code` is a stable machine-readable identifier in SCREAMING_SNAKE_CASE; `message` is for developers, never shown verbatim to players; `details` carries validation issues or other structured context.',
  },
);

export type ErrorBody = Static<typeof ErrorSchema>;

/** Reference to the shared `Error` component (keeps the OpenAPI output a `$ref`). */
export const ErrorRef = Type.Unsafe<ErrorBody>({ $ref: 'Error#' });
