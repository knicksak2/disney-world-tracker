/**
 * Property 27: sign-in providers cannot appear unnoticed.
 *
 * Sign-in is email and password only today, so account deletion has no provider token to revoke
 * (account-deletion R13.1). This tripwire fails the moment a provider dependency, an Apple
 * endpoint string, or a provider column shows up, because from then on revoking the provider
 * token at deletion is required (Apple requires it) and nothing here may silently skip it.
 * No revoke stub or no-op function is written anywhere (R13.2).
 *
 * Validates: Requirements 13.1, 13.2, 13.3, 17.7
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseMigrations } from '../services/accountDeletion/__tests__/migrationSchema.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_SRC = resolve(HERE, '..');
const REPO_ROOT = resolve(API_SRC, '..', '..', '..');
const MOBILE_SRC = join(REPO_ROOT, 'apps', 'mobile', 'src');
const MOBILE_PACKAGE_JSON = join(REPO_ROOT, 'apps', 'mobile', 'package.json');
const ACCOUNT_DELETION_DIR = join(API_SRC, 'services', 'accountDeletion');

const PROVIDER_PACKAGES = [
  'expo-apple-authentication',
  '@invertase/react-native-apple-authentication',
  'expo-auth-session',
  '@react-native-google-signin/google-signin',
  'expo-google-app-auth',
] as const;

const APPLE_ENDPOINT = 'appleid.apple.com';
const PROVIDER_COLUMN_FRAGMENTS = ['apple_sub', 'provider', 'oauth'] as const;

const WHAT_TO_DO =
  'A sign-in provider is now present. Revoking the provider token at account deletion is then required ' +
  '(Apple requires it): implement it, inject it through a port like the other ports, and update this ' +
  'tripwire in the same change. Do not add a revoke stub or a no-op function (account-deletion R13.2, R13.4).';

// ---------------------------------------------------------------------------
// Detectors (pure, unit-tested below so the tripwire is known to be able to trip)
// ---------------------------------------------------------------------------

function findProviderPackages(pkg: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}): string[] {
  const names = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ]);
  return PROVIDER_PACKAGES.filter((p) => names.has(p));
}

function findProviderColumns(columnNames: Iterable<string>): string[] {
  return [...columnNames].filter((c) => PROVIDER_COLUMN_FRAGMENTS.some((f) => c.toLowerCase().includes(f)));
}

/** An identifier that pairs a provider word with a revoke word, in either order. */
function findProviderRevocationNames(source: string): string[] {
  const re = /\b\w*(?:(?:apple|provider|oauth)\w*revo\w*|revo\w*(?:apple|provider|oauth)\w*)\b/gi;
  return [...source.matchAll(re)].map((m) => m[0]);
}

const isTestPath = (path: string): boolean =>
  /(^|[\\/])(__tests__|__mocks__|test)([\\/]|$)/.test(path) || /\.(test|spec)\.[cm]?[tj]sx?$/.test(path);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    const rel = relative(REPO_ROOT, full);
    if (statSync(full).isDirectory()) {
      if (!isTestPath(rel + '/')) out.push(...sourceFiles(full));
    } else if (/\.[cm]?[tj]sx?$/.test(name) && !isTestPath(rel)) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The tripwire
// ---------------------------------------------------------------------------

describe('Property 27: sign-in providers cannot appear unnoticed', () => {
  // Feature: account-deletion, Property 27: Sign-in providers cannot appear unnoticed
  it('apps/mobile/package.json has none of the provider sign-in packages', () => {
    const pkg = JSON.parse(readFileSync(MOBILE_PACKAGE_JSON, 'utf8')) as Parameters<typeof findProviderPackages>[0];
    const found = findProviderPackages(pkg);
    expect(found, `${found.join(', ')} found in apps/mobile/package.json. ${WHAT_TO_DO}`).toEqual([]);
  });

  // Feature: account-deletion, Property 27: Sign-in providers cannot appear unnoticed
  it('no non-test source in apps/api/src or apps/mobile/src mentions the Apple identity endpoint', () => {
    const files = [...sourceFiles(API_SRC), ...sourceFiles(MOBILE_SRC)];
    expect(files.length, 'the source walk found no files: the tripwire would pass vacuously').toBeGreaterThan(100);
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes(APPLE_ENDPOINT));
    expect(
      offenders.map((f) => relative(REPO_ROOT, f)),
      `"${APPLE_ENDPOINT}" found. ${WHAT_TO_DO}`,
    ).toEqual([]);
  });

  // Feature: account-deletion, Property 27: Sign-in providers cannot appear unnoticed
  it('the users table has no apple_sub, provider or oauth column in any migration', () => {
    const schema = parseMigrations();
    const users = schema.tables.get('users');
    expect(users, 'users table not found in migrations').toBeDefined();
    expect(users!.columns.has('email')).toBe(true); // the parser really read the users table
    const found = findProviderColumns(users!.columns.keys());
    expect(found, `users.${found.join(', users.')} found. ${WHAT_TO_DO}`).toEqual([]);
  });

  // Feature: account-deletion, Property 27: Sign-in providers cannot appear unnoticed
  it('the accountDeletion service has no function named for provider revocation', () => {
    const files = sourceFiles(ACCOUNT_DELETION_DIR);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap((f) =>
      findProviderRevocationNames(readFileSync(f, 'utf8')).map((n) => `${relative(REPO_ROOT, f)}: ${n}`),
    );
    expect(offenders, WHAT_TO_DO).toEqual([]);
  });

  describe('the detectors can actually trip', () => {
    it('flags each provider package in any dependency section', () => {
      for (const name of PROVIDER_PACKAGES) {
        expect(findProviderPackages({ dependencies: { [name]: '1.0.0' } })).toEqual([name]);
        expect(findProviderPackages({ devDependencies: { [name]: '1.0.0' } })).toEqual([name]);
      }
      expect(findProviderPackages({ dependencies: { react: '19.0.0', 'expo-notifications': '1.0.0' } })).toEqual([]);
    });

    it('flags provider-looking user columns and ignores ordinary ones', () => {
      expect(findProviderColumns(['id', 'email', 'apple_sub'])).toEqual(['apple_sub']);
      expect(findProviderColumns(['auth_provider', 'oauth_token', 'Provider_Id'])).toEqual([
        'auth_provider',
        'oauth_token',
        'Provider_Id',
      ]);
      expect(findProviderColumns(['id', 'email', 'password_hash', 'deletion_state', 'placeholder_id'])).toEqual([]);
    });

    it('flags provider-revocation function names but not session revocation', () => {
      expect(findProviderRevocationNames('async function revokeAppleToken() {}')).toEqual(['revokeAppleToken']);
      expect(findProviderRevocationNames('const providerRevoke = () => {}')).toEqual(['providerRevoke']);
      expect(findProviderRevocationNames('oauthTokenRevocation()')).toEqual(['oauthTokenRevocation']);
      expect(findProviderRevocationNames('UPDATE sessions SET revoked_at = now(); revokeSessions(userId)')).toEqual([]);
    });

    it('treats test and mock paths as non-source', () => {
      expect(isTestPath('apps/api/src/__tests__/x.ts')).toBe(true);
      expect(isTestPath('apps/mobile/src/test/themeGuard.ts')).toBe(true);
      expect(isTestPath('apps/api/src/services/auth/routes.test.ts')).toBe(true);
      expect(isTestPath('apps/api/src/services/auth/routes.ts')).toBe(false);
    });
  });
});
