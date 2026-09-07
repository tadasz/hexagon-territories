import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Object storage behind presigned URLs (ADR 0010; specs/002-auth-and-factions/research.md R9).
 * Feature 002 uses `putObject`, `getObject`, `deleteObject` and `presignGet` for export bundles;
 * `presignPut` is defined now so media uploads (006/007) share the interface.
 */
export interface ObjectStorage {
  putObject(key: string, body: Buffer | string, contentType: string): Promise<void>;
  /** The object's bytes, or null when the key does not exist. */
  getObject(key: string): Promise<Buffer | null>;
  /** Idempotent: deleting a missing key succeeds. */
  deleteObject(key: string): Promise<void>;
  presignGet(key: string, expiresInS: number): Promise<string>;
  presignPut(
    key: string,
    contentType: string,
    expiresInS: number,
    maxBytes?: number,
  ): Promise<string>;
}

export interface S3StorageOptions {
  endpoint: string;
  /** Endpoint written into presigned URLs when clients cannot reach `endpoint` (e.g. MinIO in Compose). */
  publicEndpoint?: string | undefined;
  region: string;
  bucket: string;
  accessKey?: string | undefined;
  secretKey?: string | undefined;
  /** Replaces the SDK's HTTP layer (unit tests). */
  requestHandler?: S3ClientConfig['requestHandler'];
}

function clientConfig(opts: S3StorageOptions, endpoint: string): S3ClientConfig {
  const config: S3ClientConfig = {
    endpoint,
    region: opts.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: opts.accessKey ?? '',
      secretAccessKey: opts.secretKey ?? '',
    },
  };
  if (opts.requestHandler) config.requestHandler = opts.requestHandler;
  return config;
}

/** S3-compatible storage (MinIO locally, Hetzner Object Storage in production) via the AWS SDK v3. */
export class S3ObjectStorage implements ObjectStorage {
  readonly bucket: string;
  private readonly client: S3Client;
  /** Signs against the public endpoint so a phone can open the URL; same credentials. */
  private readonly presignClient: S3Client;

  constructor(opts: S3StorageOptions) {
    this.bucket = opts.bucket;
    this.client = new S3Client(clientConfig(opts, opts.endpoint));
    this.presignClient =
      opts.publicEndpoint && opts.publicEndpoint !== opts.endpoint
        ? new S3Client(clientConfig(opts, opts.publicEndpoint))
        : this.client;
  }

  async putObject(key: string, body: Buffer | string, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async getObject(key: string): Promise<Buffer | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!result.Body) return Buffer.alloc(0);
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (err) {
      if (err instanceof NoSuchKey) return null;
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  presignGet(key: string, expiresInS: number): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInS },
    );
  }

  presignPut(
    key: string,
    contentType: string,
    expiresInS: number,
    maxBytes?: number,
  ): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ...(maxBytes === undefined ? {} : { ContentLength: maxBytes }),
      }),
      { expiresIn: expiresInS },
    );
  }
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404;
}

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

/**
 * Map-backed storage for unit tests and the in-process export job tests. Presigned URLs are
 * `memory://<key>?exp=<unix seconds>` so tests can assert the key and the expiry.
 */
export class MemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, StoredObject>();
  /** Optional failure injection: throw from `putObject` when set. */
  failPut: Error | null = null;

  constructor(private readonly clock: { now(): Date } = { now: () => new Date() }) {}

  putObject(key: string, body: Buffer | string, contentType: string): Promise<void> {
    if (this.failPut) return Promise.reject(this.failPut);
    this.objects.set(key, {
      body: typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body),
      contentType,
    });
    return Promise.resolve();
  }

  getObject(key: string): Promise<Buffer | null> {
    const stored = this.objects.get(key);
    return Promise.resolve(stored ? Buffer.from(stored.body) : null);
  }

  deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  presignGet(key: string, expiresInS: number): Promise<string> {
    return Promise.resolve(this.url(key, expiresInS, 'get'));
  }

  presignPut(key: string, _contentType: string, expiresInS: number): Promise<string> {
    return Promise.resolve(this.url(key, expiresInS, 'put'));
  }

  private url(key: string, expiresInS: number, op: string): string {
    const exp = Math.floor(this.clock.now().getTime() / 1_000) + expiresInS;
    return `memory://${key}?op=${op}&exp=${exp}`;
  }
}
