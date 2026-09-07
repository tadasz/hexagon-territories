import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { S3ObjectStorage } from '../../src/lib/storage.js';

/**
 * Opt-in check against a real S3-compatible store (MinIO from `make dev`):
 *
 *   S3_TEST=1 S3_ENDPOINT=http://localhost:9000 S3_ACCESS_KEY=nature S3_SECRET_KEY=naturenature \
 *     pnpm --filter @nature/api test -- storage
 *
 * Without `S3_TEST=1` the suite is skipped with a printed reason (quickstart.md A.6). The unit
 * suite `test/unit/storage.test.ts` covers the SDK request layer with a stub.
 */
const enabled = process.env.S3_TEST === '1';
const reason = 'S3_TEST is not set (needs MinIO or another S3-compatible endpoint)';
if (!enabled) console.warn(`skipped: S3 integration test — ${reason}`);

(enabled ? describe : describe.skip)('S3ObjectStorage against a live endpoint', () => {
  const storage = new S3ObjectStorage({
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT,
    region: process.env.S3_REGION ?? 'eu-central-1',
    bucket: process.env.S3_BUCKET ?? 'nature-media',
    accessKey: process.env.S3_ACCESS_KEY ?? 'nature',
    secretKey: process.env.S3_SECRET_KEY ?? 'naturenature',
  });
  const key = `exports/storage-test/${randomUUID()}.json`;

  it('writes, reads, presigns and deletes an object', async () => {
    await storage.putObject(key, '{"hello":"minio"}', 'application/json');
    expect((await storage.getObject(key))?.toString('utf8')).toBe('{"hello":"minio"}');

    const url = await storage.presignGet(key, 60);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"hello":"minio"}');

    await storage.deleteObject(key);
    expect(await storage.getObject(key)).toBeNull();
    await storage.deleteObject(key);
  });
});
