// Feature: disney-facilities-catalog-source, Property 22: Config validation halts startup and names every offending value
/**
 * Property-based test for Disney source configuration validation.
 *
 * Validates: Requirements 13.3, 13.6, 13.5
 *
 * Property 22 (design.md → Correctness Properties → "Config validation halts
 * startup and names every offending value"):
 *
 *   For any combination of missing/empty Static_Credentials and/or a
 *   malformed Sync Gateway URL, `loadConfig()` throws before the API accepts a
 *   request, and the error names each missing credential value and identifies
 *   any malformed URL value; a valid configuration loads, supplying the
 *   default base URL when none is configured.
 *
 * Requirement mapping
 * -------------------
 *   - R13.3: an absent or empty Basic-auth username/password halts startup and
 *     the error message names each offending credential value.
 *   - R13.6: a configured Sync Gateway URL that is not a well-formed absolute
 *     URL halts startup and the error identifies the invalid value.
 *   - R13.5: when no Sync Gateway base URL is configured, the loader supplies
 *     the documented default base URL.
 *
 * Test strategy
 * -------------
 *   - Hold every non-Disney required variable fixed to a valid baseline so the
 *     only possible offenders are the three Disney fields under test.
 *   - Generate an independent "field spec" for the username and password, each
 *     of which is `present` (a non-empty string), `empty` (`''`), or `absent`
 *     (key omitted from the environment) — `empty` and `absent` are the two
 *     ways R13.3 says a credential can offend.
 *   - Generate a "URL spec" for the base URL that is `absent` (default should
 *     apply, R13.5), `valid` (a well-formed absolute URL), or `malformed` (a
 *     string that the same `z.string().url()` validator rejects, R13.6). The
 *     malformed generator filters candidates through the real validator so a
 *     generated value can never be a false offender.
 *   - `loadConfig(env)` accepts an injected environment dictionary, so no
 *     `process.env` monkey-patching is needed and the property stays pure.
 *
 * Property assertions
 * -------------------
 *   - If any field offends, `loadConfig` throws `ConfigError`, and the error
 *     message names the offending variable(s): the username variable iff the
 *     username offends, the password variable iff the password offends, and
 *     the base-URL variable iff the URL is malformed.
 *   - If no field offends, `loadConfig` returns a config whose credentials echo
 *     the supplied values and whose base URL equals the supplied URL, or the
 *     documented default when the URL was absent.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';

import { ConfigError, loadConfig } from '../config.js';

const NUM_RUNS = 100;

const USERNAME_VAR = 'DISNEY_SYNC_GATEWAY_USERNAME';
const PASSWORD_VAR = 'DISNEY_SYNC_GATEWAY_PASSWORD';
const BASE_URL_VAR = 'DISNEY_SYNC_GATEWAY_BASE_URL';
const DEFAULT_SYNC_GATEWAY_BASE_URL =
  'https://realtime-sync-gw.wdprapps.disney.com/park-platform-pub/';

// Mirror the production URL validator so "malformed" candidates are exactly
// the strings the loader would reject, and "valid" candidates are exactly the
// strings it would accept.
const urlSchema = z.string().url();
const isValidUrl = (s: string): boolean => urlSchema.safeParse(s).success;

// ---------------------------------------------------------------------------
// Baseline valid environment
// ---------------------------------------------------------------------------
//
// Every required non-Disney variable is supplied with a valid value so that a
// validation failure can only originate from the Disney fields under test.

function baseEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    S3_ENDPOINT: 'https://s3.example.com',
    S3_BUCKET: 'bucket',
    S3_ACCESS_KEY_ID: 'access-key-id',
    S3_SECRET_ACCESS_KEY: 'secret-access-key',
    SESSION_SECRET: 'x'.repeat(32),
  };
}

// ---------------------------------------------------------------------------
// Field specs
// ---------------------------------------------------------------------------

type CredentialSpec =
  | { kind: 'present'; value: string }
  | { kind: 'empty' }
  | { kind: 'absent' };

type UrlSpec =
  | { kind: 'absent' }
  | { kind: 'valid'; value: string }
  | { kind: 'malformed'; value: string };

// A credential is valid only when present as a non-empty string; the two
// offending shapes (R13.3) are an explicit empty string and an omitted key.
const credentialArb: fc.Arbitrary<CredentialSpec> = fc.oneof(
  fc.string({ minLength: 1 }).map((value) => ({ kind: 'present', value }) as const),
  fc.constant({ kind: 'empty' } as const),
  fc.constant({ kind: 'absent' } as const),
);

const validUrlArb: fc.Arbitrary<UrlSpec> = fc
  .webUrl()
  .filter(isValidUrl)
  .map((value) => ({ kind: 'valid', value }) as const);

// Candidate malformed strings: a curated set of clearly non-absolute-URL
// values plus arbitrary strings, all filtered through the real validator so a
// candidate that happens to parse as a URL is never treated as an offender.
const malformedUrlArb: fc.Arbitrary<UrlSpec> = fc
  .oneof(
    fc.constantFrom(
      '',
      '   ',
      'not-a-url',
      'httptypo',
      'http//missing-colon.example.com',
      '/relative/only',
      'foo bar baz',
      '::::',
    ),
    fc.string(),
  )
  .filter((s) => !isValidUrl(s))
  .map((value) => ({ kind: 'malformed', value }) as const);

const urlSpecArb: fc.Arbitrary<UrlSpec> = fc.oneof(
  fc.constant({ kind: 'absent' } as const),
  validUrlArb,
  malformedUrlArb,
);

// ---------------------------------------------------------------------------
// Environment assembly
// ---------------------------------------------------------------------------

function applyCredential(
  env: NodeJS.ProcessEnv,
  key: string,
  spec: CredentialSpec,
): void {
  if (spec.kind === 'present') {
    env[key] = spec.value;
  } else if (spec.kind === 'empty') {
    env[key] = '';
  }
  // 'absent' → leave the key unset.
}

function buildEnv(
  user: CredentialSpec,
  pass: CredentialSpec,
  url: UrlSpec,
): NodeJS.ProcessEnv {
  const env = baseEnv();
  applyCredential(env, USERNAME_VAR, user);
  applyCredential(env, PASSWORD_VAR, pass);
  if (url.kind !== 'absent') {
    env[BASE_URL_VAR] = url.value;
  }
  return env;
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Disney config — Property 22: validation halts startup and names offenders', () => {
  it('throws ConfigError naming every offending value, else loads with defaults', () => {
    fc.assert(
      fc.property(credentialArb, credentialArb, urlSpecArb, (user, pass, url) => {
        const env = buildEnv(user, pass, url);

        const userOffends = user.kind !== 'present';
        const passOffends = pass.kind !== 'present';
        const urlOffends = url.kind === 'malformed';
        const anyOffends = userOffends || passOffends || urlOffends;

        if (anyOffends) {
          let thrown: unknown;
          try {
            loadConfig(env);
          } catch (e) {
            thrown = e;
          }

          // R13.3 / R13.6: startup halts with a ConfigError.
          expect(thrown).toBeInstanceOf(ConfigError);
          const message = (thrown as ConfigError).message;

          // The error names each offending value, and only those.
          expect(message.includes(USERNAME_VAR)).toBe(userOffends);
          expect(message.includes(PASSWORD_VAR)).toBe(passOffends);
          expect(message.includes(BASE_URL_VAR)).toBe(urlOffends);
          return;
        }

        // No offenders: a valid configuration loads.
        const cfg = loadConfig(env);

        const expectedUsername = user.kind === 'present' ? user.value : '';
        const expectedPassword = pass.kind === 'present' ? pass.value : '';
        expect(cfg.disney.credentials.username).toBe(expectedUsername);
        expect(cfg.disney.credentials.password).toBe(expectedPassword);

        // R13.5: an absent base URL yields the documented default.
        const expectedBaseUrl =
          url.kind === 'valid' ? url.value : DEFAULT_SYNC_GATEWAY_BASE_URL;
        expect(cfg.disney.syncGateway.baseUrl).toBe(expectedBaseUrl);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
