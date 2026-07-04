// Feature: resort-tracking-and-stats, Property 9: Friend parity
/**
 * Property-based + contract tests for Friend parity on the resort-aware
 * statistics dimensions.
 *
 * Validates: Requirements 6.1, 6.2
 *
 * Property 9 (design.md → Correctness Properties):
 *
 *   For any authorized requester, the `byAreaType` and `resort` values
 *   computed for a target equal those the target sees for themselves; an
 *   unauthorized requester receives `profile_forbidden` and no values.
 *
 * Why this holds structurally
 * ---------------------------
 * Both endpoints answer with `buildResponse(getStatsSnapshot(targetId))`:
 *
 *   GET /me/stats                        → buildResponse(snapshot(self))
 *   GET /me/stats/summary?for=<target>   → buildResponse(snapshot(target))
 *
 * The summary endpoint reads the *target's* snapshot (never the requester's),
 * gated by `assertOwnerOrFriend`. So for any authorized requester (the target
 * themselves, or an accepted Friend of the target), the `byAreaType` and
 * `resort` breakdowns they receive for a target are computed from the exact
 * same snapshot the target sees via `GET /me/stats` — they must be identical
 * (R6.1). The gate is evaluated exactly as for the existing dimensions, so a
 * non-Friend read throws `profile_forbidden`, reads no snapshot for the target,
 * and records no viewing attempt (R6.2).
 *
 * Test design
 * -----------
 * The plugin is registered against an in-process Fastify instance with:
 *   - a fake `StatsRepo` whose `getStatsSnapshot(target)` returns a single,
 *     shared arbitrary snapshot regardless of who is asking (so any drift
 *     between the self-read and the friend-read surfaces as a diff, not a
 *     different snapshot);
 *   - a fake DB pool that stubs the single `assertOwnerOrFriend` friendship
 *     lookup (authorize / deny by returning `exists: true` / `false`);
 *   - a stub session pre-handler that assigns `request.userId` from a header.
 *
 * The parity equality is exercised with fast-check over arbitrary snapshots
 * (self-read vs. friend-read must agree). The authorization deny case is an
 * example assertion (a non-Friend requester is refused with no snapshot read
 * and no viewing attempt recorded).
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  AREA_TYPES,
  EXPERIENCE_CATEGORIES,
  PARKS,
  type AreaType,
  type ExperienceCategory,
  type Park,
} from '@dwt/shared';

import { registerErrorHandler } from '../../../errors/handler.js';
import {
  statsRoutes,
  type StatsResponse,
  type StatsRoutesOptions,
} from '../routes.js';
import type { StatsCell, StatsRepo, StatsSnapshot } from '../repo.js';

const NUM_RUNS = 60;

// Canonical pair invariant: VIEWER_ID < TARGET_ID lexicographically, so the
// friendship lookup runs with (lo, hi) = (VIEWER_ID, TARGET_ID).
const VIEWER_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';

// ---------------------------------------------------------------------------
// Fake DB pool (only used by assertOwnerOrFriend's single friendship lookup)
// ---------------------------------------------------------------------------

interface FakePoolCall {
  text: string;
  params: ReadonlyArray<unknown>;
}

interface FakePool {
  query: (text: string, params?: ReadonlyArray<unknown>) => Promise<{ rows: unknown[] }>;
  calls: FakePoolCall[];
}

/**
 * Build a fake pool whose only recognized query is the friendship existence
 * check. `friendsAreFriends` controls whether the canonical pair is present.
 * Every call is recorded so tests can assert exactly one friendship lookup ran
 * and that no other (analytics/viewing-attempt) write occurred.
 */
function makeFakePool(friendsAreFriends: boolean): FakePool {
  const calls: FakePoolCall[] = [];
  return {
    calls,
    async query(text: string, params: ReadonlyArray<unknown> = []) {
      calls.push({ text, params });
      if (text.includes('FROM friendships')) {
        return { rows: [{ exists: friendsAreFriends }] };
      }
      return { rows: [] };
    },
  };
}

// ---------------------------------------------------------------------------
// Fake StatsRepo — always returns the target's shared snapshot
// ---------------------------------------------------------------------------

interface FakeRepo {
  repo: StatsRepo;
  callsForUser: string[];
  setSnapshot: (snapshot: StatsSnapshot) => void;
}

/**
 * A repo that returns a single, mutable snapshot for `TARGET_ID` and records
 * every user id it was asked about. Returning the same snapshot for the self
 * read and the friend read is the whole point: the two responses can only
 * differ if `buildResponse` is not deterministic over the snapshot.
 */
function makeFakeRepo(): FakeRepo {
  const callsForUser: string[] = [];
  let current: StatsSnapshot = { cells: [] };
  return {
    callsForUser,
    setSnapshot(snapshot: StatsSnapshot) {
      current = snapshot;
    },
    repo: {
      async getStatsSnapshot(userId: string): Promise<StatsSnapshot> {
        callsForUser.push(userId);
        if (userId === TARGET_ID) {
          return current;
        }
        throw new Error(`unexpected getStatsSnapshot for ${userId}`);
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Stub session pre-handler
// ---------------------------------------------------------------------------

const requireSession: StatsRoutesOptions['requireSession'] = (
  request,
  _reply,
  done,
) => {
  const id = request.headers['x-test-user-id'];
  if (typeof id === 'string' && id.length > 0) {
    request.userId = id;
  }
  done();
};

// ---------------------------------------------------------------------------
// Test app builder
// ---------------------------------------------------------------------------

async function buildApp(opts: {
  pool: FakePool;
  repo: StatsRepo;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    statsRoutes({
      pool: opts.pool as unknown as StatsRoutesOptions['pool'],
      repo: opts.repo,
      requireSession,
    }),
  );
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Snapshot generator
// ---------------------------------------------------------------------------

const parkOrNullArb: fc.Arbitrary<Park | null> = fc.option(
  fc.constantFrom<Park>(...PARKS),
  { nil: null },
);
const categoryArb: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
  ...EXPERIENCE_CATEGORIES,
);
const areaTypeArb: fc.Arbitrary<AreaType> = fc.constantFrom(...AREA_TYPES);

/**
 * A single snapshot cell. `completed <= total` mirrors the real snapshot
 * (numerator is a subset of the denominator). Resort-representing cells model
 * the real emission shape (`park = null`, `area_type = 'Resort'`) so the
 * generated snapshots resemble production input, though parity holds for any
 * shape because `buildResponse` is a pure fold.
 */
const cellArb: fc.Arbitrary<StatsCell> = fc
  .record({
    park: parkOrNullArb,
    category: categoryArb,
    areaType: areaTypeArb,
    isResortRepresentation: fc.boolean(),
    total: fc.integer({ min: 0, max: 50 }),
    completedFraction: fc.integer({ min: 0, max: 50 }),
  })
  .map((r): StatsCell => {
    if (r.isResortRepresentation) {
      // Resort-representing rows are Park-less and carry the 'Resort'
      // area_type + an inert 'Other' category placeholder (design.md).
      return {
        park: null,
        category: 'Resort',
        areaType: 'Resort',
        isResortRepresentation: true,
        total: r.total,
        completed: Math.min(r.completedFraction, r.total),
      };
    }
    return {
      park: r.park,
      category: r.category,
      areaType: r.areaType,
      isResortRepresentation: false,
      total: r.total,
      completed: Math.min(r.completedFraction, r.total),
    };
  });

const snapshotArb: fc.Arbitrary<StatsSnapshot> = fc
  .array(cellArb, { minLength: 0, maxLength: 25 })
  .map((cells) => ({ cells }));

// The authorized requester is either the target themselves (self-read) or an
// accepted Friend of the target. Both must see the target's own values.
const authorizedRequesterArb = fc.constantFrom<'self' | 'friend'>(
  'self',
  'friend',
);

// ---------------------------------------------------------------------------
// Property 9 — parity for authorized requesters
// ---------------------------------------------------------------------------

describe('stats — Property 9: Friend parity (byAreaType + resort)', () => {
  it('an authorized requester sees the target byAreaType/resort the target sees for themselves (R6.1)', async () => {
    const { repo, setSnapshot } = makeFakeRepo();
    // Authorized: the friendship lookup (only consulted for the Friend path)
    // returns exists=true.
    const pool = makeFakePool(true);
    const app = await buildApp({ pool, repo });

    try {
      await fc.assert(
        fc.asyncProperty(
          snapshotArb,
          authorizedRequesterArb,
          async (snapshot, requester) => {
            setSnapshot(snapshot);

            // The target's own view of their stats.
            const selfRes = await app.inject({
              method: 'GET',
              url: '/me/stats',
              headers: { 'x-test-user-id': TARGET_ID },
            });
            expect(selfRes.statusCode).toBe(200);
            const selfBody = selfRes.json() as StatsResponse;

            // An authorized requester reading the target's summary.
            const requesterId = requester === 'self' ? TARGET_ID : VIEWER_ID;
            const summaryRes = await app.inject({
              method: 'GET',
              url: `/me/stats/summary?for=${TARGET_ID}`,
              headers: { 'x-test-user-id': requesterId },
            });
            expect(summaryRes.statusCode).toBe(200);
            const summaryBody = summaryRes.json() as StatsResponse;

            // R6.1: the resort-aware dimensions are computed identically for
            // the authorized requester and the target themselves.
            expect(summaryBody.byAreaType).toEqual(selfBody.byAreaType);
            expect(summaryBody.resort).toEqual(selfBody.resort);

            // Every Area_Type key is present in both (closed-set coverage).
            expect(new Set(Object.keys(summaryBody.byAreaType))).toEqual(
              new Set(AREA_TYPES),
            );
          },
        ),
        { numRuns: NUM_RUNS },
      );
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// R6.2 — unauthorized read is denied with no values and no viewing attempt
// ---------------------------------------------------------------------------

describe('stats — Property 9: unauthorized requester is denied (R6.2)', () => {
  it('a non-Friend receives profile_forbidden, no stats values, and no viewing attempt recorded', async () => {
    const { repo, callsForUser } = makeFakeRepo();
    // Not friends: the single friendship lookup returns exists=false.
    const pool = makeFakePool(false);
    const app = await buildApp({ pool, repo });

    try {
      const res = await app.inject({
        method: 'GET',
        url: `/me/stats/summary?for=${TARGET_ID}`,
        headers: { 'x-test-user-id': VIEWER_ID },
      });

      // Denied with the shared owner-or-friend error code.
      expect(res.statusCode).toBe(403);
      const body = res.json() as { error: { code: string } };
      expect(body.error.code).toBe('profile_forbidden');

      // No stats values are returned on the deny path.
      expect(body).not.toHaveProperty('byAreaType');
      expect(body).not.toHaveProperty('resort');
      expect(body).not.toHaveProperty('overall');

      // The friendship lookup ran exactly once...
      const friendCalls = pool.calls.filter((c) =>
        c.text.includes('FROM friendships'),
      );
      expect(friendCalls).toHaveLength(1);
      // ...with the canonical (lo, hi) = (VIEWER, TARGET) pair.
      expect(friendCalls[0]!.params).toEqual([VIEWER_ID, TARGET_ID]);

      // R6.2: no viewing attempt recorded — the only DB traffic is the
      // friendship lookup; no analytics/audit write occurred.
      expect(pool.calls).toHaveLength(1);

      // The target's snapshot was never read on the deny path — no values
      // for the unauthorized requester.
      expect(callsForUser).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('the target can always read their own summary (self is authorized without a friendship lookup)', async () => {
    const { repo, callsForUser } = makeFakeRepo();
    const pool = makeFakePool(false); // no friendship exists, but self bypasses it
    const app = await buildApp({ pool, repo });

    try {
      const res = await app.inject({
        method: 'GET',
        url: `/me/stats/summary?for=${TARGET_ID}`,
        headers: { 'x-test-user-id': TARGET_ID },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as StatsResponse;
      expect(new Set(Object.keys(body.byAreaType))).toEqual(new Set(AREA_TYPES));
      expect(body.resort).toBeDefined();

      // Self-read consults no friendship row.
      expect(
        pool.calls.find((c) => c.text.includes('FROM friendships')),
      ).toBeUndefined();
      // The snapshot was read for the target (== self).
      expect(callsForUser).toEqual([TARGET_ID]);
    } finally {
      await app.close();
    }
  });
});
