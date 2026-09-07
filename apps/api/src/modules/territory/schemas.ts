import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { DateTime, OrNull, StringEnum } from '../../schemas/common.js';
import {
  FLIPS_PREVIEW_MAX,
  HEX_BBOX_MAX_CELLS,
  HEX_HISTORY_WEEKS,
  MY_FLIPPED_HEXES_MAX,
} from './limits.js';

/**
 * TypeBox mirrors of `components.schemas.*` in specs/004-weekly-reckoning/contracts/openapi.yaml
 * (`$id` = component name; `additionalProperties: false` everywhere). Registered as OpenAPI
 * components by `plugins/openapi.ts`; feature 005 generates the iOS client from them.
 */
export const H3_PATTERN = '^[0-9a-f]{15}$';
export const WEEK_PATTERN = '^[0-9]{4}-W[0-9]{2}$';

const H3 = (description?: string) =>
  Type.String({ pattern: H3_PATTERN, ...(description ? { description } : {}) });
const WeekId = (description?: string) =>
  Type.String({ pattern: WEEK_PATTERN, ...(description ? { description } : {}) });

export const HexListItemSchema = Type.Object(
  {
    h3: H3(),
    res: Type.Integer({ minimum: 5, maximum: 9 }),
    owner: OrNull(
      Type.Integer({ description: 'Faction owning the hexagon after the last reckoning' }),
    ),
    ownerSince: OrNull(
      WeekId('Week the current owner took the cell; null when unclaimed or for res 5–8'),
    ),
    pressureLeader: OrNull(
      Type.Integer({
        description:
          "Faction leading strength × 0.5 + this week's capped metres + bonuses (ties → lowest id); null when nobody has anything or for res 5–8",
      }),
    ),
    contested: Type.Boolean({
      description: 'pressureLeader exists and differs from owner (always false for res 5–8)',
    }),
  },
  { $id: 'HexListItem', additionalProperties: false },
);
export type HexListItem = Static<typeof HexListItemSchema>;
export const HexListItemRef = Type.Unsafe<HexListItem>({ $ref: 'HexListItem#' });

export const HexListSchema = Type.Object(
  {
    weekId: WeekId('The current week the pressure was computed for'),
    res: Type.Integer({ minimum: 5, maximum: 9 }),
    items: Type.Array(HexListItemRef, {
      maxItems: HEX_BBOX_MAX_CELLS,
      description: 'Sorted by h3 ascending',
    }),
  },
  { $id: 'HexList', additionalProperties: false },
);
export type HexList = Static<typeof HexListSchema>;
export const HexListRef = Type.Unsafe<HexList>({ $ref: 'HexList#' });

export const FactionStrengthSchema = Type.Object(
  {
    factionId: Type.Integer(),
    strength: Type.Number({ minimum: 0 }),
  },
  { $id: 'FactionStrength', additionalProperties: false },
);
export type FactionStrength = Static<typeof FactionStrengthSchema>;
export const FactionStrengthRef = Type.Unsafe<FactionStrength>({ $ref: 'FactionStrength#' });

export const HexWeekFactionSchema = Type.Object(
  {
    factionId: Type.Integer(),
    cappedMeters: Type.Number({ minimum: 0 }),
    bonusMeters: Type.Number({ minimum: 0 }),
    score: Type.Number({
      minimum: 0,
      description: 'strength × 0.5 + cappedMeters + bonusMeters',
    }),
  },
  { $id: 'HexWeekFaction', additionalProperties: false },
);
export type HexWeekFaction = Static<typeof HexWeekFactionSchema>;
export const HexWeekFactionRef = Type.Unsafe<HexWeekFaction>({ $ref: 'HexWeekFaction#' });

export const HexWeekSchema = Type.Object(
  {
    weekId: WeekId(),
    factions: Type.Array(HexWeekFactionRef, {
      description:
        'Sorted by factionId; factions with nothing this week and no strength are omitted',
    }),
    pressureLeader: OrNull(Type.Integer()),
    contested: Type.Boolean(),
  },
  { $id: 'HexWeek', additionalProperties: false },
);
export type HexWeek = Static<typeof HexWeekSchema>;
export const HexWeekRef = Type.Unsafe<HexWeek>({ $ref: 'HexWeek#' });

export const HexCaptainSchema = Type.Object(
  {
    userId: Type.String({ format: 'uuid' }),
    displayName: Type.String(),
  },
  { $id: 'HexCaptain', additionalProperties: false },
);
export type HexCaptain = Static<typeof HexCaptainSchema>;
export const HexCaptainRef = Type.Unsafe<HexCaptain>({ $ref: 'HexCaptain#' });

/** `HexCaptain | null` as `oneOf` (the contract's form). */
const NullableCaptain: TSchema & { static: HexCaptain | null } = Type.Unsafe<HexCaptain | null>({
  oneOf: [{ $ref: 'HexCaptain#' }, { type: 'null' }],
});

export const HexMeSchema = Type.Object(
  {
    meters: Type.Number({
      minimum: 0,
      description: "The caller's raw metres in the cell this week",
    }),
    cappedMeters: Type.Number({ minimum: 0 }),
    explored: Type.Boolean({ description: 'The caller has metres in the cell in any week' }),
    flipped: Type.Boolean({
      description:
        "The caller's metres were part of a reckoning that flipped the cell to their faction",
    }),
    held: Type.Boolean({ description: 'The caller is the current captain' }),
  },
  { $id: 'HexMe', additionalProperties: false },
);
export type HexMe = Static<typeof HexMeSchema>;
export const HexMeRef = Type.Unsafe<HexMe>({ $ref: 'HexMe#' });

export const HexReckoningEntrySchema = Type.Object(
  {
    weekId: WeekId(),
    owner: OrNull(Type.Integer()),
    flipped: Type.Boolean(),
    from: OrNull(Type.Integer()),
    to: OrNull(Type.Integer()),
    strengths: Type.Array(FactionStrengthRef),
    captain: NullableCaptain,
  },
  { $id: 'HexReckoningEntry', additionalProperties: false },
);
export type HexReckoningEntry = Static<typeof HexReckoningEntrySchema>;
export const HexReckoningEntryRef = Type.Unsafe<HexReckoningEntry>({
  $ref: 'HexReckoningEntry#',
});

export const HexDetailSchema = Type.Object(
  {
    h3: H3(),
    owner: OrNull(Type.Integer()),
    ownerSince: OrNull(WeekId()),
    captain: NullableCaptain,
    strengths: Type.Array(FactionStrengthRef, { description: 'Sorted by factionId' }),
    week: HexWeekRef,
    me: HexMeRef,
    reckonings: Type.Array(HexReckoningEntryRef, {
      maxItems: HEX_HISTORY_WEEKS,
      description: 'Newest first',
    }),
    captures: Type.Array(Type.Unknown(), {
      description: 'Always empty in feature 004; feature 006 defines the item schema',
    }),
  },
  { $id: 'HexDetail', additionalProperties: false },
);
export type HexDetail = Static<typeof HexDetailSchema>;
export const HexDetailRef = Type.Unsafe<HexDetail>({ $ref: 'HexDetail#' });

export const FactionTotalSchema = Type.Object(
  {
    factionId: Type.Integer(),
    hexesOwnedR9: Type.Integer({ minimum: 0 }),
    hexesOwnedR7: Type.Integer({ minimum: 0 }),
    meters: Type.Number({
      minimum: 0,
      description: 'Capped walking metres the faction earned in the week',
    }),
    activeUsers: Type.Integer({ minimum: 0 }),
    captures: Type.Integer({ minimum: 0 }),
    flipsGained: Type.Integer({ minimum: 0 }),
    flipsLost: Type.Integer({ minimum: 0 }),
  },
  { $id: 'FactionTotal', additionalProperties: false },
);
export type FactionTotal = Static<typeof FactionTotalSchema>;
export const FactionTotalRef = Type.Unsafe<FactionTotal>({ $ref: 'FactionTotal#' });

export const ReckoningLatestSchema = Type.Object(
  {
    weekId: OrNull(WeekId()),
    ranAt: OrNull(DateTime()),
    nextAt: DateTime({ description: 'Next Monday 00:00 UTC after now' }),
    inProgress: OrNull(WeekId('Week id of a reckoning currently running, if any')),
    factionTotals: Type.Array(FactionTotalRef, {
      description: 'Sorted by factionId; empty before the first reckoning',
    }),
    myFlips: Type.Integer({
      minimum: 0,
      description: 'Cells the caller helped flip to their faction in that week',
    }),
    myFlippedHexes: Type.Array(H3(), {
      maxItems: MY_FLIPPED_HEXES_MAX,
      description: 'Sorted by h3',
    }),
  },
  { $id: 'ReckoningLatest', additionalProperties: false },
);
export type ReckoningLatest = Static<typeof ReckoningLatestSchema>;
export const ReckoningLatestRef = Type.Unsafe<ReckoningLatest>({ $ref: 'ReckoningLatest#' });

export const ReckoningRunRequestSchema = Type.Object(
  {
    dryRun: Type.Optional(
      Type.Boolean({
        default: false,
        description: 'Compute and report the flips without writing anything; requires sync',
      }),
    ),
    sync: Type.Optional(
      Type.Boolean({
        default: false,
        description: 'Run inside the request and answer the result instead of enqueuing the job',
      }),
    ),
  },
  { $id: 'ReckoningRunRequest', additionalProperties: false },
);
export type ReckoningRunRequest = Static<typeof ReckoningRunRequestSchema>;
export const ReckoningRunRequestRef = Type.Unsafe<ReckoningRunRequest>({
  $ref: 'ReckoningRunRequest#',
});

export const FlipPreviewSchema = Type.Object(
  {
    h3: H3(),
    from: OrNull(Type.Integer()),
    to: OrNull(Type.Integer()),
  },
  { $id: 'FlipPreview', additionalProperties: false },
);
export type FlipPreview = Static<typeof FlipPreviewSchema>;
export const FlipPreviewRef = Type.Unsafe<FlipPreview>({ $ref: 'FlipPreview#' });

export const ReckoningRunResultSchema = Type.Object(
  {
    weekId: WeekId(),
    dryRun: Type.Boolean(),
    status: StringEnum(['done']),
    resumed: Type.Boolean({
      description: 'The run continued an earlier interrupted run of the same week',
    }),
    hexesProcessed: Type.Integer({ minimum: 0 }),
    flips: Type.Integer({ minimum: 0 }),
    parentFlips: Type.Integer({ minimum: 0 }),
    walksAutofinished: Type.Integer({ minimum: 0 }),
    staleWalksSkipped: Type.Integer({
      minimum: 0,
      description: 'Dry run only — stale walks a real run would have finished first',
    }),
    pushQueued: Type.Integer({ minimum: 0 }),
    leaderboardRows: Type.Integer({ minimum: 0 }),
    durationMs: Type.Integer({ minimum: 0 }),
    startedAt: DateTime(),
    finishedAt: DateTime(),
    flipsPreview: Type.Array(FlipPreviewRef, {
      maxItems: FLIPS_PREVIEW_MAX,
      description: 'Dry run only; empty for a real run',
    }),
  },
  { $id: 'ReckoningRunResult', additionalProperties: false },
);
export type ReckoningRunResult = Static<typeof ReckoningRunResultSchema>;
export const ReckoningRunResultRef = Type.Unsafe<ReckoningRunResult>({
  $ref: 'ReckoningRunResult#',
});

export const ReckoningQueuedSchema = Type.Object(
  {
    weekId: WeekId(),
    status: StringEnum(['queued']),
    jobId: Type.String(),
  },
  { $id: 'ReckoningQueued', additionalProperties: false },
);
export type ReckoningQueued = Static<typeof ReckoningQueuedSchema>;
export const ReckoningQueuedRef = Type.Unsafe<ReckoningQueued>({ $ref: 'ReckoningQueued#' });

export const RECKONING_STATUSES = ['running', 'done', 'failed'] as const;
export const RECKONING_STAGE_NAMES = ['walks', 'cells', 'rollup', 'push', 'done'] as const;

export const ReckoningStatusSchema = Type.Object(
  {
    weekId: WeekId(),
    status: StringEnum(RECKONING_STATUSES),
    stage: StringEnum(RECKONING_STAGE_NAMES),
    attempt: Type.Integer({ minimum: 1 }),
    startedAt: DateTime(),
    finishedAt: OrNull(DateTime()),
    hexesProcessed: Type.Integer(),
    flips: Type.Integer(),
    parentFlips: Type.Integer(),
    batches: Type.Integer(),
    walksAutofinished: Type.Integer(),
    pushQueued: Type.Integer(),
    error: OrNull(Type.String()),
  },
  { $id: 'ReckoningStatus', additionalProperties: false },
);
export type ReckoningStatus = Static<typeof ReckoningStatusSchema>;
export const ReckoningStatusRef = Type.Unsafe<ReckoningStatus>({ $ref: 'ReckoningStatus#' });

/** Query of `GET /v1/hexes`. */
export const HexListQuerySchema = Type.Object(
  {
    res: Type.Integer({ minimum: 5, maximum: 9 }),
    bbox: Type.String({
      pattern: '^-?\\d+(\\.\\d+)?,-?\\d+(\\.\\d+)?,-?\\d+(\\.\\d+)?,-?\\d+(\\.\\d+)?$',
      description: '`minLon,minLat,maxLon,maxLat` in WGS84 degrees; min < max on both axes',
      examples: ['23.85,54.87,23.98,54.93'],
    }),
  },
  { additionalProperties: false },
);
export type HexListQuery = Static<typeof HexListQuerySchema>;

export const HexParamsSchema = Type.Object({ h3: H3() }, { additionalProperties: false });
export type HexParams = Static<typeof HexParamsSchema>;

export const WeekIdParamsSchema = Type.Object(
  { weekId: WeekId('ISO week in UTC') },
  { additionalProperties: false },
);
export type WeekIdParams = Static<typeof WeekIdParamsSchema>;

/** Every component schema of this module, in a stable order (feeds `plugins/openapi.ts`). */
export const TERRITORY_COMPONENT_SCHEMAS = [
  HexListItemSchema,
  HexListSchema,
  FactionStrengthSchema,
  HexWeekFactionSchema,
  HexWeekSchema,
  HexCaptainSchema,
  HexMeSchema,
  HexReckoningEntrySchema,
  HexDetailSchema,
  FactionTotalSchema,
  ReckoningLatestSchema,
  ReckoningRunRequestSchema,
  FlipPreviewSchema,
  ReckoningRunResultSchema,
  ReckoningQueuedSchema,
  ReckoningStatusSchema,
];
