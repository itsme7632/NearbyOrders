import { describe, expect, it } from 'vitest';
import {
  buildApp,
  DEVELOPMENT_JWT_ACCESS_SECRET,
  DEVELOPMENT_JWT_REFRESH_SECRET,
  resolveServerConfig,
} from '../src/server.js';

/**
 * Production startup guards (P0): in production the server must fail fast on
 * missing/unsafe JWT secrets and CORS configuration instead of silently
 * running with development defaults. Non-production keeps the historical
 * silent defaults so local dev and this test suite are unaffected.
 *
 * These are pure unit tests of resolveServerConfig — no database needed.
 */

const prodEnv = (overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  JWT_ACCESS_SECRET: 'p0-valid-access-secret-0123456789abcdef',
  JWT_REFRESH_SECRET: 'p0-valid-refresh-secret-0123456789abcdef',
  CORS_ORIGIN: 'https://admin.example.com',
  ...overrides,
});

describe('resolveServerConfig production guards', () => {
  it('throws when JWT_ACCESS_SECRET is missing in production', () => {
    expect(() => resolveServerConfig(prodEnv({ JWT_ACCESS_SECRET: undefined }))).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('throws when JWT_REFRESH_SECRET is missing in production', () => {
    expect(() => resolveServerConfig(prodEnv({ JWT_REFRESH_SECRET: undefined }))).toThrow(/JWT_REFRESH_SECRET/);
  });

  it('throws when the access secret is the known development default', () => {
    expect(() =>
      resolveServerConfig(prodEnv({ JWT_ACCESS_SECRET: DEVELOPMENT_JWT_ACCESS_SECRET })),
    ).toThrow(/development\/default/);
  });

  it('throws when the refresh secret is the known development default', () => {
    expect(() =>
      resolveServerConfig(prodEnv({ JWT_REFRESH_SECRET: DEVELOPMENT_JWT_REFRESH_SECRET })),
    ).toThrow(/development\/default/);
  });

  it('throws when a secret is the docker-compose placeholder value', () => {
    expect(() =>
      resolveServerConfig(prodEnv({ JWT_ACCESS_SECRET: 'change-me-at-least-32-characters' })),
    ).toThrow(/development\/default/);
  });

  it('throws when a production secret is shorter than 32 characters', () => {
    expect(() => resolveServerConfig(prodEnv({ JWT_ACCESS_SECRET: 'too-short' }))).toThrow(/32/);
  });

  it('never echoes secret values in startup errors', () => {
    const secret = 's3cr3t-access-value-that-must-not-leak-1234';
    let message = '';
    try {
      resolveServerConfig(prodEnv({ JWT_ACCESS_SECRET: secret, JWT_REFRESH_SECRET: undefined }));
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('JWT_REFRESH_SECRET');
    expect(message).not.toContain(secret);
    expect(message).not.toContain('s3cr3t');
  });

  it('throws when CORS_ORIGIN is missing in production', () => {
    expect(() => resolveServerConfig(prodEnv({ CORS_ORIGIN: undefined }))).toThrow(/CORS_ORIGIN/);
  });

  it('throws when CORS_ORIGIN is a wildcard in production', () => {
    expect(() => resolveServerConfig(prodEnv({ CORS_ORIGIN: '*' }))).toThrow(/unsafe/);
    expect(() => resolveServerConfig(prodEnv({ CORS_ORIGIN: 'https://a.example.com, *' }))).toThrow(/unsafe/);
  });

  it('accepts valid production secrets and splits comma-separated origins', () => {
    const config = resolveServerConfig(
      prodEnv({ CORS_ORIGIN: 'https://admin.example.com, https://ops.example.com' }),
    );
    expect(config.accessSecret).toBe('p0-valid-access-secret-0123456789abcdef');
    expect(config.refreshSecret).toBe('p0-valid-refresh-secret-0123456789abcdef');
    expect(config.corsOrigins).toEqual(['https://admin.example.com', 'https://ops.example.com']);
  });
});

describe('resolveServerConfig non-production behavior', () => {
  it('keeps silent dev defaults outside production', () => {
    const config = resolveServerConfig({ NODE_ENV: 'test' });
    expect(config.accessSecret).toBe(DEVELOPMENT_JWT_ACCESS_SECRET);
    expect(config.refreshSecret).toBe(DEVELOPMENT_JWT_REFRESH_SECRET);
    expect(config.corsOrigins).toEqual(['http://localhost:5173']);
  });

  it('accepts dev default secrets when explicitly set outside production', () => {
    const config = resolveServerConfig({
      NODE_ENV: 'development',
      JWT_ACCESS_SECRET: DEVELOPMENT_JWT_ACCESS_SECRET,
      JWT_REFRESH_SECRET: DEVELOPMENT_JWT_REFRESH_SECRET,
    });
    expect(config.accessSecret).toBe(DEVELOPMENT_JWT_ACCESS_SECRET);
  });
});

describe('buildApp production boot', () => {
  const KEYS = ['NODE_ENV', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'CORS_ORIGIN'] as const;

  /** Runs fn with the given process.env overrides, restoring afterwards. */
  async function withEnv(overrides: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
    const prev: Record<string, string | undefined> = {};
    for (const key of KEYS) prev[key] = process.env[key];
    for (const key of KEYS) {
      const value = overrides[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      await fn();
    } finally {
      for (const key of KEYS) {
        const value = prev[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  it('rejects before binding when production secrets are missing', async () => {
    await withEnv(
      { NODE_ENV: 'production', JWT_ACCESS_SECRET: undefined, JWT_REFRESH_SECRET: undefined },
      async () => {
        await expect(buildApp()).rejects.toThrow(/JWT_ACCESS_SECRET/);
      },
    );
  });

  it('rejects before binding when production uses a development secret', async () => {
    await withEnv(
      {
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: DEVELOPMENT_JWT_ACCESS_SECRET,
        JWT_REFRESH_SECRET: 'p0-boot-refresh-secret-0123456789abcdef',
        CORS_ORIGIN: 'https://admin.example.com',
      },
      async () => {
        await expect(buildApp()).rejects.toThrow(/development\/default/);
      },
    );
  });

  it('rejects before binding when production CORS_ORIGIN is missing', async () => {
    await withEnv(
      {
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'p0-boot-access-secret-0123456789abcdef',
        JWT_REFRESH_SECRET: 'p0-boot-refresh-secret-0123456789abcdef',
        CORS_ORIGIN: undefined,
      },
      async () => {
        await expect(buildApp()).rejects.toThrow(/CORS_ORIGIN/);
      },
    );
  });

  it('boots with a valid production configuration', async () => {
    await withEnv(
      {
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'p0-boot-access-secret-0123456789abcdef',
        JWT_REFRESH_SECRET: 'p0-boot-refresh-secret-0123456789abcdef',
        CORS_ORIGIN: 'https://admin.example.com',
      },
      async () => {
        const app = await buildApp();
        try {
          const res = await app.inject({ method: 'GET', url: '/health' });
          expect(res.statusCode).toBe(200);
          expect(res.json()).toEqual({ status: 'ok' });
        } finally {
          await app.close();
        }
      },
    );
  });
});
