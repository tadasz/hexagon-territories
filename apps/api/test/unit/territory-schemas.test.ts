import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import {
  HexDetailSchema,
  HexListItemSchema,
  HexListQuerySchema,
  HexReckoningEntrySchema,
  ReckoningLatestSchema,
  ReckoningRunRequestSchema,
  ReckoningRunResultSchema,
  ReckoningStatusSchema,
  TERRITORY_COMPONENT_SCHEMAS,
} from '../../src/modules/territory/schemas.js';

describe('territory TypeBox schemas (data-model.md §2)', () => {
  it('registers every component of the contract with a $id and no extra properties', () => {
    expect(TERRITORY_COMPONENT_SCHEMAS.map((s) => s.$id)).toEqual([
      'HexListItem',
      'HexList',
      'FactionStrength',
      'HexWeekFaction',
      'HexWeek',
      'HexCaptain',
      'HexMe',
      'HexReckoningEntry',
      'HexDetail',
      'FactionTotal',
      'ReckoningLatest',
      'ReckoningRunRequest',
      'FlipPreview',
      'ReckoningRunResult',
      'ReckoningQueued',
      'ReckoningStatus',
    ]);
    for (const schema of TERRITORY_COMPONENT_SCHEMAS) {
      expect(schema.additionalProperties, schema.$id).toBe(false);
    }
  });

  it('renders nullable primitives as type: [x, null] and the captain as an inline nullable object', () => {
    expect(HexListItemSchema.properties.owner.type).toEqual(['integer', 'null']);
    expect(HexListItemSchema.properties.ownerSince.type).toEqual(['string', 'null']);
    expect(ReckoningLatestSchema.properties.weekId.type).toEqual(['string', 'null']);
    // Not `oneOf: [$ref, null]`: swift-openapi-generator drops such a property and the generated
    // client would reject every response carrying a captain (003 analysis.md I1, 004 analysis.md I1).
    for (const captain of [
      HexDetailSchema.properties.captain,
      HexReckoningEntrySchema.properties.captain,
    ]) {
      expect(captain).not.toHaveProperty('oneOf');
      expect(captain).toMatchObject({
        type: ['object', 'null'],
        additionalProperties: false,
        required: ['userId', 'displayName'],
      });
    }
    expect(HexDetailSchema.required).toEqual([
      'h3',
      'owner',
      'ownerSince',
      'captain',
      'strengths',
      'week',
      'me',
      'reckonings',
      'captures',
    ]);
    expect(HexDetailSchema.properties.reckonings.maxItems).toBe(8);
  });

  it('validates well-formed and rejects malformed values (plain schemas; Ajv checks the OrNull ones at runtime)', () => {
    expect(HexListItemSchema.properties.h3.pattern).toBe('^[0-9a-f]{15}$');
    expect(HexListItemSchema.required).toEqual([
      'h3',
      'res',
      'owner',
      'ownerSince',
      'pressureLeader',
      'contested',
    ]);
    expect(Value.Check(HexListQuerySchema, { res: 9, bbox: '23.85,54.87,23.98,54.93' })).toBe(true);
    expect(Value.Check(HexListQuerySchema, { res: 4, bbox: '23.85,54.87,23.98,54.93' })).toBe(
      false,
    );
    expect(Value.Check(HexListQuerySchema, { res: 9, bbox: '23.85,54.87,23.98' })).toBe(false);
    expect(Value.Check(ReckoningRunRequestSchema, {})).toBe(true);
    expect(Value.Check(ReckoningRunRequestSchema, { dryRun: true, sync: true })).toBe(true);
    expect(Value.Check(ReckoningRunRequestSchema, { week: '2026-W36' })).toBe(false);
    expect(ReckoningStatusSchema.properties.status.enum).toEqual(['running', 'done', 'failed']);
    expect(ReckoningStatusSchema.properties.stage.enum).toEqual([
      'walks',
      'cells',
      'rollup',
      'push',
      'done',
    ]);
    expect(ReckoningStatusSchema.properties.finishedAt.type).toEqual(['string', 'null']);
    expect(ReckoningRunResultSchema.properties.flipsPreview.maxItems).toBe(1000);
    expect(ReckoningRunResultSchema.required).toEqual([
      'weekId',
      'dryRun',
      'status',
      'resumed',
      'hexesProcessed',
      'flips',
      'parentFlips',
      'walksAutofinished',
      'staleWalksSkipped',
      'pushQueued',
      'leaderboardRows',
      'durationMs',
      'startedAt',
      'finishedAt',
      'flipsPreview',
    ]);
  });
});
