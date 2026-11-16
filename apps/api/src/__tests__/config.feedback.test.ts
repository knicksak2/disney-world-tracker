import { describe, it, expect } from 'vitest';
import { loadConfig } from '../config.js';

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

describe('Config - in-app feedback (in-app-feedback spec, Configuration & Constants)', () => {
  it('uses the documented defaults when FEEDBACK_* env vars are unset', () => {
    expect(loadConfig(validBaseEnv()).feedback).toEqual({ perHour: 5, perDay: 20, retentionDays: 90 });
  });

  it('accepts explicit valid overrides', () => {
    const config = loadConfig({
      ...validBaseEnv(),
      FEEDBACK_PER_HOUR: '2',
      FEEDBACK_PER_DAY: '7',
      FEEDBACK_RETENTION_DAYS: '30',
    });
    expect(config.feedback).toEqual({ perHour: 2, perDay: 7, retentionDays: 30 });
  });

  it('falls back to the defaults for zero, negative, fractional and non-numeric values', () => {
    for (const bad of ['0', '-3', '2.5', 'abc']) {
      const config = loadConfig({
        ...validBaseEnv(),
        FEEDBACK_PER_HOUR: bad,
        FEEDBACK_PER_DAY: bad,
        FEEDBACK_RETENTION_DAYS: bad,
      });
      expect(config.feedback, bad).toEqual({ perHour: 5, perDay: 20, retentionDays: 90 });
    }
  });

  it('bounds retention to 1..3650 days, falling back to 90 outside the range', () => {
    expect(loadConfig({ ...validBaseEnv(), FEEDBACK_RETENTION_DAYS: '3650' }).feedback.retentionDays).toBe(3650);
    expect(loadConfig({ ...validBaseEnv(), FEEDBACK_RETENTION_DAYS: '3651' }).feedback.retentionDays).toBe(90);
  });
});
