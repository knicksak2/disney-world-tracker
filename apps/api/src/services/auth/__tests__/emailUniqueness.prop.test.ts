// Feature: disney-world-tracker, Property 13: emails are unique under case-insensitive equality
/**
 * Property-based test for Auth_Service email uniqueness.
 *
 * Validates: Requirements 6.2, 6.3
 *
 * Property 13 (design.md): for any sequence of registration attempts (each
 * with a candidate email), no two stored Users share the same email under
 * case-insensitive equality, and any registration whose email collides with
 * an existing User's email is rejected with the duplicate-email error.
 *
 * The check is integration-shaped — it exercises the real `authRoutes`
 * Fastify plugin (`apps/api/src/services/auth/routes.ts`) end-to-end against
 * an in-memory fake `pg.Pool` that simulates the citext UNIQUE constraint
 * on `users.email`. The fake matches the production behavior described in
 * design.md / migration `0001_init.sql`: the email column is `citext`, so
 * uniqueness is enforced under case-insensitive equality and a colliding
 * INSERT raises Postgres SQLSTATE `23505` (`unique_violation`), which the
 * route translates to `AppError('email_in_use')` (HTTP 409, R6.3).
 *
 * The fake-pool pattern mirrors the unit test in `routes.test.ts`. The one
 * additional concern here is the per-connection transaction state: register
 * runs the INSERT users / INSERT profiles / INSERT sessions trio inside a
 * `BEGIN ... COMMIT` block on a single client, and rolls back on failure.
 * The fake therefore tracks rows inserted within an open transaction so
 * `ROLLBACK` can undo them — that detail is unused on the duplicate-email
 * path (the users INSERT throws before any row is added) but it is the
 * correct contract for the pool surface and keeps the fake honest.
 *
 * Argon2id hashing is replaced with a fast stub via `vi.mock`. The
 * hashing-correctness and "no plaintext anywhere" properties are owned by
 * Property 16 / task 6.10; this property is purely about email uniqueness,
 * so paying ~100ms-per-hash × 100 runs × several registers per run buys us
 * nothing here.
 *
 * Per the task plan, `numRuns` is 100.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

// vi.mock is hoisted above all imports by Vitest. We replace the password
// module so the route's `hashPassword` call returns immediately. The shape
// matches the real module's exports (`hash`, `verify`).
vi.mock('../password.js', () => ({
  hash: async (plaintext: string) => `argon2-stub:${plaintext.length}`,
  verify: async () => false,
}));

import { registerErrorHandler } from '../../../errors/handler.js';
import type { LockoutService } from '../lockout.js';
import { authRoutes, type AuthRoutesOptions } from '../routes.js';

const NUM_RUNS = 100;

/** Postgres SQLSTATE for `unique_violation`. */
const PG_UNIQUE_VIOLATION = '23505';

// ---------------------------------------------------------------------------
// Fake pool — simulates the citext UNIQUE constraint on users.email
// ---------------------------------------------------------------------------

interface StoredUser {
  readonly id: string;
  readonly email: string;
}

interface FakeClient {
  query(text: string, params?: ReadonlyArray<unknown>): Promise<{ rows: unknown[] }>;
  release(): void;
}

interface FakePool {
  /** Currently-stored users, in insertion order. */
  readonly users: ReadonlyArray<StoredUser>;
  query(text: string, params?: ReadonlyArray<unknown>): Promise<{ rows: unknown[] }>;
  connect(): Promise<FakeClient>;
}

/**
 * Build a fake pool that:
 *
 *   - Treats `users.email` as `citext` — uniqueness check is case-insensitive
 *     (`u1.email.toLowerCase() === u2.email.toLowerCase()`).
 *   - On a duplicate INSERT, throws an `Error` whose `.code === '23505'` to
 *     mirror the `pg` driver's representation of a `unique_violation` so the
 *     route's `isUniqueViolation` helper recognises it.
 *   - Tracks per-connection transaction state so a `ROLLBACK` undoes any
 *     rows inserted within the open `BEGIN`. (Not exercised on the
 *     duplicate-email path, which throws before insertion, but required for
 *     correctness of the fake against the route's actual call sequence.)
 */
function makeFakePool(): FakePool {
  const users: StoredUser[] = [];
  let nextSeq = 1;

  function findCaseInsensitive(email: string): StoredUser | undefined {
    const lc = email.toLowerCase();
    return users.find((u) => u.email.toLowerCase() === lc);
  }

  function rejectAsUniqueViolation(): never {
    const err = new Error(
      'duplicate key value violates unique constraint "users_email_key"',
    ) as Error & { code: string };
    err.code = PG_UNIQUE_VIOLATION;
    throw err;
  }

  // Pool-level query (used by login, /me, logout). Same INSERT semantics
  // as the per-connection client, just without per-connection tx state —
  // the route never opens a transaction through `pool.query`.
  const poolLevelQuery = async (
    text: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<{ rows: unknown[] }> => {
    if (text.startsWith('INSERT INTO users')) {
      const email = String(params[0]);
      if (findCaseInsensitive(email)) {
        rejectAsUniqueViolation();
      }
      const row: StoredUser = { id: `user-${nextSeq++}`, email };
      users.push(row);
      return { rows: [{ id: row.id, email: row.email }] };
    }
    if (text.startsWith('INSERT INTO profiles')) return { rows: [] };
    if (text.startsWith('INSERT INTO sessions')) {
      return { rows: [{ id: `session-${nextSeq++}` }] };
    }
    return { rows: [] };
  };

  return {
    get users(): ReadonlyArray<StoredUser> {
      return users;
    },
    query: poolLevelQuery,
    async connect(): Promise<FakeClient> {
      // Per-connection transaction journal. On ROLLBACK, every row this
      // client inserted since the last BEGIN is removed from `users`.
      const journal: StoredUser[] = [];
      let inTransaction = false;

      const clientQuery = async (
        text: string,
        params: ReadonlyArray<unknown> = [],
      ): Promise<{ rows: unknown[] }> => {
        if (text === 'BEGIN') {
          inTransaction = true;
          journal.length = 0;
          return { rows: [] };
        }
        if (text === 'COMMIT') {
          inTransaction = false;
          journal.length = 0;
          return { rows: [] };
        }
        if (text === 'ROLLBACK') {
          for (const inserted of journal) {
            const idx = users.indexOf(inserted);
            if (idx >= 0) {
              users.splice(idx, 1);
            }
          }
          journal.length = 0;
          inTransaction = false;
          return { rows: [] };
        }
        if (text.startsWith('INSERT INTO users')) {
          const email = String(params[0]);
          if (findCaseInsensitive(email)) {
            rejectAsUniqueViolation();
          }
          const row: StoredUser = { id: `user-${nextSeq++}`, email };
          users.push(row);
          if (inTransaction) {
            journal.push(row);
          }
          return { rows: [{ id: row.id, email: row.email }] };
        }
        if (text.startsWith('INSERT INTO profiles')) return { rows: [] };
        if (text.startsWith('INSERT INTO sessions')) {
          return { rows: [{ id: `session-${nextSeq++}` }] };
        }
        return { rows: [] };
      };

      return {
        query: clientQuery,
        release: () => undefined,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Fake lockout / requireSession (unused by /auth/register, present to satisfy the plugin's options)
// ---------------------------------------------------------------------------

function makeNoopLockout(): LockoutService {
  return {
    async isLocked() {
      return false;
    },
    async recordFailure() {
      return false;
    },
    async clearOnSuccess() {
      // no-op
    },
  };
}

const requireSessionStub: AuthRoutesOptions['requireSession'] = async () => {
  // /auth/register does not use this pre-handler; return without touching
  // the request so any accidental use surfaces as a clearly-untouched req.
};

async function buildApp(pool: FakePool): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    authRoutes({
      pool: pool as unknown as AuthRoutesOptions['pool'],
      lockout: makeNoopLockout(),
      requireSession: requireSessionStub,
    }),
  );
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Pool of base addresses to draw from. Keeping it small (4 entries)
 * guarantees that a sequence of 2-8 registrations overlaps frequently
 * enough that the duplicate-rejection branch is exercised on most runs,
 * which is the point of this property.
 */
const BASE_EMAILS = [
  'alice@example.com',
  'bob@example.com',
  'carol@example.com',
  'dave@example.com',
] as const;

/** Per-character case-flip mask. */
const caseMaskArb = fc.array(fc.boolean(), { minLength: 0, maxLength: 32 });

/**
 * Apply a case mask to a string: index `i` upper-cased iff `mask[i] === true`,
 * otherwise lower-cased. Indices past the mask end default to lower-case.
 *
 * The result is always RFC-5322-syntactically valid because the only
 * characters in the base emails are ASCII letters, digits, `@`, and `.`,
 * none of which are altered by upper- or lower-casing.
 */
function applyCaseMask(s: string, mask: ReadonlyArray<boolean>): string {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i] as string;
    out += mask[i] === true ? ch.toUpperCase() : ch.toLowerCase();
  }
  return out;
}

/** Generate one email by picking a base and randomly re-casing it. */
const emailArb: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom(...BASE_EMAILS), caseMaskArb)
  .map(([base, mask]) => applyCaseMask(base, mask));

/**
 * Generate a sequence of registration attempts. The display name and
 * password are constants (any valid pair) because Property 13 is purely
 * about email uniqueness; the input-validation branches for displayName /
 * password are owned by Property 12 (task 6.6).
 */
const sequenceArb = fc.array(emailArb, { minLength: 1, maxLength: 8 });

// ---------------------------------------------------------------------------
// The property
// ---------------------------------------------------------------------------

describe('Auth_Service — Property 13: email uniqueness across all User accounts', () => {
  it('first register per case-insensitive email succeeds (201); duplicates (any case) reject with 409 email_in_use', async () => {
    await fc.assert(
      fc.asyncProperty(sequenceArb, async (emails) => {
        const pool = makeFakePool();
        const app = await buildApp(pool);
        try {
          const seenLower = new Set<string>();

          for (const email of emails) {
            const lcEmail = email.toLowerCase();
            const isFirstSighting = !seenLower.has(lcEmail);

            const response = await app.inject({
              method: 'POST',
              url: '/auth/register',
              payload: {
                email,
                displayName: 'TestUser',
                password: 'password12345',
              },
            });

            if (isFirstSighting) {
              // R6.2 (storage layer accepts a never-before-seen email under
              // case-insensitive equality) and the register success path of
              // R6.1: status 201 with the issued user/profile/token body.
              expect(response.statusCode).toBe(201);
              const body = response.json() as {
                user: { id: string; email: string };
                profile: { displayName: string };
                token: string;
              };
              expect(body.user.email).toBe(email);
              expect(body.token.length).toBeGreaterThan(0);
              seenLower.add(lcEmail);
            } else {
              // R6.3: any registration colliding (case-insensitively) with
              // an existing User's email is rejected with `email_in_use`
              // (HTTP 409). The route maps SQLSTATE 23505 → AppError →
              // envelope through the global error hook.
              expect(response.statusCode).toBe(409);
              const body = response.json() as {
                error: { code: string; field?: string };
              };
              expect(body.error.code).toBe('email_in_use');
              expect(body.error.field).toBe('email');
            }
          }

          // Final invariant: every stored email is unique under
          // case-insensitive equality. Equivalently, the count of stored
          // rows equals the cardinality of their lower-cased set, which is
          // the literal statement of R6.2.
          const stored = pool.users.map((u) => u.email.toLowerCase());
          const distinct = new Set(stored);
          expect(distinct.size).toBe(stored.length);
          // And the stored count equals the number of distinct lower-cased
          // emails the test ever attempted, i.e. exactly the first-sighting
          // count we tracked above.
          expect(stored.length).toBe(seenLower.size);
        } finally {
          await app.close();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
