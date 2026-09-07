import { Type, type Static } from '@sinclair/typebox';
import { DateTime, OrNull, StringEnum } from '../../schemas/common.js';

export const USER_ROLES = ['player', 'tester', 'admin'] as const;
export const EXPORT_STATES = ['pending', 'ready', 'failed'] as const;

/** Mirrors `components.schemas.Me` in contracts/openapi.yaml. Never carries the e-mail. */
export const MeSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    displayName: Type.String(),
    factionId: OrNull(Type.Integer()),
    factionChangedAt: OrNull(DateTime()),
    factionChangeAvailableAt: OrNull(
      DateTime({
        description:
          'When the next faction change is allowed; null when a change is allowed now (or no faction is set yet)',
      }),
    ),
    xp: Type.Integer({ minimum: 0 }),
    level: Type.Integer({ minimum: 1 }),
    role: StringEnum(USER_ROLES),
    createdAt: DateTime(),
    suggestedFactionId: Type.Integer({
      description: 'Faction with the fewest active members (tie → lowest id)',
    }),
  },
  { $id: 'Me', additionalProperties: false },
);

export type Me = Static<typeof MeSchema>;

export const MeRef = Type.Unsafe<Me>({ $ref: 'Me#' });

/** Mirrors `components.schemas.MeUpdate`. */
export const MeUpdateSchema = Type.Object(
  {
    displayName: Type.String({
      minLength: 1,
      maxLength: 64,
      description:
        'Validated by the service to 2–24 Unicode scalars after trimming, no control characters',
    }),
  },
  { $id: 'MeUpdate', additionalProperties: false },
);

export type MeUpdate = Static<typeof MeUpdateSchema>;

export const MeUpdateRef = Type.Unsafe<MeUpdate>({ $ref: 'MeUpdate#' });

/** Mirrors `components.schemas.FactionSelect`. */
export const FactionSelectSchema = Type.Object(
  {
    factionId: Type.Integer({ minimum: 1, maximum: 32767 }),
  },
  { $id: 'FactionSelect', additionalProperties: false },
);

export type FactionSelect = Static<typeof FactionSelectSchema>;

export const FactionSelectRef = Type.Unsafe<FactionSelect>({ $ref: 'FactionSelect#' });

/** Mirrors `components.schemas.AccountDeletion`. */
export const AccountDeletionSchema = Type.Object(
  {
    deletedAt: DateTime(),
    purgeAt: DateTime({ description: 'When the erasure job runs (deletedAt + 30 days)' }),
  },
  { $id: 'AccountDeletion', additionalProperties: false },
);

export type AccountDeletion = Static<typeof AccountDeletionSchema>;

export const AccountDeletionRef = Type.Unsafe<AccountDeletion>({ $ref: 'AccountDeletion#' });

/** Mirrors `components.schemas.ExportStatus`. */
export const ExportStatusSchema = Type.Object(
  {
    id: Type.String({ format: 'uuid' }),
    status: StringEnum(EXPORT_STATES),
    requestedAt: DateTime(),
    completedAt: OrNull(DateTime()),
    expiresAt: OrNull(DateTime()),
    downloadUrl: OrNull(
      Type.String({
        description: 'Presigned GET URL, valid for one hour; only when status is ready',
      }),
    ),
    error: OrNull(Type.String()),
  },
  { $id: 'ExportStatus', additionalProperties: false },
);

export type ExportStatus = Static<typeof ExportStatusSchema>;

export const ExportStatusRef = Type.Unsafe<ExportStatus>({ $ref: 'ExportStatus#' });
