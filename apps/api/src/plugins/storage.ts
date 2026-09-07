import fp from 'fastify-plugin';
import type { AppConfig } from '../config.js';
import { S3ObjectStorage, type ObjectStorage } from '../lib/storage.js';

export interface StoragePluginOptions {
  s3: AppConfig['s3'];
  /** Inject a storage (tests use `MemoryObjectStorage`). Defaults to S3 from config. */
  storage?: ObjectStorage;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Object storage for export bundles and (later) media. */
    storage: ObjectStorage;
  }
}

/** Decorates `fastify.storage` with the configured S3-compatible storage or an injected one. */
export const storagePlugin = fp<StoragePluginOptions>(
  (fastify, opts, done) => {
    const storage =
      opts.storage ??
      new S3ObjectStorage({
        endpoint: opts.s3.endpoint,
        publicEndpoint: opts.s3.publicEndpoint,
        region: opts.s3.region,
        bucket: opts.s3.bucket,
        accessKey: opts.s3.accessKey,
        secretKey: opts.s3.secretKey,
      });
    fastify.decorate('storage', storage);
    done();
  },
  { name: 'storage', fastify: '5.x' },
);
