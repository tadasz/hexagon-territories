import { Type, type Static } from '@sinclair/typebox';

const HEX_COLOUR = '^#[0-9A-Fa-f]{6}$';

/** Mirrors `components.schemas.FactionStats` in contracts/openapi.yaml. */
export const FactionStatsSchema = Type.Object(
  {
    members: Type.Integer({ minimum: 0, description: 'Players with this faction, not deleted' }),
    activeMembers: Type.Integer({
      minimum: 0,
      description: 'Members who used the app within `activeWindowDays`',
    }),
    hexesOwnedR9: Type.Integer({ minimum: 0 }),
    hexesOwnedR7: Type.Integer({ minimum: 0 }),
  },
  { $id: 'FactionStats', additionalProperties: false },
);

export type FactionStats = Static<typeof FactionStatsSchema>;

export const FactionStatsRef = Type.Unsafe<FactionStats>({ $ref: 'FactionStats#' });

/** Mirrors `components.schemas.Faction`. */
export const FactionSchema = Type.Object(
  {
    id: Type.Integer(),
    slug: Type.String(),
    name: Type.String(),
    emoji: Type.String(),
    colorLight: Type.String({ pattern: HEX_COLOUR }),
    colorDark: Type.String({ pattern: HEX_COLOUR }),
    sort: Type.Integer(),
    stats: FactionStatsRef,
  },
  { $id: 'Faction', additionalProperties: false },
);

export type Faction = Static<typeof FactionSchema>;

export const FactionRef = Type.Unsafe<Faction>({ $ref: 'Faction#' });

/** Mirrors `components.schemas.FactionsResponse`. */
export const FactionsResponseSchema = Type.Object(
  {
    factions: Type.Array(FactionRef, { description: 'Sorted by `sort`, then `id`' }),
    suggestedFactionId: Type.Integer({
      description: 'Faction with the fewest active members (tie → lowest id)',
    }),
    activeWindowDays: Type.Integer({ description: 'The window used for activeMembers (14)' }),
  },
  { $id: 'FactionsResponse', additionalProperties: false },
);

export type FactionsResponse = Static<typeof FactionsResponseSchema>;

export const FactionsResponseRef = Type.Unsafe<FactionsResponse>({ $ref: 'FactionsResponse#' });
