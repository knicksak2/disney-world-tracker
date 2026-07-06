// Feature: disney-world-tracker, Property 19: profile visible iff viewer is owner or accepted friend; no analytics on deny
/**
 * Property-based test for the Profile read endpoint authorization gate
 * and render contract.
 *
 * Validates: Requirements 7.4, 7.8
 *
 * Property 19 (design.md → Correctness Properties → "Profile authorization
 * and render"):
 *
 *   For any `(viewer, target)` User pair, viewing the target's Profile
 *   succeeds if and only if `viewer == target` or an accepted Friend
 *   relationship exists between them; on success the response contains
 *   display name, avatar (if set), and overall completion percentage; on
 *   denial the response is an authorization error and no analytics or
 *   audit entry is produced for the viewing attempt.
 *
 * Test harness mirrors `profileRoutes.test.ts` exactly:
 *   - A small in-process Fastify instance with the `profileRoutes` plugin
 *     registered against a fake `pool` collaborator and a
 *     header-driven auth pre-handler.
 *   - The `request.log` is wrapped in a `Proxy` at `onRequest` so every
 *     `info` and `debug` invocation that the deny path could conceivably
 *     emit is captured per-request. R7.8 is asserted by checking that no
 *     debug-level call was made and that no info-level call carries a
 *     viewing-attempt `event` tag — the error hook's single info line for
 *     the rejected `AppError` is operational logging of the error
 *     response and is permitted (it carries only the error code, not a
 *     viewing-attempt audit, exactly as the existing
 *     `profileRoutes.test.ts` deny test asserts).
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import Fastify from 'fastify';

import { AVATAR_PRESET_IDS } from '@dwt/shared';

import { registerErrorHandler } from '../../../errors/handler.js';
import { profileRoutes, type ProfileRoutesOptions } from '../profileRoutes.js';
import { pair as canonicalPair } from '../../friends/canonicalPair.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Per-iteration scenario state
// ---------------------------------------------------------------------------
//
// The fake pool reads from this closure-captured variable on every query
// so a single Fastify app can serve every property iteration without
// recreation overhead. `app.inject` is sequential inside fc.asyncProperty,
// so this single-slot state is race-free.

interface Scenario {
  /** Canonical-pair keys `${lo}|${hi}` known to the friendships table. */
  readonly friendships: ReadonlySet<string>;
  /** The User who owns the target Profile in this iteration. */
  readonly owner: string;
  /** The Profile row returned by `loadProfileRow` for `owner`. */
  readonly ownerProfile: {
    readonly user_id: string;
    readonly display_name: string;
    readonly avatar_preset: string | null;
  };
  /** Counts returned for the overall-completion query. */
  readonly ownerCompletions: { readonly completed: string; readonly total: string };
}

let currentScenario: Scenario | null = null;
let currentInfoLogs: Array<ReadonlyArray<unknown>> = [];
let currentDebugLogs: Array<ReadonlyArray<unknown>> = [];

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/**
 * Header-driven auth pre-handler — same shape as `profileRoutes.test.ts`
 * so the property test can flip the requester per iteration without
 * setting up real sessions.
 */
const requireAuth: ProfileRoutesOptions['requireAuth'] = async (request) => {
  const id = request.headers['x-test-user-id'];
  if (typeof id === 'string' && id.length > 0) {
    request.userId = id;
  }
};

/**
 * Build a single Fastify app wired with fake collaborators that read from
 * `currentScenario`. Reused across all iterations of the property to keep
 * the per-run cost to a single `app.inject`.
 */
async function buildApp() {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);

  // Wrap `request.log` in a Proxy so every `info` and `debug` call made
  // anywhere downstream of `onRequest` lands in the capture arrays for the
  // current iteration. We do not replace `error`/`warn`/`fatal` — those
  // are not the analytics surface R7.8 forbids and need to remain
  // observable for unrelated errors.
  app.addHook('onRequest', async (request) => {
    const original = request.log;
    request.log = new Proxy(original, {
      get(target, prop, receiver) {
        if (prop === 'info') {
          return (...args: unknown[]) => {
            currentInfoLogs.push(args);
          };
        }
        if (prop === 'debug') {
          return (...args: unknown[]) => {
            currentDebugLogs.push(args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as typeof request.log;
  });

  const fakePool = {
    async query(text: string, params: ReadonlyArray<unknown> = []) {
      const s = currentScenario;
      if (!s) return { rows: [] };

      if (text.includes('FROM friendships')) {
        const lo = String(params[0] ?? '');
        const hi = String(params[1] ?? '');
        const exists = s.friendships.has(`${lo}|${hi}`);
        return { rows: [{ exists }] };
      }
      if (
        text.startsWith(
          'SELECT user_id, display_name, avatar_preset FROM profiles',
        )
      ) {
        if (params[0] === s.owner) {
          return { rows: [s.ownerProfile] };
        }
        return { rows: [] };
      }
      if (text.includes('completions')) {
        return { rows: [s.ownerCompletions] };
      }
      return { rows: [] };
    },
  };

  await app.register(profileRoutes, {
    pool: fakePool as unknown as ProfileRoutesOptions['pool'],
    requireAuth,
  });
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Bounded, unique user-id strings. Using a small numeric domain makes
 * `viewer == owner` and friend-pair hits both reachable along realistic
 * interleavings without inflating shrink space.
 */
const userIdArb = fc.integer({ min: 0, max: 9999 }).map((n) => `u-${n}`);

/**
 * Generate a population of 2-6 unique users plus a friendship subset
 * drawn from the population's canonical pairs, then pick a viewer/owner
 * uniformly at random from the population.
 */
const scenarioInputArb = fc
  .uniqueArray(userIdArb, { minLength: 2, maxLength: 6 })
  .chain((users) => {
    // Build every canonical (lo, hi) with lo < hi over the population.
    const allPairs: Array<readonly [string, string]> = [];
    for (let i = 0; i < users.length; i++) {
      for (let j = i + 1; j < users.length; j++) {
        const a = users[i] as string;
        const b = users[j] as string;
        allPairs.push(a < b ? [a, b] : [b, a]);
      }
    }
    return fc
      .tuple(
        fc.constant(users),
        fc.subarray(allPairs),
        fc.integer({ min: 0, max: users.length - 1 }),
        fc.integer({ min: 0, max: users.length - 1 }),
      )
      .map(([population, friendPairs, vi, oi]) => ({
        viewer: population[vi] as string,
        owner: population[oi] as string,
        friendPairs,
      }));
  });

/** Profile fields under read; the route echoes display_name and avatar_preset. */
const displayNameArb = fc.string({ minLength: 1, maxLength: 50 });
const avatarPresetArb = fc.option(fc.constantFrom(...AVATAR_PRESET_IDS), {
  nil: null,
});

/** Completion counts; the route reduces these via `computePercent`. */
const completionCountsArb = fc.tuple(
  fc.nat({ max: 1000 }),
  fc.nat({ max: 1000 }),
);

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 19: profile visible iff viewer is owner or accepted friend; no analytics on deny', () => {
  it('GET /users/:userId/profile honors the owner-or-friend gate and emits no analytics on deny', async () => {
    const app = await buildApp();

    try {
      await fc.assert(
        fc.asyncProperty(
          scenarioInputArb,
          displayNameArb,
          avatarPresetArb,
          completionCountsArb,
          async (
            { viewer, owner, friendPairs },
            displayName,
            avatarPreset,
            [completed, total],
          ) => {
            // Reset capture and scenario for this iteration.
            const friendshipSet = new Set(
              friendPairs.map(([lo, hi]) => `${lo}|${hi}`),
            );
            currentScenario = {
              friendships: friendshipSet,
              owner,
              ownerProfile: {
                user_id: owner,
                display_name: displayName,
                avatar_preset: avatarPreset,
              },
              ownerCompletions: {
                completed: String(completed),
                total: String(total),
              },
            };
            currentInfoLogs = [];
            currentDebugLogs = [];

            const res = await app.inject({
              method: 'GET',
              url: `/users/${owner}/profile`,
              headers: { 'x-test-user-id': viewer },
            });

            // Reference oracle: viewer is authorized iff viewer == owner
            // OR the canonical pair is in the friendships set.
            let isAuthorized: boolean;
            if (viewer === owner) {
              isAuthorized = true;
            } else {
              const { lo, hi } = canonicalPair(viewer, owner);
              isAuthorized = friendshipSet.has(`${lo}|${hi}`);
            }

            if (isAuthorized) {
              // R7.4: success returns display name, avatar (if set), and
              // overall completion percentage as computed by Stats_Service.
              expect(res.statusCode).toBe(200);
              const body = res.json() as {
                userId: string;
                displayName: string;
                avatarPreset: string | null;
                overallCompletionPercent: number;
              };
              expect(body.userId).toBe(owner);
              expect(body.displayName).toBe(displayName);
              expect(body.avatarPreset).toBe(avatarPreset);
              expect(typeof body.overallCompletionPercent).toBe('number');
              // computePercent constraint: result is within [0.0, 100.0].
              expect(body.overallCompletionPercent).toBeGreaterThanOrEqual(0);
              expect(body.overallCompletionPercent).toBeLessThanOrEqual(100);
            } else {
              // R7.8: deny returns the authorization error.
              expect(res.statusCode).toBe(403);
              const body = res.json() as { error: { code: string } };
              expect(body.error.code).toBe('profile_forbidden');

              // R7.8: no analytics/audit record is written on deny. The
              // error hook emits exactly one info line for any rejected
              // domain error — that is operational logging of the error
              // response itself (it carries only the error code, not a
              // viewing-attempt audit) and is permitted. We assert:
              //   - no debug-level analytics trace was emitted, and
              //   - no info-level call carries a viewing-attempt `event`
              //     tag (e.g. `profile_view`) that would constitute an
              //     analytics record of the attempt.
              expect(currentDebugLogs).toHaveLength(0);
              for (const args of currentInfoLogs) {
                const payload = args[0];
                if (
                  payload &&
                  typeof payload === 'object' &&
                  'event' in (payload as Record<string, unknown>)
                ) {
                  const ev = (payload as { event: unknown }).event;
                  const isViewAnalytics =
                    typeof ev === 'string' && /profile_view/i.test(ev);
                  expect(isViewAnalytics).toBe(false);
                }
              }
            }
          },
        ),
        { numRuns: NUM_RUNS },
      );
    } finally {
      await app.close();
      currentScenario = null;
    }
  });
});
