// Feature: friend-stats-viewing, Property 3: For any target profile row, an authorized
// Profile read returns the display name, the avatar reference when an avatar is set and a
// null no-avatar indicator when none is set, and the overall completion percentage in
// [0.0, 100.0] to one decimal place.
/**
 * Property-based test for the Profile projection content.
 *
 * Validates: Requirements 2.1
 *
 * Design Property 3 (design.md -> Correctness Properties -> "Profile projection content"):
 *
 *   For any target profile row, an authorized Profile read returns the display name, the
 *   avatar reference when an avatar is set and a `null` no-avatar indicator when none is
 *   set, and the overall completion percentage in `[0.0, 100.0]` to one decimal place.
 *
 * The observable projection is exercised through the real `GET /users/:userId/profile`
 * route (`profileRoutes.ts`), which builds a `ProfileDTO` via `toProfileDTO(row, percent)`
 * using `getOverallCompletionPercent` -> `computePercent`. We drive the route end-to-end
 * against an in-process Fastify instance with a fake pool so the projection is asserted
 * without changing any production behavior.
 *
 * Authorization: the requester is the target (self-read), so `assertOwnerOrFriend` returns
 * immediately and the test focuses purely on the projection content (R2.1). The route then
 * issues exactly two queries:
 *
 *   1. the profile-row SELECT (`... FROM profiles WHERE user_id = $1`)
 *   2. the overall-completion-percent count query (over `completions` / `experiences`)
 *
 * The fake pool answers both from the generated inputs.
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';
import Fastify, { type FastifyInstance } from 'fastify';

import { AVATAR_PRESET_IDS } from '@dwt/shared';

import { registerErrorHandler } from '../../../errors/handler.js';
import { computePercent } from '../../stats/computePercent.js';
import { profileRoutes, type ProfileRoutesOptions } from '../profileRoutes.js';

const NUM_RUNS = 100;

// The fixed UUID used for both the authenticated requester and the target user id, so the
// owner-or-friend gate authorizes the read as a self-read.
const USER_ID = '11111111-1111-4111-8111-111111111111';

// ---------------------------------------------------------------------------
// Fake pool
// ---------------------------------------------------------------------------

interface ProfileFixture {
  readonly displayName: string;
  readonly avatarPreset: string | null;
  readonly completed: number;
  readonly total: number;
}

interface FakePool {
  query(text: string, params?: ReadonlyArray<unknown>): Promise<{ rows: unknown[] }>;
}

/**
 * Build a fake pool that answers the two queries the profile read issues from the supplied
 * fixture: the `profiles` row SELECT and the completion-percent count query.
 */
function makeFakePool(fixture: ProfileFixture): FakePool {
  return {
    async query(text: string) {
      if (text.includes('FROM profiles WHERE user_id')) {
        return {
          rows: [
            {
              user_id: USER_ID,
              display_name: fixture.displayName,
              avatar_preset: fixture.avatarPreset,
            },
          ],
        };
      }
      // The overall-completion-percent count query. pg returns COUNT() as a string for
      // `bigint`, so mirror that here.
      return {
        rows: [
          {
            completed: String(fixture.completed),
            total: String(fixture.total),
          },
        ],
      };
    },
  };
}

const requireAuth: ProfileRoutesOptions['requireAuth'] = async (request) => {
  request.userId = USER_ID;
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

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// A non-empty display name (the projection passes it through verbatim; the validator is
// exercised by the dedicated display-name property test, so here we only need a realistic,
// representable value).
const displayNameArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => /\S/u.test(s));

// Avatar reference: either a known preset id (avatar set) or null (no avatar).
const avatarPresetArb = fc.option(
  fc.constantFrom(...AVATAR_PRESET_IDS),
  { nil: null },
);

// Non-negative completion counts. `completed > total` is included so the clamp/zero-safe
// behavior of `computePercent` is exercised through the projection.
const countArb = fc.nat({ max: 100_000 });

const fixtureArb: fc.Arbitrary<ProfileFixture> = fc.record({
  displayName: displayNameArb,
  avatarPreset: avatarPresetArb,
  completed: countArb,
  total: countArb,
});

/** True iff `value` is representable as a one-decimal-place number. */
function isOneDecimal(value: number): boolean {
  return Math.round(value * 10) === value * 10;
}

// ---------------------------------------------------------------------------
// Property 3
// ---------------------------------------------------------------------------

describe('GET /users/:userId/profile — Property 3: profile projection content', () => {
  it('returns displayName, avatar ref when set / null when not, and a [0.0,100.0] one-decimal percent', async () => {
    await fc.assert(
      fc.asyncProperty(fixtureArb, async (fixture) => {
        const pool = makeFakePool(fixture);
        const app = await buildAppForRoute(pool);
        try {
          const res = await app.inject({
            method: 'GET',
            url: `/users/${USER_ID}/profile`,
          });

          if (res.statusCode !== 200) return false;

          const body = res.json() as {
            userId: string;
            displayName: string;
            avatarPreset: string | null;
            overallCompletionPercent: number;
          };

          // Display name is projected verbatim.
          if (body.displayName !== fixture.displayName) return false;

          // Avatar reference when set; null no-avatar indicator when not.
          if (body.avatarPreset !== fixture.avatarPreset) return false;

          // Overall completion percent matches the shared formula, is bounded to
          // [0.0, 100.0], and is expressed to one decimal place.
          const expected = computePercent(fixture.completed, fixture.total);
          if (body.overallCompletionPercent !== expected) return false;
          if (body.overallCompletionPercent < 0 || body.overallCompletionPercent > 100) {
            return false;
          }
          if (!isOneDecimal(body.overallCompletionPercent)) return false;

          // The userId is the projected owner id.
          return body.userId === USER_ID;
        } finally {
          await app.close();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
