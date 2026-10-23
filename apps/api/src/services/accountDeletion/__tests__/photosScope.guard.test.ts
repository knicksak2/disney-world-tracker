/**
 * Scope guard: account deletion lives in `accountDeletion/routes.ts`, never in the photos service or
 * `auth/routes.ts` (task 16, Requirements 17.7 and 18.3).
 *
 * `photos/__tests__/photos.guards.test.ts` stays UNCHANGED. Its premise (no account-deletion route in the
 * photos service or the auth routes) remains true because the new routes use the word `deletion`, which
 * neither of its regexes (`/delete-account/i`, `/account\/delete/i`) matches. This file pins the other half:
 * where the routes DO live, and that the four files the photos guard scans do not carry either phrase
 * anywhere (comments and strings included), so the guard stays green for the right reason.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVICES_DIR = resolve(__dirname, '..', '..');

const ACCOUNT_DELETION_ROUTES = resolve(SERVICES_DIR, 'accountDeletion', 'routes.ts');

/** The four files `photos.guards.test.ts` scans in its "(f) Non-goals" route-path guard. */
const PHOTOS_GUARD_SCANNED_FILES = [
  resolve(SERVICES_DIR, 'photos', 'routes.ts'),
  resolve(SERVICES_DIR, 'photos', 'foodReadRoutes.ts'),
  resolve(SERVICES_DIR, 'photos', 'sweepCronRoute.ts'),
  resolve(SERVICES_DIR, 'auth', 'routes.ts'),
] as const;

const ALLOWED_PREFIXES = [
  '/me/account/',
  '/internal/account-deletion/',
  '/account-deletion',
  '/privacy',
] as const;

/**
 * Every path passed as the first argument of `app.get|post|put|patch|delete|head|route(...)`, resolved
 * through `const NAME = '/literal'` declarations when the argument is an identifier.
 */
function declaredRoutePaths(source: string): string[] {
  const constants = new Map<string, string>();
  for (const m of source.matchAll(/\bconst\s+([A-Z_][A-Z0-9_]*)\s*=\s*'(\/[^']*)'/g)) {
    constants.set(m[1]!, m[2]!);
  }
  const paths: string[] = [];
  for (const m of source.matchAll(/\bapp\.(?:get|post|put|patch|delete|head|options)\(\s*(?:'(\/[^']*)'|([A-Z_][A-Z0-9_]*))/g)) {
    const literal = m[1];
    const ident = m[2];
    if (literal !== undefined) {
      paths.push(literal);
    } else if (ident !== undefined) {
      const resolved = constants.get(ident);
      if (resolved === undefined) throw new Error(`route path identifier ${ident} has no const string declaration`);
      paths.push(resolved);
    }
  }
  return paths;
}

describe('account deletion stays out of the photos service and auth routes (task 16)', () => {
  it('accountDeletion/routes.ts declares only /me/account/ and /internal/account-deletion/ paths, none under /photos', () => {
    const source = readFileSync(ACCOUNT_DELETION_ROUTES, 'utf8');
    const paths = declaredRoutePaths(source);

    // The five paths the design names (HEAD and POST share the purge path, GET and POST share /account-deletion),
    // so a parser regression that finds nothing cannot pass vacuously.
    expect([...new Set(paths)].sort()).toEqual(
      [
        '/account-deletion',
        '/internal/account-deletion/purge/run',
        '/me/account/deletion',
        '/me/account/deletion/reauth',
        '/privacy',
      ].sort(),
    );
    expect(paths.length).toBe(7); // reauth POST, deletion POST, web deletion GET + POST, privacy GET, purge POST, purge HEAD

    for (const path of paths) {
      expect(
        ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix)),
        `route ${path} is outside ${ALLOWED_PREFIXES.join(' and ')}`,
      ).toBe(true);
      expect(path.startsWith('/photos'), `route ${path} must not be under /photos`).toBe(false);
      expect(path.includes('/photos'), `route ${path} must not mention /photos`).toBe(false);
    }
  });

  it('the path parser bites: it flags a route outside the allowed prefixes', () => {
    const paths = declaredRoutePaths(
      "const X_PATH = '/photos/delete-me';\napp.post(X_PATH, h);\napp.get('/me/account/ok', h);",
    );
    expect(paths).toEqual(['/photos/delete-me', '/me/account/ok']);
    expect(paths.some((p) => !ALLOWED_PREFIXES.some((prefix) => p.startsWith(prefix)))).toBe(true);
  });

  it.each(PHOTOS_GUARD_SCANNED_FILES.map((file) => [file.slice(SERVICES_DIR.length + 1), file] as const))(
    '%s contains neither "delete-account" nor "account/delete" anywhere, comments included',
    (_name, file) => {
      const content = readFileSync(file, 'utf8');
      expect(content.length).toBeGreaterThan(0);
      expect(content).not.toMatch(/delete-account/i);
      expect(content).not.toMatch(/account\/delete/i);
    },
  );

  it('the real deletion paths do not match the photos guard regexes (the premise is the word "deletion")', () => {
    // "account/deletion" has "deleti", not "delete", so `/account\/delete/i` cannot match it.
    expect(/account\/delete/i.test('/me/account/deletion')).toBe(false);
    expect(/delete-account/i.test('/me/account/deletion')).toBe(false);
    expect(/account\/delete/i.test('/account-deletion')).toBe(false);
    expect(/delete-account/i.test('/account-deletion')).toBe(false);
    expect(/account\/delete/i.test('/privacy')).toBe(false);
    expect(/delete-account/i.test('/privacy')).toBe(false);
  });
});
