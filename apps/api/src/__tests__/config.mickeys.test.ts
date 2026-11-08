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

describe('Config - Hidden Mickeys (hidden-mickeys spec, Task 1.5)', () => {
  it('loads with default values when MICKEYS_* env vars are unset', () => {
    const config = loadConfig(validBaseEnv());
    expect(config.mickeys).toBeDefined();
    expect(config.mickeys).toEqual({
      enabled: true,
      submissionsEnabled: true,
      submissionMode: 'publish',
      textScreenEnabled: true,
      submissionsPerDay: 5,
      reportAutohide: 3,
      communityVerifiedMin: 3,
      confidencePriorValue: 0.9,
      confidencePriorWeight: 3,
      confidenceHalfLifeDays: 90,
      confidenceConfirmedMin: 0.65,
      confidenceUncertainMin: 0.4,
    });
  });

  it('accepts explicit valid configuration overrides', () => {
    const env: NodeJS.ProcessEnv = {
      ...validBaseEnv(),
      MICKEYS_ENABLED: 'true',
      MICKEYS_SUBMISSIONS_ENABLED: 'true',
      MICKEYS_SUBMISSION_MODE: 'publish',
      MICKEYS_TEXT_SCREEN_ENABLED: 'true',
      MICKEYS_SUBMISSIONS_PER_DAY: '10',
      MICKEYS_REPORT_AUTOHIDE: '5',
      MICKEYS_COMMUNITY_VERIFIED_MIN: '4',
      MICKEYS_CONFIDENCE_PRIOR_VALUE: '0.8',
      MICKEYS_CONFIDENCE_PRIOR_WEIGHT: '5',
      MICKEYS_CONFIDENCE_HALF_LIFE_DAYS: '60',
      MICKEYS_CONFIDENCE_CONFIRMED_MIN: '0.7',
      MICKEYS_CONFIDENCE_UNCERTAIN_MIN: '0.3',
    };
    const config = loadConfig(env);
    expect(config.mickeys).toEqual({
      enabled: true,
      submissionsEnabled: true,
      submissionMode: 'publish',
      textScreenEnabled: true,
      submissionsPerDay: 10,
      reportAutohide: 5,
      communityVerifiedMin: 4,
      confidencePriorValue: 0.8,
      confidencePriorWeight: 5,
      confidenceHalfLifeDays: 60,
      confidenceConfirmedMin: 0.7,
      confidenceUncertainMin: 0.3,
    });
  });

  it('falls back out-of-range or invalid numeric variables to their defaults', () => {
    const env: NodeJS.ProcessEnv = {
      ...validBaseEnv(),
      MICKEYS_SUBMISSIONS_PER_DAY: '-1',
      MICKEYS_REPORT_AUTOHIDE: '0',
      MICKEYS_COMMUNITY_VERIFIED_MIN: 'not-a-number',
      MICKEYS_CONFIDENCE_PRIOR_VALUE: '1.5',
      MICKEYS_CONFIDENCE_PRIOR_WEIGHT: '-2',
      MICKEYS_CONFIDENCE_HALF_LIFE_DAYS: '0',
      MICKEYS_CONFIDENCE_CONFIRMED_MIN: '-0.1',
      MICKEYS_CONFIDENCE_UNCERTAIN_MIN: '2.5',
    };
    const config = loadConfig(env);
    expect(config.mickeys.submissionsPerDay).toBe(5);
    expect(config.mickeys.reportAutohide).toBe(3);
    expect(config.mickeys.communityVerifiedMin).toBe(3);
    expect(config.mickeys.confidencePriorValue).toBe(0.9);
    expect(config.mickeys.confidencePriorWeight).toBe(3);
    expect(config.mickeys.confidenceHalfLifeDays).toBe(90);
    expect(config.mickeys.confidenceConfirmedMin).toBe(0.65);
    expect(config.mickeys.confidenceUncertainMin).toBe(0.4);
  });

  it('fails startup when submissions enabled in publish mode but PHOTO_HARM_API_KEY is missing', () => {
    const env: NodeJS.ProcessEnv = {
      ...validBaseEnv(),
      PHOTO_HARM_API_KEY: '',
    };
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const issues = (err as ConfigError).issues;
      expect(issues.some((i) => i.includes('PHOTO_HARM_API_KEY'))).toBe(true);
    }
  });

  it('fails startup when submissions enabled in publish mode but text screening is disabled', () => {
    const env: NodeJS.ProcessEnv = {
      ...validBaseEnv(),
      MICKEYS_TEXT_SCREEN_ENABLED: 'false',
    };
    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const issues = (err as ConfigError).issues;
      expect(issues.some((i) => i.includes('MICKEYS_TEXT_SCREEN_ENABLED'))).toBe(true);
    }
  });

  it('succeeds without PHOTO_HARM_API_KEY when MICKEYS_SUBMISSION_MODE is review', () => {
    const env: NodeJS.ProcessEnv = {
      ...validBaseEnv(),
      MICKEYS_SUBMISSION_MODE: 'review',
      PHOTO_HARM_API_KEY: '',
    };
    const config = loadConfig(env);
    expect(config.mickeys.submissionMode).toBe('review');
  });

  it('succeeds without PHOTO_HARM_API_KEY when MICKEYS_SUBMISSIONS_ENABLED is false', () => {
    const env: NodeJS.ProcessEnv = {
      ...validBaseEnv(),
      MICKEYS_SUBMISSIONS_ENABLED: 'false',
      PHOTO_HARM_API_KEY: '',
    };
    const config = loadConfig(env);
    expect(config.mickeys.submissionsEnabled).toBe(false);
  });

  it('succeeds without PHOTO_HARM_API_KEY when MICKEYS_ENABLED is false', () => {
    const env: NodeJS.ProcessEnv = {
      ...validBaseEnv(),
      MICKEYS_ENABLED: 'false',
      PHOTO_HARM_API_KEY: '',
    };
    const config = loadConfig(env);
    expect(config.mickeys.enabled).toBe(false);
  });
});
