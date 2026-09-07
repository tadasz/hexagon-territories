import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  JWT_SECRET_MIN_LENGTH,
  loadConfig,
  parseCommaList,
} from '../../src/config.js';

const DATABASE_URL = 'postgres://nature:nature@localhost:5432/nature';
const JWT_SECRET = 'a-development-secret-that-is-long-enough-0123';
const REQUIRED = { DATABASE_URL, JWT_SECRET };

describe('loadConfig', () => {
  it('applies defaults when only the required variables are set', () => {
    const config = loadConfig(REQUIRED);
    expect(config).toEqual({
      env: 'development',
      host: '0.0.0.0',
      port: 3000,
      logLevel: 'info',
      databaseUrl: DATABASE_URL,
      jobsEnabled: true,
      trustProxy: false,
      jwt: { secret: JWT_SECRET, accessTtlS: 900, refreshTtlDays: 60 },
      apple: {
        clientIds: ['com.natureexplorer.app'],
        jwksUrl: 'https://appleid.apple.com/auth/keys',
      },
      account: { purgeGraceDays: 30, exportTtlDays: 7, exportUrlTtlS: 3600 },
      rateLimit: { authPerMin: 20 },
      s3: {
        endpoint: 'http://localhost:9000',
        publicEndpoint: undefined,
        region: 'eu-central-1',
        bucket: 'nature-media',
        accessKey: undefined,
        secretKey: undefined,
      },
      walks: {
        autofinishAfterH: 12,
        sampleRetentionDays: 30,
        xpDailyCap: 300,
        ingestBatchesPer15Min: 30,
        samplesPerDay: 8640,
      },
      territory: { batchSize: 1000, bboxMaxCells: 3000, consistencyCron: '15 3 * * *' },
    });
  });

  it('converts string values to their declared types', () => {
    const config = loadConfig({
      ...REQUIRED,
      PORT: '4100',
      JOBS_ENABLED: 'false',
      TRUST_PROXY: 'true',
      LOG_LEVEL: 'debug',
      NODE_ENV: 'production',
      JWT_ACCESS_TTL_S: '600',
      REFRESH_TTL_DAYS: '30',
      AUTH_RATE_LIMIT_PER_MIN: '5',
      ACCOUNT_PURGE_GRACE_DAYS: '14',
      EXPORT_TTL_DAYS: '3',
      EXPORT_URL_TTL_S: '120',
      S3_ACCESS_KEY: 'nature',
      S3_SECRET_KEY: 'naturenature',
      S3_PUBLIC_ENDPOINT: 'http://192.168.1.10:9000',
      S3_REGION: 'fsn1',
      WALK_AUTOFINISH_AFTER_H: '6',
      WALK_SAMPLE_RETENTION_DAYS: '10',
      WALK_XP_DAILY_CAP: '50',
      WALK_INGEST_BATCHES_PER_15MIN: '100',
      WALK_SAMPLES_PER_DAY: '20000',
      RECKONING_BATCH_SIZE: '3',
      HEX_BBOX_MAX_CELLS: '50',
      RECKONING_CONSISTENCY_CRON: '0 4 * * *',
    });
    expect(config.territory).toEqual({
      batchSize: 3,
      bboxMaxCells: 50,
      consistencyCron: '0 4 * * *',
    });
    expect(config.walks).toEqual({
      autofinishAfterH: 6,
      sampleRetentionDays: 10,
      xpDailyCap: 50,
      ingestBatchesPer15Min: 100,
      samplesPerDay: 20000,
    });
    expect(config.port).toBe(4100);
    expect(config.jobsEnabled).toBe(false);
    expect(config.trustProxy).toBe(true);
    expect(config.logLevel).toBe('debug');
    expect(config.env).toBe('production');
    expect(config.jwt).toEqual({ secret: JWT_SECRET, accessTtlS: 600, refreshTtlDays: 30 });
    expect(config.rateLimit.authPerMin).toBe(5);
    expect(config.account).toEqual({ purgeGraceDays: 14, exportTtlDays: 3, exportUrlTtlS: 120 });
    expect(config.s3).toMatchObject({
      accessKey: 'nature',
      secretKey: 'naturenature',
      publicEndpoint: 'http://192.168.1.10:9000',
      region: 'fsn1',
    });
  });

  it('treats empty strings as unset', () => {
    const config = loadConfig({ ...REQUIRED, PORT: '', LOG_LEVEL: '' });
    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe('info');
  });

  it('rejects a missing DATABASE_URL naming the variable', () => {
    expect(() => loadConfig({ JWT_SECRET })).toThrow(ConfigError);
    try {
      loadConfig({ JWT_SECRET });
    } catch (err) {
      const error = err as ConfigError;
      expect(error.issues.map((issue) => issue.variable)).toContain('DATABASE_URL');
      expect(error.message).toMatch(/DATABASE_URL/);
    }
  });

  it('requires JWT_SECRET and rejects a short one', () => {
    expect(() => loadConfig({ DATABASE_URL })).toThrow(/JWT_SECRET/);
    let error: ConfigError | undefined;
    try {
      loadConfig({ DATABASE_URL, JWT_SECRET: 'x'.repeat(JWT_SECRET_MIN_LENGTH - 1) });
    } catch (err) {
      error = err as ConfigError;
    }
    expect(error).toBeInstanceOf(ConfigError);
    expect(error?.issues.map((issue) => issue.variable)).toEqual(['JWT_SECRET']);
    expect(
      loadConfig({ DATABASE_URL, JWT_SECRET: 'x'.repeat(JWT_SECRET_MIN_LENGTH) }).jwt.secret,
    ).toHaveLength(JWT_SECRET_MIN_LENGTH);
  });

  it('parses APPLE_CLIENT_IDS as a comma-separated list', () => {
    const config = loadConfig({
      ...REQUIRED,
      APPLE_CLIENT_IDS: 'com.natureexplorer.app, com.natureexplorer.app.beta ,,',
    });
    expect(config.apple.clientIds).toEqual([
      'com.natureexplorer.app',
      'com.natureexplorer.app.beta',
    ]);
    expect(parseCommaList(' a,b , c')).toEqual(['a', 'b', 'c']);
    expect(() => loadConfig({ ...REQUIRED, APPLE_CLIENT_IDS: ' , ' })).toThrow(/APPLE_CLIENT_IDS/);
  });

  it('reports every invalid variable at once', () => {
    let error: ConfigError | undefined;
    try {
      loadConfig({ DATABASE_URL: 'mysql://nope', PORT: '70000', LOG_LEVEL: 'loud' });
    } catch (err) {
      error = err as ConfigError;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const variables = error?.issues.map((issue) => issue.variable) ?? [];
    expect(variables).toEqual(
      expect.arrayContaining(['DATABASE_URL', 'PORT', 'LOG_LEVEL', 'JWT_SECRET']),
    );
  });

  it('ignores variables it does not declare', () => {
    const config = loadConfig({ ...REQUIRED, SOMETHING_ELSE: 'x' });
    expect(config).not.toHaveProperty('SOMETHING_ELSE');
  });
});
