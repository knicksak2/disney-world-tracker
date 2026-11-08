import { describe, it, expect } from 'vitest';
import { loadConfig, ConfigError } from '../config.js';

function validBaseEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/appdb',
    REDIS_URL: 'redis://localhost:6379',
    SESSION_SECRET: 'a'.repeat(32),
    DISNEY_SYNC_GATEWAY_USERNAME: 'disney-user',
    DISNEY_SYNC_GATEWAY_PASSWORD: 'disney-pass',
    SAMPLING_CRON_SECRET: 'test-sampling-cron-secret',
    PIN_RECONCILE_CRON_SECRET: 'test-pin-reconcile-secret',
    TRIP_BOOKING_CRON_SECRET: 'test-trip-booking-cron-secret',
    ACCOUNT_DELETION_CRON_SECRET: 'test-account-deletion-cron-secret',
    SUPPORT_EMAIL: 'support@example.com',
    ADMIN_PANEL_USERNAME: 'admin-user',
    ADMIN_PANEL_PASSWORD: 'admin-password',
    PHOTO_HARM_API_KEY: 'test-harm-api-key',
  };
}

describe('Config - Lightning Lane prices', () => {
  it('loads with default values when LL_* env vars are unset', () => {
    const config = loadConfig(validBaseEnv());
    expect(config.lightningLane).toBeDefined();
    expect(config.lightningLane?.minRefreshHours).toBe(12);
    expect(config.lightningLane?.staleHours).toBe(72);
    expect(config.lightningLane?.retentionDays).toBe(400);
    expect(config.lightningLane?.typicalLookbackDays).toBe(400);
    expect(config.lightningLane?.typicalMinSamples).toBe(4);
  });

  it('loads custom valid values when LL_* env vars are set', () => {
    const env = {
      ...validBaseEnv(),
      LL_PRICES_MIN_REFRESH_HOURS: '6',
      LL_PRICES_STALE_HOURS: '48',
      LL_PRICES_RETENTION_DAYS: '365',
      LL_TYPICAL_LOOKBACK_DAYS: '365',
      LL_TYPICAL_MIN_SAMPLES: '5',
    };
    const config = loadConfig(env);
    expect(config.lightningLane?.minRefreshHours).toBe(6);
    expect(config.lightningLane?.staleHours).toBe(48);
    expect(config.lightningLane?.retentionDays).toBe(365);
    expect(config.lightningLane?.typicalLookbackDays).toBe(365);
    expect(config.lightningLane?.typicalMinSamples).toBe(5);
  });

  const testCases: Array<{ key: string; invalidValues: string[] }> = [
    { key: 'LL_PRICES_MIN_REFRESH_HOURS', invalidValues: ['0', '-1', 'abc', '1.5'] },
    { key: 'LL_PRICES_STALE_HOURS', invalidValues: ['0', '-5', 'invalid', '2.4'] },
    { key: 'LL_PRICES_RETENTION_DAYS', invalidValues: ['0', '-100', 'xyz', '3.14'] },
    { key: 'LL_TYPICAL_LOOKBACK_DAYS', invalidValues: ['0', '-400', 'foo', '10.5'] },
    { key: 'LL_TYPICAL_MIN_SAMPLES', invalidValues: ['0', '-2', 'bar', '1.1'] },
  ];

  for (const { key, invalidValues } of testCases) {
    for (const val of invalidValues) {
      it(`fails boot when ${key} is invalid (${val})`, () => {
        const env = { ...validBaseEnv(), [key]: val };
        expect(() => loadConfig(env)).toThrowError(ConfigError);
        try {
          loadConfig(env);
        } catch (err: any) {
          expect(err).toBeInstanceOf(ConfigError);
          expect(err.message).toContain(key);
        }
      });
    }
  }
});

