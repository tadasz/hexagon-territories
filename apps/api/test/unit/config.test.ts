import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';

const DATABASE_URL = 'postgres://nature:nature@localhost:5432/nature';

describe('loadConfig', () => {
  it('applies defaults when only DATABASE_URL is set', () => {
    const config = loadConfig({ DATABASE_URL });
    expect(config).toEqual({
      env: 'development',
      host: '0.0.0.0',
      port: 3000,
      logLevel: 'info',
      databaseUrl: DATABASE_URL,
      jobsEnabled: true,
      s3: {
        endpoint: 'http://localhost:9000',
        bucket: 'nature-media',
        accessKey: undefined,
        secretKey: undefined,
      },
    });
  });

  it('converts string values to their declared types', () => {
    const config = loadConfig({
      DATABASE_URL,
      PORT: '4100',
      JOBS_ENABLED: 'false',
      LOG_LEVEL: 'debug',
      NODE_ENV: 'production',
      S3_ACCESS_KEY: 'nature',
      S3_SECRET_KEY: 'naturenature',
    });
    expect(config.port).toBe(4100);
    expect(config.jobsEnabled).toBe(false);
    expect(config.logLevel).toBe('debug');
    expect(config.env).toBe('production');
    expect(config.s3.accessKey).toBe('nature');
    expect(config.s3.secretKey).toBe('naturenature');
  });

  it('treats empty strings as unset', () => {
    const config = loadConfig({ DATABASE_URL, PORT: '', LOG_LEVEL: '' });
    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe('info');
  });

  it('rejects a missing DATABASE_URL naming the variable', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    try {
      loadConfig({});
    } catch (err) {
      const error = err as ConfigError;
      expect(error.issues.map((issue) => issue.variable)).toContain('DATABASE_URL');
      expect(error.message).toMatch(/DATABASE_URL/);
    }
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
    expect(variables).toEqual(expect.arrayContaining(['DATABASE_URL', 'PORT', 'LOG_LEVEL']));
  });

  it('ignores variables it does not declare', () => {
    const config = loadConfig({ DATABASE_URL, SOMETHING_ELSE: 'x' });
    expect(config).not.toHaveProperty('SOMETHING_ELSE');
  });
});
