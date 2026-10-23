/**
 * Property 23: Account-deletion configuration is validated at boot
 *
 * Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.6
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { loadConfig, ConfigError } from './config.js';

const SAMPLING = 'test-sampling-cron-secret';
const PINS = 'test-pin-reconcile-secret';
const TRIP = 'test-trip-booking-cron-secret';
const DELETION = 'test-account-deletion-cron-secret';
const PHOTOS = 'test-photo-sweep-cron-secret';

function validBaseEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/appdb',
    REDIS_URL: 'redis://localhost:6379',
    SESSION_SECRET: 'a'.repeat(32),
    DISNEY_SYNC_GATEWAY_USERNAME: 'disney-user',
    DISNEY_SYNC_GATEWAY_PASSWORD: 'disney-pass',
    SAMPLING_CRON_SECRET: SAMPLING,
    PIN_RECONCILE_CRON_SECRET: PINS,
    TRIP_BOOKING_CRON_SECRET: TRIP,
    ACCOUNT_DELETION_CRON_SECRET: DELETION,
    SUPPORT_EMAIL: 'support@example.com',
    ADMIN_PANEL_USERNAME: 'admin-user',
    ADMIN_PANEL_PASSWORD: 'admin-password',
  };
}

/** Loads the config and returns the ConfigError issues, failing the test if it did not throw. */
function issuesOf(env: NodeJS.ProcessEnv): readonly string[] {
  try {
    loadConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return (err as ConfigError).issues;
  }
  throw new Error('loadConfig should have thrown ConfigError');
}

const RANGES = {
  ACCOUNT_DELETION_GRACE_DAYS: { min: 1, max: 365, key: 'graceDays', dflt: 30 },
  ACCOUNT_DELETION_PURGE_BATCH: { min: 1, max: 100, key: 'purgeBatch', dflt: 10 },
  ACCOUNT_DELETION_PURGE_TIME_BUDGET_MS: {
    min: 1000,
    max: 120000,
    key: 'purgeTimeBudgetMs',
    dflt: 25000,
  },
  ACCOUNT_DELETION_REAUTH_WINDOW_SECONDS: {
    min: 30,
    max: 900,
    key: 'reauthWindowSeconds',
    dflt: 300,
  },
  ACCOUNT_DELETION_CHUNK_ROWS: { min: 50, max: 5000, key: 'chunkRows', dflt: 500 },
} as const;

type RangeName = keyof typeof RANGES;
const RANGE_NAMES = Object.keys(RANGES) as RangeName[];

describe('Config - Account Deletion (Property 23)', () => {
  // Feature: account-deletion, Property 23: Configuration is validated at boot
  it('Property 23: defaults apply when the optional variables are absent', () => {
    const cfg = loadConfig(validBaseEnv());
    expect(cfg.accountDeletion).toEqual({
      graceDays: 30,
      cronSecret: DELETION,
      purgeBatch: 10,
      purgeTimeBudgetMs: 25000,
      reauthWindowSeconds: 300,
      chunkRows: 500,
    });
  });

  // Feature: account-deletion, Property 23: Configuration is validated at boot
  it('Property 23: every in-range integer is accepted and exposed as a number', () => {
    for (const name of RANGE_NAMES) {
      const { min, max, key } = RANGES[name];
      fc.assert(
        fc.property(fc.integer({ min, max }), (n) => {
          const cfg = loadConfig({ ...validBaseEnv(), [name]: String(n) });
          expect(cfg.accountDeletion[key]).toBe(n);
        }),
        { numRuns: 100 },
      );
    }
  });

  // Feature: account-deletion, Property 23: Configuration is validated at boot
  it('Property 23: out-of-range integers are rejected and the issue names the variable', () => {
    for (const name of RANGE_NAMES) {
      const { min, max } = RANGES[name];
      const outside = fc.oneof(
        fc.integer({ min: min - 10_000, max: min - 1 }),
        fc.integer({ min: max + 1, max: max + 10_000 }),
      );
      fc.assert(
        fc.property(outside, (n) => {
          const issues = issuesOf({ ...validBaseEnv(), [name]: String(n) });
          expect(issues.some((i) => i.startsWith(`${name}:`))).toBe(true);
        }),
        { numRuns: 100 },
      );
    }
  });

  // Feature: account-deletion, Property 23: Configuration is validated at boot
  it('Property 23: GRACE_DAYS=0, non-integers and non-numeric values are rejected', () => {
    const bad = ['0', '-1', '1.5', '30.5', '0.5', 'abc', 'NaN', 'Infinity', ''];
    for (const name of RANGE_NAMES) {
      for (const value of bad) {
        const issues = issuesOf({ ...validBaseEnv(), [name]: value });
        expect(
          issues.some((i) => i.startsWith(`${name}:`)),
          `${name}=${JSON.stringify(value)} should be rejected`,
        ).toBe(true);
      }
    }
  });

  // Feature: account-deletion, Property 23: Configuration is validated at boot
  it('Property 23: a missing, empty or whitespace-only ACCOUNT_DELETION_CRON_SECRET is rejected', () => {
    const invalid = fc.oneof(
      fc.constant<string | undefined>(undefined),
      fc.constant(''),
      fc.stringMatching(/^[ \t\r\n]+$/),
    );
    fc.assert(
      fc.property(invalid, (secret) => {
        const env = validBaseEnv();
        if (secret === undefined) delete env.ACCOUNT_DELETION_CRON_SECRET;
        else env.ACCOUNT_DELETION_CRON_SECRET = secret;
        const issues = issuesOf(env);
        expect(issues.some((i) => i.includes('ACCOUNT_DELETION_CRON_SECRET'))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: account-deletion, Property 23: Configuration is validated at boot
  it('Property 23: a distinct secret is accepted and exposed trimmed', () => {
    const distinct = fc
      .string({ minLength: 1 })
      .filter((s) => {
        const t = s.trim();
        return t.length > 0 && ![SAMPLING, PINS, TRIP].includes(t);
      });
    fc.assert(
      fc.property(distinct, (s) => {
        const cfg = loadConfig({ ...validBaseEnv(), ACCOUNT_DELETION_CRON_SECRET: s });
        expect(cfg.accountDeletion.cronSecret).toBe(s.trim());
      }),
      { numRuns: 100 },
    );
  });

  // Feature: account-deletion, Property 23: Configuration is validated at boot
  it('Property 23: the secret must differ from each of the three required cron secrets (also after trim)', () => {
    const padding = fc.constantFrom('', ' ', '  ', '\t');
    const target = fc.constantFrom(
      ['SAMPLING_CRON_SECRET', SAMPLING],
      ['PIN_RECONCILE_CRON_SECRET', PINS],
      ['TRIP_BOOKING_CRON_SECRET', TRIP],
    );
    fc.assert(
      fc.property(target, padding, padding, ([, value], left, right) => {
        const env = {
          ...validBaseEnv(),
          ACCOUNT_DELETION_CRON_SECRET: `${left}${value}${right}`,
        };
        const issues = issuesOf(env);
        expect(issues.some((i) => i.startsWith('ACCOUNT_DELETION_CRON_SECRET:'))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: account-deletion, Property 23: Configuration is validated at boot
  it('Property 23: a non-blank PHOTOS_CRON_SECRET is compared (photos enabled or not)', () => {
    const photosEnabled = fc.constantFrom(undefined, 'false', 'true');
    fc.assert(
      fc.property(photosEnabled, (enabled) => {
        const env: NodeJS.ProcessEnv = {
          ...validBaseEnv(),
          PHOTOS_CRON_SECRET: DELETION,
          ACCOUNT_DELETION_CRON_SECRET: ` ${DELETION} `,
        };
        if (enabled !== undefined) env.PHOTOS_ENABLED = enabled;
        if (enabled === 'true') {
          Object.assign(env, {
            PHOTO_STORE_ENDPOINT: 'https://accountid.r2.cloudflarestorage.com',
            PHOTO_STORE_BUCKET: 'photos-bucket',
            PHOTO_STORE_ACCESS_KEY_ID: 'store-access-key',
            PHOTO_STORE_SECRET_ACCESS_KEY: 'store-secret-key',
            PHOTO_HARM_API_KEY: 'test-harm-api-key',
            PHOTO_VISION_API_KEY: 'test-vision-api-key',
          });
        }
        const issues = issuesOf(env);
        expect(issues.some((i) => i.startsWith('ACCOUNT_DELETION_CRON_SECRET:'))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: account-deletion, Property 23: Configuration is validated at boot
  it('Property 23: a blank or absent PHOTOS_CRON_SECRET is skipped, not compared', () => {
    const blank = fc.constantFrom<string | undefined>(undefined, '', ' ', '   ', '\t');
    fc.assert(
      fc.property(blank, (photos) => {
        const env = validBaseEnv();
        if (photos !== undefined) env.PHOTOS_CRON_SECRET = photos;
        const cfg = loadConfig(env);
        expect(cfg.accountDeletion.cronSecret).toBe(DELETION);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: account-deletion, Property 23: Configuration is validated at boot
  it('Property 23: a distinct non-blank PHOTOS_CRON_SECRET does not trip the rule', () => {
    const cfg = loadConfig({ ...validBaseEnv(), PHOTOS_CRON_SECRET: PHOTOS });
    expect(cfg.accountDeletion.cronSecret).toBe(DELETION);
  });

  // Feature: account-deletion, Property 23: Configuration is validated at boot
  it('Property 23: a missing, empty, whitespace-only or malformed SUPPORT_EMAIL is rejected, naming SUPPORT_EMAIL', () => {
    // No '@' at all, a missing local part or domain, an embedded space, and angle-bracket / placeholder text.
    const malformed = fc.oneof(
      fc.constant<string | undefined>(undefined),
      fc.constantFrom<string | undefined>(
        '',
        ' ',
        '   ',
        '\t',
        'support',
        'support@',
        '@example.com',
        'support@example',
        'sup port@example.com',
        '[Support Contact Email]',
        '<support@example.com>',
        'a@b@example.com',
      ),
      fc
        .stringMatching(/^[a-zA-Z0-9 .\-_]{1,30}$/)
        .filter((s) => !s.includes('@')),
    );
    fc.assert(
      fc.property(malformed, (value) => {
        const env = validBaseEnv();
        if (value === undefined) delete env.SUPPORT_EMAIL;
        else env.SUPPORT_EMAIL = value;

        const issues = issuesOf(env);
        expect(issues.some((i) => i.startsWith('SUPPORT_EMAIL:'))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: account-deletion, Property 23: Configuration is validated at boot
  it('Property 23: a valid SUPPORT_EMAIL is accepted, trimmed, and exposed as support.email', () => {
    const validEmail = fc
      .tuple(
        fc.stringMatching(/^[a-z0-9]{1,12}$/),
        fc.stringMatching(/^[a-z0-9]{1,10}$/),
        fc.constantFrom('com', 'org', 'net'),
      )
      .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);
    const padding = fc.constantFrom('', ' ', '  ', '\t', '\n');
    fc.assert(
      fc.property(validEmail, padding, padding, (email, left, right) => {
        const cfg = loadConfig({ ...validBaseEnv(), SUPPORT_EMAIL: `${left}${email}${right}` });
        expect(cfg.support.email).toBe(email);
      }),
      { numRuns: 100 },
    );
  });
});
