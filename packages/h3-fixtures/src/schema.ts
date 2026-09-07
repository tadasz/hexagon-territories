/**
 * TypeBox schemas for the four shared fixtures (see `specs/001-repo-foundations/data-model.md` §1).
 *
 * The generator exports these to `schema/<name>.schema.json` so the Swift port
 * (`apps/ios/Packages/TerritoryRules`) can mirror them as `Codable` structs. Unknown
 * properties are rejected everywhere (`additionalProperties: false`).
 */
import { Type, type Static, type TSchema } from '@sinclair/typebox';

// ---------------------------------------------------------------------------
// Primitives shared by every fixture
// ---------------------------------------------------------------------------

/** H3 index as a 15-character lowercase hex string. */
export const H3Cell = Type.String({ pattern: '^[0-9a-f]{15}$', description: 'H3 index string' });

/** WGS84 coordinate in decimal degrees. */
export const LatLng = Type.Object(
  {
    lat: Type.Number({ minimum: -90, maximum: 90 }),
    lon: Type.Number({ minimum: -180, maximum: 180 }),
  },
  { additionalProperties: false },
);

/** Faction id or `null` for "unclaimed". */
export const FactionOrNull = Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]);

const Finite = Type.Number({ description: 'finite number' });
const Id = Type.String({ minLength: 1, description: 'unique within the file; used in test names' });

/** Envelope fields present on every fixture file (`data-model.md` §1.1). */
const envelope = (name: string) => ({
  name: Type.Literal(name, { description: 'equals the file name without .json' }),
  description: Type.String({ minLength: 1 }),
  generator: Type.String({ pattern: '^scripts/generate\\.ts#[A-Za-z]+$' }),
  version: Type.Integer({
    minimum: 1,
    description: 'bump when the shape (not the values) changes',
  }),
  seed: Type.Integer({ description: 'PRNG seed used by the generator' }),
});

// ---------------------------------------------------------------------------
// latlng-to-cell.json
// ---------------------------------------------------------------------------

export const LatLngToCellCase = Type.Object(
  {
    id: Id,
    input: LatLng,
    expected: Type.Object(
      {
        r9: H3Cell,
        parents: Type.Object(
          { r8: H3Cell, r7: H3Cell, r6: H3Cell, r5: H3Cell },
          { additionalProperties: false },
        ),
        boundaryVertexCount: Type.Union([Type.Literal(5), Type.Literal(6), Type.Literal(10)], {
          description:
            '6 for hexagons; 5 for pentagons at class II (even) resolutions, 10 at class III (odd) resolutions such as 9',
        }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const LatLngToCellFixture = Type.Object(
  { ...envelope('latlng-to-cell'), cases: Type.Array(LatLngToCellCase, { minItems: 1 }) },
  { additionalProperties: false, $id: 'latlng-to-cell', title: 'latlng-to-cell fixture' },
);

// ---------------------------------------------------------------------------
// zoom-resolution.json
// ---------------------------------------------------------------------------

export const ZoomResolutionCase = Type.Object(
  {
    id: Id,
    input: Type.Object({ zoom: Finite }, { additionalProperties: false }),
    expected: Type.Object(
      { resolution: Type.Integer({ minimum: 0, maximum: 15 }) },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const ZoomResolutionFixture = Type.Object(
  { ...envelope('zoom-resolution'), cases: Type.Array(ZoomResolutionCase, { minItems: 1 }) },
  { additionalProperties: false, $id: 'zoom-resolution', title: 'zoom-resolution fixture' },
);

// ---------------------------------------------------------------------------
// walk-paths.json
// ---------------------------------------------------------------------------

const OptionalNullableNumber = Type.Optional(Type.Union([Finite, Type.Null()]));

/** One raw location sample, as posted by the device (`data-model.md` §2 `Sample`). */
export const Sample = Type.Object(
  {
    seq: Type.Integer({ minimum: 0 }),
    ts: Type.String({
      pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$',
      description: 'ISO 8601 UTC timestamp (Z suffix)',
    }),
    lat: Type.Number({ minimum: -90, maximum: 90 }),
    lon: Type.Number({ minimum: -180, maximum: 180 }),
    hAcc: Type.Number({ minimum: 0, description: 'horizontal accuracy in metres' }),
    speed: OptionalNullableNumber,
    course: OptionalNullableNumber,
    alt: OptionalNullableNumber,
  },
  { additionalProperties: false },
);

export const RejectReason = Type.Union([
  Type.Literal('accuracy'),
  Type.Literal('speed'),
  Type.Literal('non_monotonic'),
]);

export const WalkFlag = Type.Union([
  Type.Literal('teleport'),
  Type.Literal('speed'),
  Type.Literal('distance'),
  Type.Literal('no_steps'),
]);

export const HexMeters = Type.Object(
  { cell: H3Cell, meters: Type.Number({ minimum: 0 }) },
  { additionalProperties: false },
);

export const WalkPathCase = Type.Object(
  {
    id: Id,
    description: Type.String({ minLength: 1 }),
    input: Type.Object(
      {
        resolution: Type.Integer({ minimum: 0, maximum: 15 }),
        simplifyToleranceM: Type.Number({ minimum: 0 }),
        pedometerSteps: Type.Optional(Type.Integer({ minimum: 0 })),
        samples: Type.Array(Sample),
      },
      { additionalProperties: false },
    ),
    expected: Type.Object(
      {
        acceptedSeqs: Type.Array(Type.Integer({ minimum: 0 })),
        rejected: Type.Array(
          Type.Object(
            { seq: Type.Integer({ minimum: 0 }), reason: RejectReason },
            { additionalProperties: false },
          ),
        ),
        flags: Type.Array(WalkFlag),
        distanceM: Type.Number({
          minimum: 0,
          description: 'haversine length of the simplified accepted path',
        }),
        simplifiedPointCount: Type.Integer({ minimum: 0 }),
        hexMeters: Type.Array(HexMeters, {
          description: 'sorted by cell ascending; tolerance ±0.5 m',
        }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const WalkPathsFixture = Type.Object(
  { ...envelope('walk-paths'), cases: Type.Array(WalkPathCase, { minItems: 1 }) },
  { additionalProperties: false, $id: 'walk-paths', title: 'walk-paths fixture' },
);

// ---------------------------------------------------------------------------
// reckoning-weeks.json
// ---------------------------------------------------------------------------

const FactionId = Type.Integer({ minimum: 1 });
const UserId = Type.String({ minLength: 1 });
const WeekId = Type.String({ pattern: '^\\d{4}-W\\d{2}$', description: 'ISO week id, UTC' });

export const FactionStrength = Type.Object(
  { factionId: FactionId, strength: Type.Number({ minimum: 0 }) },
  { additionalProperties: false },
);

export const CellState = Type.Object(
  { owner: FactionOrNull, strengths: Type.Array(FactionStrength) },
  { additionalProperties: false },
);

export const RawContribution = Type.Object(
  { factionId: FactionId, userId: UserId, meters: Type.Number({ minimum: 0 }) },
  { additionalProperties: false },
);

export const OwnershipEvent = Type.Object(
  { from: FactionOrNull, to: FactionOrNull },
  { additionalProperties: false },
);

export const ReckoningWeekCase = Type.Object(
  {
    weekId: WeekId,
    contributions: Type.Array(RawContribution, {
      description: 'raw per (faction,user); the test applies applyWeeklyCap first',
    }),
    bonuses: Type.Array(RawContribution, { description: 'verified capture bonuses; never capped' }),
    expected: Type.Object(
      {
        capped: Type.Array(
          Type.Object(
            { factionId: FactionId, userId: UserId, cappedMeters: Type.Number({ minimum: 0 }) },
            { additionalProperties: false },
          ),
        ),
        strengths: Type.Array(FactionStrength, {
          description: 'sorted by factionId; tolerance ±0.01',
        }),
        owner: FactionOrNull,
        flipped: Type.Boolean(),
        event: Type.Optional(OwnershipEvent),
        captain: Type.Union([UserId, Type.Null()], {
          description:
            'top walking contributor (capped metres) of the owning faction, ties by userId asc; null when unclaimed or no walk metres',
        }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const ReckoningCellCase = Type.Object(
  {
    id: Id,
    description: Type.String({ minLength: 1 }),
    cell: H3Cell,
    initial: CellState,
    weeks: Type.Array(ReckoningWeekCase, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export const ParentCase = Type.Object(
  {
    id: Id,
    input: Type.Object({ childOwners: Type.Array(FactionOrNull) }, { additionalProperties: false }),
    expected: Type.Object({ owner: FactionOrNull }, { additionalProperties: false }),
  },
  { additionalProperties: false },
);

export const ReckoningWeeksFixture = Type.Object(
  {
    ...envelope('reckoning-weeks'),
    factions: Type.Array(FactionId, { minItems: 1 }),
    weeks: Type.Array(WeekId, { minItems: 1 }),
    cells: Type.Array(ReckoningCellCase, { minItems: 1 }),
    parentCases: Type.Array(ParentCase, { minItems: 1 }),
  },
  { additionalProperties: false, $id: 'reckoning-weeks', title: 'reckoning-weeks fixture' },
);

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const FIXTURE_SCHEMAS = {
  'latlng-to-cell': LatLngToCellFixture,
  'zoom-resolution': ZoomResolutionFixture,
  'walk-paths': WalkPathsFixture,
  'reckoning-weeks': ReckoningWeeksFixture,
} as const satisfies Record<string, TSchema>;

export type FixtureName = keyof typeof FIXTURE_SCHEMAS;
export const FIXTURE_NAMES = Object.keys(FIXTURE_SCHEMAS) as FixtureName[];

export type FixtureOf<N extends FixtureName> = Static<(typeof FIXTURE_SCHEMAS)[N]>;

export type LatLngToCellFixture = Static<typeof LatLngToCellFixture>;
export type LatLngToCellCase = Static<typeof LatLngToCellCase>;
export type ZoomResolutionFixture = Static<typeof ZoomResolutionFixture>;
export type ZoomResolutionCase = Static<typeof ZoomResolutionCase>;
export type WalkPathsFixture = Static<typeof WalkPathsFixture>;
export type WalkPathCase = Static<typeof WalkPathCase>;
export type Sample = Static<typeof Sample>;
export type RejectReason = Static<typeof RejectReason>;
export type WalkFlag = Static<typeof WalkFlag>;
export type HexMeters = Static<typeof HexMeters>;
export type ReckoningWeeksFixture = Static<typeof ReckoningWeeksFixture>;
export type ReckoningCellCase = Static<typeof ReckoningCellCase>;
export type ReckoningWeekCase = Static<typeof ReckoningWeekCase>;
export type CellState = Static<typeof CellState>;
export type FactionStrength = Static<typeof FactionStrength>;
export type RawContribution = Static<typeof RawContribution>;
export type OwnershipEvent = Static<typeof OwnershipEvent>;
export type ParentCase = Static<typeof ParentCase>;
export type LatLng = Static<typeof LatLng>;
