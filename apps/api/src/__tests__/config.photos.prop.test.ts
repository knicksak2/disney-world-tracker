/**
 * Property 23: Configuration validation
 *
 * Validates: Requirements 8.14, 8.18, 20.2, 20.3, 20.4, 20.8, 6.6, 26.6, 27.1, 27.13
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
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
    ADMIN_PANEL_USERNAME: 'admin-user',
    ADMIN_PANEL_PASSWORD: 'admin-password',
  };
}

function validPhotosEnv(): NodeJS.ProcessEnv {
  return {
    ...validBaseEnv(),
    PHOTOS_ENABLED: 'true',
    PHOTOS_CRON_SECRET: 'test-photo-sweep-cron-secret',
    PHOTO_STORE_ENDPOINT: 'https://accountid.r2.cloudflarestorage.com',
    PHOTO_STORE_BUCKET: 'photos-bucket',
    PHOTO_STORE_ACCESS_KEY_ID: 'store-access-key',
    PHOTO_STORE_SECRET_ACCESS_KEY: 'store-secret-key',
    PHOTO_HARM_API_KEY: 'test-harm-api-key',
    PHOTO_VISION_API_KEY: 'test-vision-api-key',
  };
}

describe('Config - Photo Uploads (Property 23)', () => {
  // Feature: photo-uploads, Property 23: Configuration validation
  it('Property 23: with PHOTOS_ENABLED false or unset, loadConfig never fails on photo variables', () => {
    const photoEnvArbitrary = fc.record({
      PHOTOS_ENABLED: fc.constantFrom('false', '', undefined),
      PHOTOS_CRON_SECRET: fc.constantFrom(
        'test-sampling-cron-secret',
        'test-pin-reconcile-secret',
        '',
        undefined,
      ),
      PHOTO_STORE_ENDPOINT: fc.constantFrom('', undefined, 'not-a-url'),
      PHOTO_STORE_BUCKET: fc.constantFrom('', undefined),
      PHOTO_HARM_API_KEY: fc.constantFrom('', undefined),
      PHOTO_VISION_API_KEY: fc.constantFrom('', undefined),
      PHOTOS_MODERATION_LEASE_SECONDS: fc.constantFrom('1', '10', '0'),
      PHOTOS_NEEDS_REVIEW_MAX_AGE_HOURS: fc.constantFrom('500', '1000'),
      PHOTOS_UPLOAD_PREFIX_EXPIRY_DAYS: fc.constantFrom('1'),
      PHOTOS_RECAP_HIGHLIGHT_MAX: fc.constantFrom('0', '25', '99', 'not-int'),
      PHOTOS_EXPERIENCE_STRIP_MAX: fc.constantFrom('0', '25', '99', 'not-int'),
    });

    fc.assert(
      fc.property(photoEnvArbitrary, (photoOverrides) => {
        const env = { ...validBaseEnv(), ...photoOverrides };
        const cfg = loadConfig(env);
        expect(cfg.photos.enabled).toBe(false);
        expect(cfg.photos.recapHighlightMax).toBeDefined();
        expect(cfg.photos.experienceStripMax).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });

  // Feature: photo-uploads, Property 23: Configuration validation
  it('Property 23: with PHOTOS_ENABLED true, missing required vars fail and name the offending variable', () => {
    const requiredVars = [
      'PHOTO_STORE_ENDPOINT',
      'PHOTO_STORE_BUCKET',
      'PHOTO_STORE_ACCESS_KEY_ID',
      'PHOTO_STORE_SECRET_ACCESS_KEY',
      'PHOTO_HARM_API_KEY',
      'PHOTOS_CRON_SECRET',
    ] as const;

    for (const varName of requiredVars) {
      const env = { ...validPhotosEnv() };
      delete env[varName];

      expect(() => loadConfig(env)).toThrow(ConfigError);
      try {
        loadConfig(env);
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        const configError = err as ConfigError;
        expect(configError.issues.some((issue) => issue.includes(varName))).toBe(true);
      }
    }
  });

  // Feature: photo-uploads, Property 23: Configuration validation
  it('Property 23: PHOTOS_CRON_SECRET collision with any other cron secret fails', () => {
    const collidingSecrets = [
      'test-sampling-cron-secret',
      'test-pin-reconcile-secret',
      'test-trip-booking-cron-secret',
      '  test-sampling-cron-secret  ',
      '  test-pin-reconcile-secret  ',
      '  test-trip-booking-cron-secret  ',
    ];

    for (const secret of collidingSecrets) {
      const env = { ...validPhotosEnv(), PHOTOS_CRON_SECRET: secret };
      expect(() => loadConfig(env)).toThrow(ConfigError);
      try {
        loadConfig(env);
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        const configError = err as ConfigError;
        expect(
          configError.issues.some((issue) => issue.includes('PHOTOS_CRON_SECRET')),
        ).toBe(true);
      }
    }
  });

  // Feature: photo-uploads, Property 23: Configuration validation
  it('Property 23: PHOTO_VISION_API_KEY required when PHOTOS_FOOD_ENABLED is true, optional when false', () => {
    // Missing vision key with food enabled throws
    const envFoodOn: NodeJS.ProcessEnv = { ...validPhotosEnv(), PHOTOS_FOOD_ENABLED: 'true' };
    delete envFoodOn.PHOTO_VISION_API_KEY;
    expect(() => loadConfig(envFoodOn)).toThrow(ConfigError);

    // Missing vision key with food disabled succeeds
    const envFoodOff: NodeJS.ProcessEnv = { ...validPhotosEnv(), PHOTOS_FOOD_ENABLED: 'false' };
    delete envFoodOff.PHOTO_VISION_API_KEY;
    const cfg = loadConfig(envFoodOff);
    expect(cfg.photos.foodEnabled).toBe(false);
  });

  // Feature: photo-uploads, Property 23: Configuration validation
  it('Property 23: PHOTOS_MODERATION_LEASE_SECONDS must be at least ceil(max(2 * harm, 2 * (3 * vision + 2000)) / 1000) + 10', () => {
    // With harm=15000 and vision=20000:
    // 2 * 15000 = 30000; 2 * (3 * 20000 + 2000) = 124000
    // ceil(124000 / 1000) + 10 = 134 seconds minimum
    const envBelow = { ...validPhotosEnv(), PHOTOS_MODERATION_LEASE_SECONDS: '133' };
    expect(() => loadConfig(envBelow)).toThrow(ConfigError);

    const envAtMin = { ...validPhotosEnv(), PHOTOS_MODERATION_LEASE_SECONDS: '134' };
    const cfg = loadConfig(envAtMin);
    expect(cfg.photos.moderation.leaseSeconds).toBe(134);
  });

  // Feature: photo-uploads, Property 23: Configuration validation
  it('Property 23: PHOTOS_NEEDS_REVIEW_MAX_AGE_HOURS + 24 must be <= PHOTOS_UPLOAD_PREFIX_EXPIRY_DAYS * 24', () => {
    // If upload prefix expiry days is 7 (168 hours):
    // 145 + 24 = 169 > 168 -> fails
    const envFailing = {
      ...validPhotosEnv(),
      PHOTOS_UPLOAD_PREFIX_EXPIRY_DAYS: '7',
      PHOTOS_NEEDS_REVIEW_MAX_AGE_HOURS: '145',
    };
    expect(() => loadConfig(envFailing)).toThrow(ConfigError);

    // 144 + 24 = 168 <= 168 -> succeeds
    const envPassing = {
      ...validPhotosEnv(),
      PHOTOS_UPLOAD_PREFIX_EXPIRY_DAYS: '7',
      PHOTOS_NEEDS_REVIEW_MAX_AGE_HOURS: '144',
    };
    const cfg = loadConfig(envPassing);
    expect(cfg.photos.moderation.needsReviewMaxAgeHours).toBe(144);
  });

  // Feature: photo-uploads, Property 23: Configuration validation
  it('Property 23: PHOTOS_RECAP_HIGHLIGHT_MAX and PHOTOS_EXPERIENCE_STRIP_MAX accept only integers 1..24', () => {
    const invalidValues = ['0', '25', '-1', '100', '1.5'];

    for (const val of invalidValues) {
      const envRecap = { ...validPhotosEnv(), PHOTOS_RECAP_HIGHLIGHT_MAX: val };
      expect(() => loadConfig(envRecap)).toThrow(ConfigError);

      const envStrip = { ...validPhotosEnv(), PHOTOS_EXPERIENCE_STRIP_MAX: val };
      expect(() => loadConfig(envStrip)).toThrow(ConfigError);
    }

    const envValid = {
      ...validPhotosEnv(),
      PHOTOS_RECAP_HIGHLIGHT_MAX: '12',
      PHOTOS_EXPERIENCE_STRIP_MAX: '16',
    };
    const cfg = loadConfig(envValid);
    expect(cfg.photos.recapHighlightMax).toBe(12);
    expect(cfg.photos.experienceStripMax).toBe(16);
  });

  // Feature: photo-uploads, Property 23: Configuration validation
  it('Property 23: PHOTO_HARM_INVALID_IMAGE_CODES parses as a comma-separated list; empty string gives []', () => {
    const envEmpty = { ...validPhotosEnv(), PHOTO_HARM_INVALID_IMAGE_CODES: '' };
    expect(loadConfig(envEmpty).photos.harm.invalidImageCodes).toEqual([]);

    const envCodes = {
      ...validPhotosEnv(),
      PHOTO_HARM_INVALID_IMAGE_CODES: ' unreadable_image, bad_encoding , corrupt ',
    };
    expect(loadConfig(envCodes).photos.harm.invalidImageCodes).toEqual([
      'unreadable_image',
      'bad_encoding',
      'corrupt',
    ]);
  });
});
