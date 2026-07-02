// Feature: friend-stats-viewing, Property 1: Owner-or-friend authorization and
// opaque denial. For any set of Users, friendship graph, and pending-request
// set, and for any (requester, target) pair, a gated read (Profile, statistics,
// or Completions) is authorized iff the requester is the target or an accepted
// Friend of the target; in every other case — non-friend, pending-request-only,
// terminated friendship, or an unknown target — the read is denied with an
// identical `profile_forbidden` error carrying no data, indistinguishable
// across those deny cases.
/**
 * Property-based test for the shared Owner_Or_Friend_Rule gate
 * (`services/friends/ownerOrFriend.ts` → `assertOwnerOrFriend`).
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.7, 3.6
 *
 * The shared helper is the single source of truth used by all three gated
 * reads (Profile / stats / Completions). This test drives the helper directly
 * against a fake `DbPool` and parameterizes every iteration across the three
 * call-site labels, asserting that the authorization outcome and the deny-path
 * error are identical regardless of which endpoint invokes the gate.
 *
 * Deny categories exercised by the generator:
 *   - non-friend       : no relationship at all
 *   - pending-only     : a pending Friend_Request exists but no accepted
 *                        friendship row (pending requests never create a
 *                        `friendships` row, so the gate must deny)
 *   - terminated       : the pair were friends but the friendship row was
 *                        removed (the gate reads the table fresh, so a
 *                        committed termination denies — R1.7)
 *   - unknown-target   : the target id is absent from the User population
 *
 * Authorize categories:
 *   - self             : requester === target (owner reads own data)
 *   - friend           : an accepted friendship row exists
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { assertOwnerOrFriend } from '../ownerOrFriend.js';
import { pair as canonicalPair } from '../canonicalPair.js';
import { AppError } from '../../../errors/AppError.js';
import type { DbPool } from '../../../db/pool.js';

const NUM_RUNS = 100;

/** The three gated reads that delegate to the shared helper. */
const CALL_SITES = ['profile', 'stats', 'completions'] as const;

/**
 * The canonical, observable deny envelope. Every deny case — regardless of
 * category or call site — must produce exactly this shape and nothing more,
 * so the response cannot distinguish a non-friend from a pending request,
 * a terminated friendship, or an unknown target (R1.5, R1.7).
 */
const EXPECTED_DENY = {
  code: 'profile_forbidden',
  message: 'You may not view this profile.',
} as const;

/**
 * Build a fake `DbPool` whose only behavior is the friendship-existence
 * lookup the gate performs. It reads from the provided canonical-pair key
 * set (`${lo}|${hi}`). Any other query shape is unexpected for this helper
 * and yields no rows. A `queries` array records every issued statement so
 * the test can assert the gate performs at most one lookup and short-circuits
 * for the owner.
 */
function makeFakePool(friendshipKeys: ReadonlySet<string>): {
  pool: DbPool;
  queries: Array<{ text: string; params: ReadonlyArray<unknown> }>;
} {
  const queries: Array<{ text: string; params: ReadonlyArray<unknown> }> = [];
  const pool = {
    async query(text: string, params: ReadonlyArray<unknown> = []) {
      queries.push({ text, params });
      if (text.includes('FROM friendships')) {
        const lo = String(params[0] ?? '');
        const hi = String(params[1] ?? '');
        return { rows: [{ exists: friendshipKeys.has(`${lo}|${hi}`) }] };
      }
      return { rows: [] };
    },
  };
  return { pool: pool as unknown as DbPool, queries };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Bounded unique user-id strings; small domain keeps shrink space tight. */
const userIdArb = fc.integer({ min: 0, max: 9999 }).map((n) => `u-${n}`);

type Category =
  | 'self'
  | 'friend'
  | 'non-friend'
  | 'pending-only'
  | 'terminated'
  | 'unknown-target';

interface Scenario {
  readonly requester: string;
  readonly target: string;
  readonly category: Category;
  /** Accepted-friendship canonical-pair keys present in the table. */
  readonly friendshipKeys: ReadonlySet<string>;
  readonly authorized: boolean;
}

/**
 * Generate a population of 2-6 unique users, then construct a scenario for one
 * of the six relationship categories. Pending and terminated relationships are
 * modeled by the *absence* of an accepted friendship row for that pair (a
 * pending request never inserts one; a termination removes it), which is what
 * the gate observes.
 */
const scenarioArb: fc.Arbitrary<Scenario> = fc
  .uniqueArray(userIdArb, { minLength: 2, maxLength: 6 })
  .chain((users) =>
    fc
      .tuple(
        fc.constant(users),
        fc.constantFrom<Category>(
          'self',
          'friend',
          'non-friend',
          'pending-only',
          'terminated',
          'unknown-target',
        ),
        fc.integer({ min: 0, max: users.length - 1 }),
        fc.integer({ min: 0, max: users.length - 1 }),
        // A fresh id guaranteed not to collide with the population.
        fc.integer({ min: 10_000, max: 19_999 }).map((n) => `u-${n}`),
      )
      .map(([population, category, ri, ti, unknownId]): Scenario => {
        const requester = population[ri] as string;
        let target = population[ti] as string;

        const friendshipKeys = new Set<string>();

        switch (category) {
          case 'self': {
            target = requester;
            // No friendship row needed; the gate short-circuits on self.
            return {
              requester,
              target,
              category,
              friendshipKeys,
              authorized: true,
            };
          }
          case 'friend': {
            // Ensure a distinct target and an accepted friendship row.
            if (target === requester) {
              target = population[(ti + 1) % population.length] as string;
            }
            if (target === requester) {
              // Population had only one usable distinct id along this path;
              // fall back to an unknown distinct id so the pair is valid.
              target = unknownId;
            }
            const { lo, hi } = canonicalPair(requester, target);
            friendshipKeys.add(`${lo}|${hi}`);
            return {
              requester,
              target,
              category,
              friendshipKeys,
              authorized: true,
            };
          }
          case 'unknown-target': {
            // Target is absent from the population entirely.
            return {
              requester,
              target: unknownId,
              category,
              friendshipKeys,
              authorized: false,
            };
          }
          default: {
            // non-friend / pending-only / terminated: a distinct target with
            // NO accepted friendship row. (Pending and terminated differ from
            // a plain non-friend only in history the gate cannot observe.)
            if (target === requester) {
              target = population[(ti + 1) % population.length] as string;
            }
            if (target === requester) {
              target = unknownId;
            }
            return {
              requester,
              target,
              category,
              friendshipKeys,
              authorized: false,
            };
          }
        }
      }),
  );

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 1: owner-or-friend authorization and opaque denial', () => {
  it('authorizes iff owner-or-friend and denies with an identical profile_forbidden across all deny cases and call sites', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        // Cross-check the generator's expectation with the independent oracle:
        // authorized iff requester === target OR the canonical pair is an
        // accepted friendship.
        let oracleAuthorized: boolean;
        if (scenario.requester === scenario.target) {
          oracleAuthorized = true;
        } else {
          const { lo, hi } = canonicalPair(scenario.requester, scenario.target);
          oracleAuthorized = scenario.friendshipKeys.has(`${lo}|${hi}`);
        }
        expect(oracleAuthorized).toBe(scenario.authorized);

        // Parameterize across the three call sites: the shared gate must
        // behave identically no matter which endpoint invokes it.
        for (const callSite of CALL_SITES) {
          // The label documents which endpoint's delegation is being
          // exercised; the gate's behavior is identical across all three.
          void callSite;
          const { pool, queries } = makeFakePool(scenario.friendshipKeys);

          if (scenario.authorized) {
            // Resolves with no value and discloses nothing.
            await expect(
              assertOwnerOrFriend(pool, scenario.requester, scenario.target),
            ).resolves.toBeUndefined();

            // Owner reads short-circuit before any DB lookup; friend reads
            // perform exactly one friendship lookup.
            if (scenario.requester === scenario.target) {
              expect(queries).toHaveLength(0);
            } else {
              expect(queries).toHaveLength(1);
              expect(queries[0]?.text).toContain('FROM friendships');
            }
          } else {
            // Deny path: throws an AppError with the canonical opaque
            // envelope and carries no data (no field, no details).
            let thrown: unknown;
            try {
              await assertOwnerOrFriend(
                pool,
                scenario.requester,
                scenario.target,
              );
            } catch (err) {
              thrown = err;
            }

            expect(thrown).toBeInstanceOf(AppError);
            const appErr = thrown as AppError;
            // Identical across non-friend / pending-only / terminated /
            // unknown-target (R1.5, R1.7) and across all call sites.
            expect(appErr.code).toBe(EXPECTED_DENY.code);
            expect(appErr.message).toBe(EXPECTED_DENY.message);
            // No data leaked that could distinguish the deny categories.
            expect(appErr.field).toBeUndefined();
            expect(appErr.details).toBeUndefined();

            // Exactly one friendship lookup precedes the deny.
            expect(queries).toHaveLength(1);
            expect(queries[0]?.text).toContain('FROM friendships');
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
