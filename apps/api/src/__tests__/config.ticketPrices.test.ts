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

describe('Config - Ticket prices (trip-budget spec, task 8.4)', () => {
  it('loads with default values when TICKET_PRICES_* env vars are unset', () => {
    const config = loadConfig(validBaseEnv());
    expect(config.ticketPrices).toBeDefined();
    const tp = config.ticketPrices!;
    expect(tp.enabled).toBe(false);
    expect(tp.baseUrl).toBe('https://disneyworld.disney.go.com');
    expect(tp.groups).toEqual(['std-gst']);
    expect(tp.flResidentNumDays).toEqual([4]);
    expect(tp.staleAfterDays).toBe(30);
    expect(tp.minAttemptIntervalHours).toBe(24);
    expect(tp.probeMinIntervalHours).toBe(24);
    expect(tp.requestSpacingMs).toBe(1500);
    expect(tp.blockCooldownMinutes).toBe(360);
    expect(tp.userAgent).toBe('DwtTripBudget/1.0 (personal trip planner)');
    expect(tp.requestTimeoutMs).toBe(20000);
    expect(tp.maxBodyBytes).toBe(5000000);
    expect(tp.sanityMinRatio).toBe(0.5);
    expect(tp.maxUnrecognizedFraction).toBe(0.1);
    expect(tp.diagnoseMinIntervalSeconds).toBe(60);
    expect(tp.freshDays).toBe(45);
    expect(tp.estimateAfterDays).toBe(120);
    expect(tp.maxConsecutiveFailures).toBe(2);
    expect(tp.failureCooldownMinutes).toBe(60);
  });

  describe('TICKET_PRICES_ENABLED boolean coercion', () => {
    it.each([
      [undefined, false],
      ['', false],
      ['0', false],
      ['false', false],
      ['1', true],
      ['true', true],
    ])('coerces %s to %s', (rawVal, expected) => {
      const env = { ...validBaseEnv() };
      if (rawVal !== undefined) {
        env.TICKET_PRICES_ENABLED = rawVal;
      } else {
        delete env.TICKET_PRICES_ENABLED;
      }
      const config = loadConfig(env);
      expect(config.ticketPrices?.enabled).toBe(expected);
    });
  });

  describe('Validation failures reporting variable name', () => {
    it('fails when TICKET_PRICES_BASE_URL is http://', () => {
      const env = { ...validBaseEnv(), TICKET_PRICES_BASE_URL: 'http://disneyworld.disney.go.com' };
      expect(() => loadConfig(env)).toThrowError(ConfigError);
      try {
        loadConfig(env);
      } catch (err: any) {
        expect(err).toBeInstanceOf(ConfigError);
        expect(err.message).toContain('TICKET_PRICES_BASE_URL');
      }
    });

    it('fails when TICKET_PRICES_GROUPS contains invalid group "foo"', () => {
      const env = { ...validBaseEnv(), TICKET_PRICES_GROUPS: 'std-gst,foo' };
      expect(() => loadConfig(env)).toThrowError(ConfigError);
      try {
        loadConfig(env);
      } catch (err: any) {
        expect(err).toBeInstanceOf(ConfigError);
        expect(err.message).toContain('TICKET_PRICES_GROUPS');
      }
    });

    it('fails when TICKET_PRICES_GROUPS contains fl-resident without std-gst', () => {
      const env = { ...validBaseEnv(), TICKET_PRICES_GROUPS: 'fl-resident' };
      expect(() => loadConfig(env)).toThrowError(ConfigError);
      try {
        loadConfig(env);
      } catch (err: any) {
        expect(err).toBeInstanceOf(ConfigError);
        expect(err.message).toContain('TICKET_PRICES_GROUPS');
      }
    });

    it('fails when TICKET_PRICES_FL_RESIDENT_NUMDAYS contains 0', () => {
      const env = { ...validBaseEnv(), TICKET_PRICES_FL_RESIDENT_NUMDAYS: '0,4' };
      expect(() => loadConfig(env)).toThrowError(ConfigError);
      try {
        loadConfig(env);
      } catch (err: any) {
        expect(err).toBeInstanceOf(ConfigError);
        expect(err.message).toContain('TICKET_PRICES_FL_RESIDENT_NUMDAYS');
      }
    });

    it('fails when TICKET_PRICES_FL_RESIDENT_NUMDAYS contains 11', () => {
      const env = { ...validBaseEnv(), TICKET_PRICES_FL_RESIDENT_NUMDAYS: '4,11' };
      expect(() => loadConfig(env)).toThrowError(ConfigError);
      try {
        loadConfig(env);
      } catch (err: any) {
        expect(err).toBeInstanceOf(ConfigError);
        expect(err.message).toContain('TICKET_PRICES_FL_RESIDENT_NUMDAYS');
      }
    });

    it('fails when TICKET_PRICES_SANITY_MIN_RATIO is 1.5', () => {
      const env = { ...validBaseEnv(), TICKET_PRICES_SANITY_MIN_RATIO: '1.5' };
      expect(() => loadConfig(env)).toThrowError(ConfigError);
      try {
        loadConfig(env);
      } catch (err: any) {
        expect(err).toBeInstanceOf(ConfigError);
        expect(err.message).toContain('TICKET_PRICES_SANITY_MIN_RATIO');
      }
    });

    it('fails when TICKET_PRICES_MAX_UNRECOGNIZED_FRACTION is negative or > 1', () => {
      const env = { ...validBaseEnv(), TICKET_PRICES_MAX_UNRECOGNIZED_FRACTION: '1.2' };
      expect(() => loadConfig(env)).toThrowError(ConfigError);
      try {
        loadConfig(env);
      } catch (err: any) {
        expect(err).toBeInstanceOf(ConfigError);
        expect(err.message).toContain('TICKET_PRICES_MAX_UNRECOGNIZED_FRACTION');
      }
    });

    it('fails when TICKET_PRICES_LABEL_FRESH_DAYS >= TICKET_PRICES_LABEL_ESTIMATE_AFTER_DAYS', () => {
      const env = {
        ...validBaseEnv(),
        TICKET_PRICES_LABEL_FRESH_DAYS: '120',
        TICKET_PRICES_LABEL_ESTIMATE_AFTER_DAYS: '120',
      };
      expect(() => loadConfig(env)).toThrowError(ConfigError);
      try {
        loadConfig(env);
      } catch (err: any) {
        expect(err).toBeInstanceOf(ConfigError);
        expect(err.message).toContain('TICKET_PRICES_LABEL_FRESH_DAYS');
      }
    });

    it('fails when TICKET_PRICES_USER_AGENT contains Mozilla/5.0 or Chrome', () => {
      const env = {
        ...validBaseEnv(),
        TICKET_PRICES_USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      };
      expect(() => loadConfig(env)).toThrowError(ConfigError);
      try {
        loadConfig(env);
      } catch (err: any) {
        expect(err).toBeInstanceOf(ConfigError);
        expect(err.message).toContain('TICKET_PRICES_USER_AGENT');
      }
    });

    const positiveIntCases = [
      'TICKET_PRICES_STALE_AFTER_DAYS',
      'TICKET_PRICES_MIN_ATTEMPT_INTERVAL_HOURS',
      'TICKET_PRICES_PROBE_MIN_INTERVAL_HOURS',
      'TICKET_PRICES_BLOCK_COOLDOWN_MINUTES',
      'TICKET_PRICES_FAILURE_COOLDOWN_MINUTES',
      'TICKET_PRICES_DIAGNOSE_MIN_INTERVAL_SECONDS',
      'TICKET_PRICES_REQUEST_SPACING_MS',
      'TICKET_PRICES_REQUEST_TIMEOUT_MS',
      'TICKET_PRICES_MAX_BODY_BYTES',
      'TICKET_PRICES_MAX_CONSECUTIVE_FAILURES',
    ];

    for (const varName of positiveIntCases) {
      it(`fails when ${varName} is 0 or negative`, () => {
        const env = { ...validBaseEnv(), [varName]: '0' };
        expect(() => loadConfig(env)).toThrowError(ConfigError);
        try {
          loadConfig(env);
        } catch (err: any) {
          expect(err).toBeInstanceOf(ConfigError);
          expect(err.message).toContain(varName);
        }
      });
    }
  });
});
