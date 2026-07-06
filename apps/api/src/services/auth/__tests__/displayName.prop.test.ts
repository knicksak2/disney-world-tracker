// Feature: disney-world-tracker, Property 17: display-name update accepted iff trimmed length in 1..50 with non-whitespace
/**
 * Property-based tests for the display-name validator.
 *
 * Validates: Requirements 7.2, 7.5, 7.6
 *
 * The Auth_Service validates display-name updates with two pieces of code
 * shared with the mobile client and the DTO surface:
 *
 *   - `displayNameSchema`              from `@dwt/shared` primitives
 *   - `profileDisplayNameInputSchema`  from `@dwt/shared` Profile schemas
 *
 * The design's Property 17 states:
 *
 *   For any submitted display-name update, the update is accepted if and
 *   only if the trimmed length is in `1..50` and contains at least one
 *   non-whitespace character; on rejection the Profile's prior display
 *   name is unchanged.
 *
 * This file exercises the biconditional from three angles:
 *
 *   1. `displayNameSchema` accepts a string iff it satisfies the oracle.
 *   2. `profileDisplayNameInputSchema` agrees with the primitive on the
 *      `displayName` field of the strict object schema.
 *   3. The `PATCH /me/profile` route accepts iff the schema accepts and,
 *      crucially, **never issues an UPDATE statement on rejection** so the
 *      prior display name is preserved on the User's Profile (R7.6).
 *
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import Fastify, { type FastifyInstance } from 'fastify';

import {
  displayNameSchema,
  profileDisplayNameInputSchema,
} from '@dwt/shared';

import { registerErrorHandler } from '../../../errors/handler.js';
import {
  profileRoutes,
  type ProfileRoutesOptions,
} from '../profileRoutes.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------

/**
 * The acceptance oracle for a candidate display name. A name is acceptable
 * if and only if its `String.prototype.trim`-trimmed form is between 1 and
 * 50 code units long *and* contains at least one non-whitespace character
 * as recognized by the regex `\S` (R7.2, R7.5, R7.6).
 *
 * The `\S` regex is applied to the post-trim value because Zod's
 * `.trim()` transform runs before `.regex()`. This matches the design's
 * documented defense-in-depth against zero-width / unicode whitespace
 * characters that `String.prototype.trim` does not strip.
 */
function isAcceptable(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > 50) return false;
  return /\S/u.test(trimmed);
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Generic display-name candidate. We mix three sources so that fast-check
 * does not waste shrinking budget on uniformly random unicode strings that
 * almost never satisfy the predicate:
 *
 *   - `fc.string` (default ASCII printable ranges) — exercises the common
 *     accept path.
 *   - Strings padded with whitespace on either side — exercises the trim
 *     branch and the "whitespace-only" reject path.
 *   - Long strings up to 100 chars — exercises the 50-character upper
 *     bound on both sides.
 */
const displayNameCandidate = fc.oneof(
  // Common ASCII range — many of these will be acceptable.
  fc.string({ minLength: 0, maxLength: 100 }),
  // Whitespace padding around a non-empty body.
  fc
    .tuple(
      fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { minLength: 0, maxLength: 5 }),
      fc.string({ minLength: 0, maxLength: 60 }),
      fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { minLength: 0, maxLength: 5 }),
    )
    .map(([lhs, body, rhs]) => `${lhs}${body}${rhs}`),
  // Pure-whitespace strings — must always be rejected.
  fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), {
    minLength: 0,
    maxLength: 60,
  }),
  // Boundary lengths (49, 50, 51 chars after trim) drawn from a printable
  // alphabet so the inner regex does not accidentally fail.
  fc
    .integer({ min: 0, max: 60 })
    .map((n) => 'a'.repeat(n)),
);

// ---------------------------------------------------------------------------
// Property 17.a — schema agreement with the oracle
// ---------------------------------------------------------------------------

describe('displayNameSchema — Property 17.a: accepts iff oracle accepts', () => {
  it('agrees with the trimmed-length-and-non-whitespace oracle', () => {
    fc.assert(
      fc.property(displayNameCandidate, (raw) => {
        const expected = isAcceptable(raw);
        const actual = displayNameSchema.safeParse(raw).success;
        return expected === actual;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns the trimmed value verbatim on success', () => {
    fc.assert(
      fc.property(displayNameCandidate, (raw) => {
        const result = displayNameSchema.safeParse(raw);
        if (!result.success) {
          fc.pre(false);
          return true;
        }
        return result.data === raw.trim();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects with code "display_name_invalid" on every rejected input', () => {
    fc.assert(
      fc.property(displayNameCandidate, (raw) => {
        const result = displayNameSchema.safeParse(raw);
        if (result.success) {
          fc.pre(false);
          return true;
        }
        // Every issue raised by the schema uses the shared error code so
        // the route hook can surface it directly to the client.
        return result.error.issues.every(
          (issue) => issue.message === 'display_name_invalid',
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 17.b — profileDisplayNameInputSchema agrees with the primitive
// ---------------------------------------------------------------------------

describe('profileDisplayNameInputSchema — Property 17.b: input wrapper agrees', () => {
  it('accepts { displayName } iff displayNameSchema accepts displayName', () => {
    fc.assert(
      fc.property(displayNameCandidate, (raw) => {
        const primitive = displayNameSchema.safeParse(raw).success;
        const wrapped = profileDisplayNameInputSchema.safeParse({
          displayName: raw,
        }).success;
        return primitive === wrapped;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects strict-mode-violating shapes regardless of displayName value', () => {
    // Any extra property must fail because the input schema is `.strict()`.
    fc.assert(
      fc.property(displayNameCandidate, fc.string(), (raw, extraKey) => {
        // Avoid colliding with the legitimate field; if the generator
        // happens to produce `displayName`, skip — fast-check will retry.
        fc.pre(extraKey !== 'displayName');
        const result = profileDisplayNameInputSchema.safeParse({
          displayName: raw,
          [extraKey]: 1,
        });
        return result.success === false;
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 17.c — route preserves prior on rejection
// ---------------------------------------------------------------------------
//
// We register the real `profileRoutes` plugin against an in-process
// Fastify instance with a fake pool that records every `query` call. The
// stub auth pre-handler injects a `userId` so the request reaches the
// validation step. The property holds when, for every candidate name:
//
//   - schema accepts → route returns 200 AND exactly one UPDATE was issued
//   - schema rejects → route returns 400 with `display_name_invalid` AND
//                      no UPDATE was issued (the prior name is preserved)
//
// The fake pool also rigs a successful UPDATE response so the accept path
// can complete its `toProfileDTO` projection without throwing.

interface FakeCall {
  readonly text: string;
  readonly params: ReadonlyArray<unknown>;
}

interface FakePool {
  readonly calls: FakeCall[];
  query(text: string, params?: ReadonlyArray<unknown>): Promise<{ rows: unknown[] }>;
}

function makeFakePool(): FakePool {
  const calls: FakeCall[] = [];
  return {
    calls,
    async query(text: string, params: ReadonlyArray<unknown> = []) {
      calls.push({ text, params });
      if (text.startsWith('UPDATE profiles')) {
        return {
          rows: [
            {
              user_id: 'u-1',
              display_name: params[0] as string,
              avatar_preset: null,
            },
          ],
        };
      }
      // The completion-percent query — return zero counts so
      // `computePercent` produces `0.0`.
      return { rows: [{ completed: '0', total: '0' }] };
    },
  };
}

const requireAuth: ProfileRoutesOptions['requireAuth'] = async (request) => {
  request.userId = 'u-1';
};

async function buildAppForRoute(pool: FakePool): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(profileRoutes, {
    pool: pool as unknown as ProfileRoutesOptions['pool'],
    requireAuth,
  });
  await app.ready();
  return app;
}

describe('PATCH /me/profile — Property 17.c: prior preserved on rejection', () => {
  it('accepts iff the schema accepts, and emits no UPDATE on rejection', async () => {
    await fc.assert(
      fc.asyncProperty(displayNameCandidate, async (raw) => {
        const pool = makeFakePool();
        const app = await buildAppForRoute(pool);
        try {
          const res = await app.inject({
            method: 'PATCH',
            url: '/me/profile',
            headers: { 'content-type': 'application/json' },
            payload: { displayName: raw },
          });

          const expectedAcceptable = isAcceptable(raw);
          const updates = pool.calls.filter((c) =>
            c.text.startsWith('UPDATE profiles'),
          );

          if (expectedAcceptable) {
            // Accept path: 200 OK and exactly one UPDATE was issued with
            // the trimmed value.
            if (res.statusCode !== 200) return false;
            if (updates.length !== 1) return false;
            return updates[0]!.params[0] === raw.trim();
          }

          // Reject path: 400 `display_name_invalid` and no UPDATE issued
          // (R7.6: the prior display name is preserved on rejection).
          if (res.statusCode !== 400) return false;
          const body = res.json() as { error?: { code?: string; field?: string } };
          if (body.error?.code !== 'display_name_invalid') return false;
          return updates.length === 0;
        } finally {
          await app.close();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Fixed regression examples
// ---------------------------------------------------------------------------
//
// These hand-picked inputs pin down the boundaries of the predicate so an
// accidental change to the `displayNameSchema` constants would surface as
// a test failure even before fast-check generates a counterexample.

describe('displayNameSchema — fixed regression examples', () => {
  it.each([
    ['1 char', 'a', true],
    ['50 chars', 'a'.repeat(50), true],
    ['51 chars', 'a'.repeat(51), false],
    ['empty', '', false],
    ['whitespace only', '   \t\n', false],
    ['leading and trailing whitespace trims to 5', '   alice   ', true],
    ['trim leaves 50 chars', `   ${'a'.repeat(50)}   `, true],
    ['trim leaves 51 chars', `   ${'a'.repeat(51)}   `, false],
  ])('%s', (_label, input, expected) => {
    expect(displayNameSchema.safeParse(input).success).toBe(expected);
  });
});
