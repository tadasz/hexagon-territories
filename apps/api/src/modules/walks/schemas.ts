import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { DateTime, OrNull, StringEnum } from '../../schemas/common.js';

/**
 * TypeBox mirrors of `components.schemas.*` in specs/003-walk-tracking/contracts/openapi.yaml
 * (`$id` = component name; `additionalProperties: false` everywhere). Registered as OpenAPI
 * components by `plugins/openapi.ts`.
 */

export const WALK_STATUSES = ['active', 'finished', 'flagged', 'abandoned'] as const;
export const FINISH_REASONS = ['client', 'autofinish', 'superseded'] as const;
export const WALK_FLAGS = ['teleport', 'speed', 'distance', 'no_steps'] as const;
export const REJECT_REASONS = ['accuracy', 'speed', 'non_monotonic'] as const;

const H3_PATTERN = '^[0-9a-f]{15}$';
const WEEK_PATTERN = '^[0-9]{4}-W[0-9]{2}$';

/** `type: [string, null]` with `enum` including `null`, as the contract writes it. */
function NullableEnum<const T extends readonly string[]>(values: T, description?: string) {
  return Type.Unsafe<T[number] | null>({
    type: ['string', 'null'],
    enum: [...values, null],
    ...(description ? { description } : {}),
  });
}

export const WalkCreateRequestSchema = Type.Object(
  {
    clientWalkId: Type.String({
      format: 'uuid',
      description: 'Generated on the device when the walk starts; the idempotency key',
    }),
    startedAt: DateTime(),
    deviceInfo: Type.Optional(
      Type.Object(
        {
          model: Type.Optional(Type.String({ maxLength: 64 })),
          osVersion: Type.Optional(Type.String({ maxLength: 32 })),
          appVersion: Type.Optional(Type.String({ maxLength: 32 })),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { $id: 'WalkCreateRequest', additionalProperties: false },
);
export type WalkCreateRequest = Static<typeof WalkCreateRequestSchema>;
export const WalkCreateRequestRef = Type.Unsafe<WalkCreateRequest>({ $ref: 'WalkCreateRequest#' });

export const WalkCreatedSchema = Type.Object(
  {
    walkId: Type.String({ format: 'uuid' }),
    clientWalkId: Type.String({ format: 'uuid' }),
    startedAt: DateTime({ description: 'After clamping' }),
    status: StringEnum(WALK_STATUSES, {
      description:
        '`active` for a new walk; when the clientWalkId already existed, the stored status of that walk',
    }),
    supersededWalkId: OrNull(
      Type.String({
        format: 'uuid',
        description: 'The previously active walk that was auto-finished by this creation',
      }),
    ),
  },
  { $id: 'WalkCreated', additionalProperties: false },
);
export type WalkCreated = Static<typeof WalkCreatedSchema>;
export const WalkCreatedRef = Type.Unsafe<WalkCreated>({ $ref: 'WalkCreated#' });

export const LocationSampleSchema = Type.Object(
  {
    seq: Type.Integer({ minimum: 0 }),
    ts: DateTime(),
    lat: Type.Number({ minimum: -90, maximum: 90 }),
    lon: Type.Number({ minimum: -180, maximum: 180 }),
    hAcc: Type.Number({ minimum: 0, description: 'Horizontal accuracy in metres' }),
    speed: Type.Optional(
      OrNull(Type.Number({ minimum: 0, description: 'Device-reported speed in m/s' })),
    ),
    course: Type.Optional(OrNull(Type.Number({ minimum: 0, maximum: 360 }))),
    alt: Type.Optional(OrNull(Type.Number())),
  },
  { $id: 'LocationSample', additionalProperties: false },
);
export type LocationSample = Static<typeof LocationSampleSchema>;
export const LocationSampleRef = Type.Unsafe<LocationSample>({ $ref: 'LocationSample#' });

export const PedometerWindowSchema = Type.Object(
  {
    steps: Type.Integer({ minimum: 0 }),
    since: DateTime(),
    until: DateTime(),
  },
  { $id: 'PedometerWindow', additionalProperties: false },
);
export type PedometerWindow = Static<typeof PedometerWindowSchema>;
export const PedometerWindowRef = Type.Unsafe<PedometerWindow>({ $ref: 'PedometerWindow#' });

export const SampleBatchRequestSchema = Type.Object(
  {
    samples: Type.Array(LocationSampleRef, { minItems: 1, maxItems: 200 }),
    pedometer: Type.Optional(PedometerWindowRef),
  },
  { $id: 'SampleBatchRequest', additionalProperties: false },
);
export type SampleBatchRequest = Static<typeof SampleBatchRequestSchema>;
export const SampleBatchRequestRef = Type.Unsafe<SampleBatchRequest>({
  $ref: 'SampleBatchRequest#',
});

export const RejectedSampleSchema = Type.Object(
  {
    seq: Type.Integer(),
    reason: StringEnum(REJECT_REASONS),
  },
  { $id: 'RejectedSample', additionalProperties: false },
);
export type RejectedSample = Static<typeof RejectedSampleSchema>;
export const RejectedSampleRef = Type.Unsafe<RejectedSample>({ $ref: 'RejectedSample#' });

export const SampleBatchResultSchema = Type.Object(
  {
    stored: Type.Integer({ minimum: 0, description: 'Rows inserted by this call' }),
    duplicates: Type.Integer({
      minimum: 0,
      description: 'Samples whose seq was already stored (ignored)',
    }),
    accepted: Type.Array(Type.Integer(), {
      description: 'Provisionally accepted seqs among the stored rows',
    }),
    rejected: Type.Array(RejectedSampleRef, {
      description: 'Provisionally rejected seqs among the stored rows',
    }),
    sampleCount: Type.Integer({ minimum: 0, description: 'Total stored samples of the walk' }),
  },
  { $id: 'SampleBatchResult', additionalProperties: false },
);
export type SampleBatchResult = Static<typeof SampleBatchResultSchema>;
export const SampleBatchResultRef = Type.Unsafe<SampleBatchResult>({ $ref: 'SampleBatchResult#' });

export const WalkFinishRequestSchema = Type.Object(
  {
    endedAt: DateTime(),
    pedometerTotal: Type.Optional(
      OrNull(
        Type.Integer({
          minimum: 0,
          description:
            'Steps counted by the device during the walk; omitted when the pedometer is unavailable',
        }),
      ),
    ),
  },
  { $id: 'WalkFinishRequest', additionalProperties: false },
);
export type WalkFinishRequest = Static<typeof WalkFinishRequestSchema>;
export const WalkFinishRequestRef = Type.Unsafe<WalkFinishRequest>({ $ref: 'WalkFinishRequest#' });

export const WeekStandingSchema = Type.Object(
  {
    leader: OrNull(
      Type.Integer({
        description:
          "Faction with the highest (strength × 0.5 + this week's capped metres + bonuses); null when nobody has anything",
      }),
    ),
    myFactionShare: Type.Number({
      minimum: 0,
      maximum: 1,
      description: "The player's faction's share of this week's total score in the cell",
    }),
    owner: OrNull(
      Type.Integer({
        description: 'Current owner from the last reckoning (informational; unchanged by walks)',
      }),
    ),
  },
  { $id: 'WeekStanding', additionalProperties: false },
);
export type WeekStanding = Static<typeof WeekStandingSchema>;
export const WeekStandingRef = Type.Unsafe<WeekStanding>({ $ref: 'WeekStanding#' });

export const WalkHexSchema = Type.Object(
  {
    h3: Type.String({ pattern: H3_PATTERN }),
    meters: Type.Number({
      minimum: 0,
      description: "Raw metres of this walk's simplified path inside the cell",
    }),
    cappedMeters: Type.Number({
      minimum: 0,
      description:
        "Metres of this walk that counted toward the player's 2 000 m weekly cap in the cell (0 when flagged)",
    }),
    weekStanding: WeekStandingRef,
  },
  { $id: 'WalkHex', additionalProperties: false },
);
export type WalkHex = Static<typeof WalkHexSchema>;
export const WalkHexRef = Type.Unsafe<WalkHex>({ $ref: 'WalkHex#' });

export const LineStringSchema = Type.Object(
  {
    type: StringEnum(['LineString']),
    coordinates: Type.Array(Type.Array(Type.Number(), { minItems: 2, maxItems: 2 }), {
      minItems: 2,
      description: 'GeoJSON positions [lon, lat]',
    }),
  },
  { $id: 'LineString', additionalProperties: false },
);
export type LineString = Static<typeof LineStringSchema>;
export const LineStringRef = Type.Unsafe<LineString>({ $ref: 'LineString#' });

/** `LineString | null` as `oneOf` (the contract's form). */
const NullableLineString: TSchema & { static: LineString | null } = Type.Unsafe<LineString | null>({
  oneOf: [{ $ref: 'LineString#' }, { type: 'null' }],
  description:
    'Simplified accepted path; null while active or with fewer than two accepted samples',
});

const summaryProps = {
  walkId: Type.String({ format: 'uuid' }),
  clientWalkId: Type.String({ format: 'uuid' }),
  status: StringEnum(WALK_STATUSES),
  finishReason: NullableEnum(FINISH_REASONS),
  startedAt: DateTime(),
  endedAt: OrNull(DateTime()),
  weekId: OrNull(Type.String({ pattern: WEEK_PATTERN })),
  distanceM: Type.Number({ minimum: 0 }),
  durationS: Type.Integer({ minimum: 0 }),
  hexCount: Type.Integer({ minimum: 0 }),
  xp: Type.Integer({ minimum: 0 }),
  scored: Type.Boolean({
    description:
      'True when contributions and XP were written (false while active and for flagged walks)',
  }),
  flags: Type.Array(StringEnum(WALK_FLAGS)),
};

export const WalkSummarySchema = Type.Object(
  {
    walkId: summaryProps.walkId,
    clientWalkId: summaryProps.clientWalkId,
    status: summaryProps.status,
    finishReason: summaryProps.finishReason,
    startedAt: summaryProps.startedAt,
    endedAt: summaryProps.endedAt,
    finishedAt: OrNull(DateTime()),
    weekId: summaryProps.weekId,
    distanceM: summaryProps.distanceM,
    durationS: summaryProps.durationS,
    steps: OrNull(Type.Integer()),
    sampleCount: Type.Integer({ minimum: 0 }),
    hexCount: summaryProps.hexCount,
    xp: summaryProps.xp,
    scored: summaryProps.scored,
    flags: summaryProps.flags,
    hexes: Type.Array(WalkHexRef, { description: 'Sorted by h3 ascending; empty while active' }),
    path: NullableLineString,
  },
  { $id: 'WalkSummary', additionalProperties: false },
);
export type WalkSummary = Static<typeof WalkSummarySchema>;
export const WalkSummaryRef = Type.Unsafe<WalkSummary>({ $ref: 'WalkSummary#' });

export const WalkListItemSchema = Type.Object(
  {
    walkId: summaryProps.walkId,
    clientWalkId: summaryProps.clientWalkId,
    status: summaryProps.status,
    finishReason: summaryProps.finishReason,
    startedAt: summaryProps.startedAt,
    endedAt: summaryProps.endedAt,
    weekId: OrNull(Type.String()),
    distanceM: Type.Number(),
    durationS: Type.Integer(),
    hexCount: Type.Integer(),
    xp: Type.Integer(),
    scored: Type.Boolean(),
    flags: summaryProps.flags,
  },
  { $id: 'WalkListItem', additionalProperties: false },
);
export type WalkListItem = Static<typeof WalkListItemSchema>;
export const WalkListItemRef = Type.Unsafe<WalkListItem>({ $ref: 'WalkListItem#' });

export const WalkListPageSchema = Type.Object(
  {
    items: Type.Array(WalkListItemRef),
    nextCursor: OrNull(Type.String()),
  },
  { $id: 'WalkListPage', additionalProperties: false },
);
export type WalkListPage = Static<typeof WalkListPageSchema>;
export const WalkListPageRef = Type.Unsafe<WalkListPage>({ $ref: 'WalkListPage#' });

export const WalkIdParamsSchema = Type.Object(
  { id: Type.String({ format: 'uuid' }) },
  { additionalProperties: false },
);
export type WalkIdParams = Static<typeof WalkIdParamsSchema>;

export const WalkListQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ maxLength: 200 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 20 })),
  },
  { additionalProperties: false },
);
export type WalkListQuery = Static<typeof WalkListQuerySchema>;

/** Every component schema of this module, in a stable order (feeds `plugins/openapi.ts`). */
export const WALK_COMPONENT_SCHEMAS = [
  WalkCreateRequestSchema,
  WalkCreatedSchema,
  LocationSampleSchema,
  PedometerWindowSchema,
  SampleBatchRequestSchema,
  RejectedSampleSchema,
  SampleBatchResultSchema,
  WalkFinishRequestSchema,
  WeekStandingSchema,
  WalkHexSchema,
  LineStringSchema,
  WalkSummarySchema,
  WalkListItemSchema,
  WalkListPageSchema,
];
