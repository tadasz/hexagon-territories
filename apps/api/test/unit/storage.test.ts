import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  MemoryObjectStorage,
  S3ObjectStorage,
  type S3StorageOptions,
} from '../../src/lib/storage.js';
import { FakeClock } from '../helpers/clock.js';
import { parseMemoryUrl } from '../helpers/storage.js';

describe('MemoryObjectStorage', () => {
  it('round-trips objects, deletes idempotently and presigns with the clock', async () => {
    const clock = new FakeClock('2026-09-07T10:00:00.000Z');
    const storage = new MemoryObjectStorage(clock);
    expect(await storage.getObject('exports/u/e.json')).toBeNull();

    await storage.putObject('exports/u/e.json', '{"a":1}', 'application/json');
    expect((await storage.getObject('exports/u/e.json'))?.toString('utf8')).toBe('{"a":1}');
    expect(storage.objects.get('exports/u/e.json')?.contentType).toBe('application/json');

    const url = await storage.presignGet('exports/u/e.json', 3600);
    expect(parseMemoryUrl(url)).toEqual({
      key: 'exports/u/e.json',
      op: 'get',
      exp: Math.floor(clock.now().getTime() / 1000) + 3600,
    });
    expect(parseMemoryUrl(await storage.presignPut('media/x.jpg', 'image/jpeg', 60)).op).toBe(
      'put',
    );

    await storage.deleteObject('exports/u/e.json');
    await storage.deleteObject('exports/u/e.json');
    expect(await storage.getObject('exports/u/e.json')).toBeNull();
  });

  it('can be made to fail writes', async () => {
    const storage = new MemoryObjectStorage();
    storage.failPut = new Error('disk full');
    await expect(storage.putObject('k', 'v', 'text/plain')).rejects.toThrow('disk full');
  });
});

/** The parts of the SDK's HttpRequest / HttpResponse the stub and the assertions touch. */
interface StubRequest {
  method: string;
  hostname: string;
  port?: number;
  path: string;
  headers: Record<string, string>;
}
interface StubResponse {
  statusCode: number;
  headers: Record<string, string>;
  body?: Readable;
}

/** Records every HTTP request the SDK would send and answers with canned responses. */
function stubbedHandler(responder: (request: StubRequest) => StubResponse) {
  const requests: StubRequest[] = [];
  const handler = {
    handle: (request: StubRequest) => {
      requests.push(request);
      return Promise.resolve({ response: responder(request) });
    },
    updateHttpClientConfig: () => {},
    httpHandlerConfigs: () => ({}),
  } as unknown as NonNullable<S3StorageOptions['requestHandler']>;
  return { requests, handler };
}

const OPTIONS = {
  endpoint: 'http://minio:9000',
  publicEndpoint: 'http://localhost:9000',
  region: 'eu-central-1',
  bucket: 'nature-media',
  accessKey: 'nature',
  secretKey: 'naturenature',
};

describe('S3ObjectStorage (SDK request layer stubbed)', () => {
  it('puts objects path-style with bucket, key and content type', async () => {
    const stub = stubbedHandler(() => ({ statusCode: 200, headers: {} }));
    const storage = new S3ObjectStorage({ ...OPTIONS, requestHandler: stub.handler });
    await storage.putObject('exports/u1/e1.json', '{"x":1}', 'application/json');

    expect(stub.requests).toHaveLength(1);
    const request = stub.requests[0]!;
    expect(request.method).toBe('PUT');
    expect(request.hostname).toBe('minio');
    expect(request.port).toBe(9000);
    expect(request.path).toBe('/nature-media/exports/u1/e1.json');
    expect(request.headers['content-type']).toBe('application/json');
    expect(request.headers.authorization).toMatch(/AWS4-HMAC-SHA256 Credential=nature\//);
  });

  it('reads objects and maps a missing key to null', async () => {
    const stub = stubbedHandler((request): StubResponse =>
      request.path.endsWith('/missing.json')
        ? {
            statusCode: 404,
            headers: { 'content-type': 'application/xml' },
            body: Readable.from([
              Buffer.from(
                '<?xml version="1.0"?><Error><Code>NoSuchKey</Code><Message>nope</Message></Error>',
              ),
            ]),
          }
        : {
            statusCode: 200,
            headers: { 'content-type': 'application/json', 'content-length': '7' },
            body: Readable.from([Buffer.from('{"x":1}')]),
          },
    );
    const storage = new S3ObjectStorage({ ...OPTIONS, requestHandler: stub.handler });
    expect((await storage.getObject('exports/u1/e1.json'))?.toString('utf8')).toBe('{"x":1}');
    expect(await storage.getObject('exports/u1/missing.json')).toBeNull();
    expect(stub.requests.map((r) => r.method)).toEqual(['GET', 'GET']);
  });

  it('deletes by key', async () => {
    const stub = stubbedHandler(() => ({ statusCode: 204, headers: {} }));
    const storage = new S3ObjectStorage({ ...OPTIONS, requestHandler: stub.handler });
    await storage.deleteObject('exports/u1/e1.json');
    expect(stub.requests[0]).toMatchObject({
      method: 'DELETE',
      path: '/nature-media/exports/u1/e1.json',
    });
  });

  it('presigns GET URLs against the public endpoint with the requested expiry', async () => {
    const stub = stubbedHandler(() => ({ statusCode: 200, headers: {} }));
    const storage = new S3ObjectStorage({ ...OPTIONS, requestHandler: stub.handler });
    const url = new URL(await storage.presignGet('exports/u1/e1.json', 3600));
    expect(url.host).toBe('localhost:9000');
    expect(url.pathname).toBe('/nature-media/exports/u1/e1.json');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    // Presigning never sends a request.
    expect(stub.requests).toHaveLength(0);
  });

  it('falls back to the internal endpoint when no public endpoint is configured', async () => {
    const storage = new S3ObjectStorage({ ...OPTIONS, publicEndpoint: undefined });
    const url = new URL(await storage.presignPut('media/a.jpg', 'image/jpeg', 300, 1024));
    expect(url.host).toBe('minio:9000');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
  });
});
