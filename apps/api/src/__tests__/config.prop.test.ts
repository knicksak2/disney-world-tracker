// Feature: disney-source-resilience, Property 16: Configuration fail-fast
/**
 * Property-based test for the configuration fail-fast invariant.
 *
 * Validates: Requirements 14.2, 14.5
 *
 * Property 16 (design.md → Correctness Properties → "Configuration fail-fast"):
 *
 *   For any nonempty subset of the required credential variables set to
 *   empty/absent, and for any configured Disney/ThemeParks URL set to a
 *   malformed value, `loadConfig` SHALL throw a `ConfigError` whose message
 *   names each offending variable, and SHALL succeed otherwise.
 *
 * Requirement 14.2: IF the Static_Credentials username or password is absent or
 * empty at application startup, THEN the configuration loader SHALL halt startup
 * before the API accepts any request and SHALL emit an error message naming each
 * missing credential value.
 *
 * Requirement 14.5: IF a configured Disney_Source or ThemeParks_Wiki URL is not
 * a well-formed absolute URL, THEN the configuration loader SHALL halt startup
 * before the API accepts any request and SHALL emit an error message identifying
 * the invalid value.
 *
 * Test strategy
 * -------------
 *
 *   - Build a fully-valid baseline environment that populates every strictly
 *     required variable (DATABASE_URL, REDIS_URL, S3_*, SESSION_SECRET) plus the
 *     two required Disney credentials and the two overridable Disney/ThemeParks
 *     URLs. The URL vars have defaults in the schema, so the success case relies
 *     on those defaults when the vars are absent and on generated valid URLs
 *     when present.
 *   - Success case: assert the untouched baseline loads without throwing.
 *   - Failure case: generate a nonempty subset of the two credential vars
 *     (`DISNEY_SYNC_GATEWAY_USERNAME`, `DISNEY_SYNC_GATEWAY_PASSWORD`) to break
 *     — each either deleted (absent) or set to an empty/whitespace-only string —
 *     together with an arbitrary (possibly empty) subset of the two URL vars
 *     (`THEMEPARKS_BASE_URL`, `DISNEY_SYNC_GATEWAY_BASE_URL`) set to malformed
 *     values. At least one variable is always broken. Assert `loadConfig`
 *     throws a `ConfigError` whose message names every offending variable.
 *
 * The credential and URL breakages are the only variables Property 16 ranges
 * over; the schema's other defaults and the fixed valid baseline keep every
 * unrelated field valid so a thrown `ConfigError` is attributable solely to the
 * variables the test intentionally broke.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { loadConfig, ConfigError } from '../config.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Baseline valid environment
// ---------------------------------------------------------------------------
//
// Every strictly required variable is present with a schema-valid value.
// Variables with schema defaults (URLs, budgets, backoff, freshness) are
// intentionally omitted from the baseline so the success path also exercises
// the default-application branch; the credentials have no default and so must
// be supplied.

function validBaseEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/appdb',
    REDIS_URL: 'redis://localhost:6379',
    S3_ENDPOINT: 'https://s3.example.com',
    S3_BUCKET: 'app-bucket',
    S3_ACCESS_KEY_ID: 'AKIAEXAMPLE',
    S3_SECRET_ACCESS_KEY: 'secretkeyexamplevalue',
    SESSION_SECRET: 'a'.repeat(32),
    DISNEY_SYNC_GATEWAY_USERNAME: 'disney-user',
    DISNEY_SYNC_GATEWAY_PASSWORD: 'disney-pass',
  };
}

// The two required credential variables Property 16 may set empty/absent.
const CREDENTIAL_VARS = [
  'DISNEY_SYNC_GATEWAY_USERNAME',
  'DISNEY_SYNC_GATEWAY_PASSWORD',
] as const;

// The two configured URL variables Property 16 may set to malformed values.
const URL_VARS = ['THEMEPARKS_BASE_URL', 'DISNEY_SYNC_GATEWAY_BASE_URL'] as const;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * How a broken credential is broken: either removed from the environment
 * entirely (absent) or present but empty/whitespace-only. Both violate the
 * `min(1)` non-empty rule and must be named in the ConfigError (R14.2).
 */
const emptyCredentialValueArb: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant<string | undefined>(undefined), // absent
  fc.constant(''), // empty string
);

/**
 * A malformed (non-absolute-URL) value for a URL var. `z.string().url()`
 * rejects each of these, so they must be named in the ConfigError (R14.5).
 */
const malformedUrlArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant(''),
  fc.constant('not a url'),
  fc.constant('example.com'), // missing scheme
  fc.constant('http://'), // scheme only
  fc.constant('://missing-scheme.com'),
  fc.constant('ht!tp://bad'),
);

/**
 * A well-formed absolute URL used when a URL var is present in the success/
 * partial-failure cases and NOT meant to be broken.
 */
const validUrlArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant('https://api.themeparks.wiki/v1'),
  fc.constant('https://example.com/path/'),
  fc.constant('http://localhost:8080/base'),
);

/**
 * A nonempty subset of a list, encoded as a per-element inclusion flag vector
 * constrained so at least one element is included.
 */
function nonemptySubset<T>(items: readonly T[]): fc.Arbitrary<T[]> {
  return fc
    .array(fc.boolean(), { minLength: items.length, maxLength: items.length })
    .map((flags) => items.filter((_, i) => flags[i]))
    .filter((selected) => selected.length > 0);
}

/**
 * Possibly-empty subset of a list (0..all elements).
 */
function anySubset<T>(items: readonly T[]): fc.Arbitrary<T[]> {
  return fc
    .array(fc.boolean(), { minLength: items.length, maxLength: items.length })
    .map((flags) => items.filter((_, i) => flags[i]));
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('config — Property 16: configuration fail-fast', () => {
  it('loads successfully when every required credential is present and URLs are valid', () => {
    fc.assert(
      fc.property(
        // Independently decide whether to include each URL var with a valid
        // value (absent → schema default), so the success path covers both
        // explicit-valid and default branches.
        anySubset(URL_VARS),
        fc.dictionary(fc.constantFrom(...URL_VARS), validUrlArb),
        (presentUrlVars, validUrlValues) => {
          const env = validBaseEnv();
          for (const key of presentUrlVars) {
            env[key] = validUrlValues[key] ?? 'https://valid.example.com/base';
          }
          // Must not throw.
          const config = loadConfig(env);
          expect(config.disney.credentials.username).toBe('disney-user');
          expect(config.disney.credentials.password).toBe('disney-pass');
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('throws ConfigError naming every offending credential/URL variable', () => {
    fc.assert(
      fc.property(
        // At least one credential is broken (empty/absent).
        nonemptySubset(CREDENTIAL_VARS),
        fc.dictionary(fc.constantFrom(...CREDENTIAL_VARS), emptyCredentialValueArb),
        // An arbitrary (possibly empty) subset of URL vars is malformed.
        anySubset(URL_VARS),
        fc.dictionary(fc.constantFrom(...URL_VARS), malformedUrlArb),
        (brokenCreds, credValues, malformedUrls, urlValues) => {
          const env = validBaseEnv();

          const offending: string[] = [];

          for (const key of brokenCreds) {
            const value = credValues[key];
            if (value === undefined) {
              delete env[key];
            } else {
              env[key] = value;
            }
            offending.push(key);
          }

          for (const key of malformedUrls) {
            // Deterministic malformed fallback keeps the value invalid even
            // when the dictionary happens not to supply this key.
            env[key] = urlValues[key] ?? 'not a url';
            offending.push(key);
          }

          let thrown: unknown;
          try {
            loadConfig(env);
          } catch (err) {
            thrown = err;
          }

          // Fail-fast: a ConfigError must be thrown (R14.2, R14.5).
          expect(thrown).toBeInstanceOf(ConfigError);
          const configError = thrown as ConfigError;

          // The message must name every offending variable so operators can
          // identify each missing/invalid value.
          for (const key of offending) {
            expect(configError.message).toContain(key);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
