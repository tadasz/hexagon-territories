import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  generateOpenApiSnapshot,
  IOS_COPY_PATH,
  SNAPSHOT_COMMAND,
  SNAPSHOT_PATH,
} from '../scripts/snapshot-lib.js';
import { OPENAPI_PATH, readOpenApiDocument } from '../src/index.js';

describe('packages/api-schema/openapi.json', () => {
  it('is the current output of the API (SC-007)', async () => {
    const generated = await generateOpenApiSnapshot();
    const committed = readFileSync(SNAPSHOT_PATH, 'utf8');
    expect(committed, `openapi.json is stale — run ${SNAPSHOT_COMMAND}`).toBe(generated);
  });

  it('is exported by the package and describes the 002 and 003 endpoints', () => {
    expect(OPENAPI_PATH).toBe(SNAPSHOT_PATH);
    const doc = readOpenApiDocument() as {
      openapi: string;
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
    };
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/health',
      '/openapi.json',
      '/v1/auth/apple',
      '/v1/auth/logout',
      '/v1/auth/refresh',
      '/v1/factions',
      '/v1/me',
      '/v1/me/export',
      '/v1/me/faction',
      '/v1/walks',
      '/v1/walks/{id}',
      '/v1/walks/{id}/finish',
      '/v1/walks/{id}/samples',
    ]);
    expect(doc.components.securitySchemes).toHaveProperty('bearerAuth');
    expect(Object.keys(doc.components.schemas)).toEqual(
      expect.arrayContaining([
        'Error',
        'Me',
        'FactionsResponse',
        'TokenPair',
        'ExportStatus',
        'WalkSummary',
        'SampleBatchResult',
        'LineString',
      ]),
    );
  });

  // Until Stream C syncs the snapshot (tasks.md T028) the iOS package may hold a temporary copy
  // converted from contracts/openapi.yaml (T020); that fragment is recognised by its description
  // and tolerated. Anything else present there must equal the snapshot byte for byte.
  const iosCopy = existsSync(IOS_COPY_PATH) ? readFileSync(IOS_COPY_PATH, 'utf8') : null;
  const isContractFragment =
    iosCopy !== null &&
    (
      (JSON.parse(iosCopy) as { info?: { description?: string } }).info?.description ?? ''
    ).startsWith('Fragment for feature');
  if (iosCopy === null) {
    console.warn(
      `skipped: iOS copy check — ${IOS_COPY_PATH} is absent (Stream C runs apps/ios/scripts/sync-openapi.sh)`,
    );
  } else if (isContractFragment) {
    console.warn(
      `skipped: iOS copy check — ${IOS_COPY_PATH} is the temporary contract fragment of tasks.md T020; run apps/ios/scripts/sync-openapi.sh (T028) to replace it with the snapshot`,
    );
  }
  (iosCopy !== null && !isContractFragment ? it : it.skip)(
    'equals the copy inside the iOS APIClient package',
    () => {
      expect(
        iosCopy,
        'apps/ios/.../openapi.json differs from the snapshot — run apps/ios/scripts/sync-openapi.sh',
      ).toBe(readFileSync(SNAPSHOT_PATH, 'utf8'));
    },
  );
});
