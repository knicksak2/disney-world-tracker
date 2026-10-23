/**
 * Property 26: Startup rejects an invalid cron secret or pass interval and names the variable
 *
 * Validates: Requirements 8.10, 8.15
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
    ACCOUNT_DELETION_CRON_SECRET: 'test-account-deletion-cron-secret',
    SUPPORT_EMAIL: 'support@example.com',
    ADMIN_PANEL_USERNAME: 'admin-user',
    ADMIN_PANEL_PASSWORD: 'admin-password',
  };
}

describe('Config - Trip Booking (Property 26)', () => {
  // Feature: trip-booking-timeline, Property 26: startup rejects an invalid cron secret or pass interval
  it('Property 26: invalid TRIP_BOOKING_CRON_SECRET throws ConfigError naming the variable; valid secret succeeds', () => {
    const invalidSecretArb = fc.oneof(
      fc.constant<string | undefined>(undefined), // missing
      fc.constant(''), // empty
      fc.stringMatching(/^[ \t\r\n]+$/), // whitespace-only
      fc.constant('test-sampling-cron-secret'), // equals SAMPLING_CRON_SECRET
      fc.constant('test-pin-reconcile-secret'), // equals PIN_RECONCILE_CRON_SECRET
      fc.constant('  test-sampling-cron-secret  '), // equals SAMPLING_CRON_SECRET after trim
      fc.constant('  test-pin-reconcile-secret  '), // equals PIN_RECONCILE_CRON_SECRET after trim
    );

    fc.assert(
      fc.property(invalidSecretArb, (secret) => {
        const env = { ...validBaseEnv() };
        if (secret === undefined) {
          delete env.TRIP_BOOKING_CRON_SECRET;
        } else {
          env.TRIP_BOOKING_CRON_SECRET = secret;
        }

        try {
          loadConfig(env);
          expect.unreachable('loadConfig should have thrown ConfigError');
        } catch (err) {
          expect(err).toBeInstanceOf(ConfigError);
          const configError = err as ConfigError;
          expect(
            configError.issues.some((issue) => issue.includes('TRIP_BOOKING_CRON_SECRET')),
          ).toBe(true);
        }
      }),
      { numRuns: 100 },
    );

    // Valid, distinct secret succeeds and is exposed as tripBooking.cronSecret
    const validSecretArb = fc
      .string({ minLength: 1 })
      .filter((s) => {
        const trimmed = s.trim();
        return (
          trimmed.length > 0 &&
          trimmed !== 'test-sampling-cron-secret' &&
          trimmed !== 'test-pin-reconcile-secret'
        );
      });

    fc.assert(
      fc.property(validSecretArb, (secret) => {
        const env = { ...validBaseEnv(), TRIP_BOOKING_CRON_SECRET: secret };
        const cfg = loadConfig(env);
        expect(cfg.tripBooking.cronSecret).toBe(secret.trim());
      }),
      { numRuns: 100 },
    );
  });

  // Feature: trip-booking-timeline, Property 26: startup rejects an invalid cron secret or pass interval
  it('Property 26: BOOKING_REMINDER_MIN_PASS_INTERVAL_SECONDS accepts only integer 60..599 and defaults to 300', () => {
    // Biased generator with edge cases: 0, 59, 60, 300, 599, 600, non-integers, non-numeric strings
    const intervalArb = fc.oneof(
      fc.constantFrom(0, 59, 60, 300, 599, 600),
      fc.constantFrom('0', '59', '60', '300', '599', '600'),
      fc.constantFrom(60.5, 299.9, '60.5', 'not-a-number', '', '   '),
      fc.integer({ min: -100, max: 1000 }),
    );

    fc.assert(
      fc.property(intervalArb, (val) => {
        const env = {
          ...validBaseEnv(),
          BOOKING_REMINDER_MIN_PASS_INTERVAL_SECONDS: String(val),
        };

        const num = Number(val);
        const isValid =
          typeof val !== 'string' || val.trim().length > 0
            ? Number.isInteger(num) && num >= 60 && num <= 599
            : false;

        if (isValid) {
          const cfg = loadConfig(env);
          expect(cfg.tripBooking.reminder.minPassIntervalSeconds).toBe(num);
        } else {
          try {
            loadConfig(env);
            expect.unreachable('loadConfig should have thrown ConfigError');
          } catch (err) {
            expect(err).toBeInstanceOf(ConfigError);
            const configError = err as ConfigError;
            expect(
              configError.issues.some((issue) =>
                issue.includes('BOOKING_REMINDER_MIN_PASS_INTERVAL_SECONDS'),
              ),
            ).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );

    // When unset, defaults to 300
    const envWithoutInterval = { ...validBaseEnv() };
    delete envWithoutInterval.BOOKING_REMINDER_MIN_PASS_INTERVAL_SECONDS;
    const cfgDefault = loadConfig(envWithoutInterval);
    expect(cfgDefault.tripBooking.reminder.minPassIntervalSeconds).toBe(300);
  });
});
