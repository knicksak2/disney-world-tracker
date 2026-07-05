// Feature: resort-tracking-and-stats, Property 9: Friend parity
/**
 * Property-based + contract tests for Friend parity on the coverage
 * dimensions of the expanded Stats_Service response.
 *
 * Validates: Requirements 6.1, 6.2 (resort-tracking-and-stats), 9.1, 9.2
 * (expanded-stats).
 *
 * Property 9 (design.md → Correctness Properties):
 *
 *   For any authorized requester, the `coverage.byAreaType` and
 *   `coverage.resort` values computed for a target equal those the target sees
 *   for themselves; an unauthorized requester receives `profile_forbidden` and
 *   no values.
 *
 * Why this holds structurally
 * ---------------------------
 * Both endpoints answer with `assembleResponse(getStatsSnapshot(targetId))`:
 *
 *   GET /me/stats                        → assembleResponse(snapshot(self))
 *   GET /me/stats/summary?for=<target>   → assembleResponse(snapshot(target))
 *
 * The summary endpoint reads the *target's* snapshot (never the requester's),
 * gated by `authorizeTarget`/`assertOwnerOrFriend`. So for any authorized
 * requester (the target themselves, or an accepted Friend of the target), the
 * coverage breakdowns they receive for a target are computed from the exact
 * same snapshot the target sees via `GET /me/stats` — they must be identical
 * (R9.1). A non-Friend read of an existing target throws `profile_forbidden`,
 * reads no snapshot for the target, and records no viewing attempt (R9.2).
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
import type {
  RawCoverageCell,
  RawUserRatingRow,
  StatsRepo,
  StatsSnapshot,
  StatsSnapshotInput,
} from '../repo.js';
import { MINIMUM_RATINGS_THRESHOLD } from '../ratingStats.js';

const NUM_RUNS = 60;

// Canonical pair invariant: VIEWER_ID < TARGET_ID lexicographically, so the
// friendship lookup runs with (lo, hi) = (VIEWER_ID, TARGET_ID).
const VIEWER_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';

// ---------------------------------------------------------------------------
// Fake DB pool (used by authorizeTarget's friendship + existence lookups)
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
 * Build a fake pool. `friendsAreFriends` controls whether the canonical pair
 * is present; `targetExists` controls the existence check used only on the
 * deny path to choose between `profile_forbidden` and `stats_target_not_found`.
 * Every call is recorded so tests can assert exactly which lookups ran and that
 * no analytics/viewing-attempt WRITE occurred.
 */
function makeFakePool(
  friendsAreFriends: boolean,
  targetExists = true,
): FakePool {
  const calls: FakePoolCall[] = [];
  return {
    calls,
    async query(text: string, params: ReadonlyArray<unknown> = []) {
      calls.push({ text, params });
      if (text.includes('FROM friendships')) {
        return { rows: [{ exists: friendsAreFriends }] };
      }
      if (text.includes('FROM users')) {
        return { rows: [{ exists: targetExists }] };
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
  setCoverage: (cells: readonly RawCoverageCell[]) => void;
  setRatings: (rows: readonly RawUserRatingRow[]) => void;
}

/**
 * A repo that returns a single, mutable snapshot for `TARGET_ID` and records
 * every user id it was asked about. Returning the same snapshot for the self
 * read and the friend read is the whole point: the two responses can only
 * differ if `assembleResponse` is not deterministic over the snapshot.
 */
function makeFakeRepo(): FakeRepo {
  const callsForUser: string[] = [];
  let coverage: readonly RawCoverageCell[] = [];
  let userRatings: readonly RawUserRatingRow[] = [];
  return {
    callsForUser,
    setCoverage(cells: readonly RawCoverageCell[]) {
      coverage = cells;
    },
    setRatings(rows: readonly RawUserRatingRow[]) {
      userRatings = rows;
    },
    repo: {
      async getStatsSnapshot(input: StatsSnapshotInput): Promise<StatsSnapshot> {
        const userId = input.targetUserId;
        callsForUser.push(userId);
        if (userId === TARGET_ID) {
          return {
            coverage,
            facetExperiences: [],
            userRatings,
            resortCoverage: [],
            percentile: null,
          };
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

const cellArb: fc.Arbitrary<RawCoverageCell> = fc
  .record({
    park: parkOrNullArb,
    category: categoryArb,
    areaType: areaTypeArb,
    isResortRepresentation: fc.boolean(),
    total: fc.integer({ min: 0, max: 50 }),
    completedFraction: fc.integer({ min: 0, max: 50 }),
  })
  .map((r): RawCoverageCell => {
    if (r.isResortRepresentation) {
      return {
        park: null,
        category: 'Resort',
        areaType: 'Resort',
        land: null,
        resortArea: null,
        isResortRepresentation: true,
        total: r.total,
        completed: Math.min(r.completedFraction, r.total),
      };
    }
    return {
      park: r.park,
      category: r.category,
      areaType: r.areaType,
      land: null,
      resortArea: null,
      isResortRepresentation: false,
      total: r.total,
      completed: Math.min(r.completedFraction, r.total),
    };
  });

const coverageArb: fc.Arbitrary<readonly RawCoverageCell[]> = fc.array(cellArb, {
  minLength: 0,
  maxLength: 25,
});

// The authorized requester is either the target themselves (self-read) or an
// accepted Friend of the target. Both must see the target's own values.
const authorizedRequesterArb = fc.constantFrom<'self' | 'friend'>(
  'self',
  'friend',
);

// ---------------------------------------------------------------------------
// Property 9 — parity for authorized requesters
// ---------------------------------------------------------------------------

describe('stats — Property 9: Friend parity (coverage.byAreaType + coverage.resort)', () => {
  it('an authorized requester sees the target coverage the target sees for themselves (R9.1)', async () => {
    const { repo, setCoverage } = makeFakeRepo();
    const pool = makeFakePool(true);
    const app = await buildApp({ pool, repo });

    try {
      await fc.assert(
        fc.asyncProperty(
          coverageArb,
          authorizedRequesterArb,
          async (cells, requester) => {
            setCoverage(cells);

            const selfRes = await app.inject({
              method: 'GET',
              url: '/me/stats',
              headers: { 'x-test-user-id': TARGET_ID },
            });
            expect(selfRes.statusCode).toBe(200);
            const selfBody = selfRes.json() as StatsResponse;

            const requesterId = requester === 'self' ? TARGET_ID : VIEWER_ID;
            const summaryRes = await app.inject({
              method: 'GET',
              url: `/me/stats/summary?for=${TARGET_ID}`,
              headers: { 'x-test-user-id': requesterId },
            });
            expect(summaryRes.statusCode).toBe(200);
            const summaryBody = summaryRes.json() as StatsResponse;

            // R9.1: the coverage dimensions are computed identically for the
            // authorized requester and the target themselves.
            expect(summaryBody.coverage.byAreaType).toEqual(
              selfBody.coverage.byAreaType,
            );
            expect(summaryBody.coverage.resort).toEqual(
              selfBody.coverage.resort,
            );

            expect(new Set(Object.keys(summaryBody.coverage.byAreaType))).toEqual(
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
// R9.2 — unauthorized read is denied with no values and no viewing attempt
// ---------------------------------------------------------------------------

describe('stats — Property 9: unauthorized requester is denied (R9.2)', () => {
  it('a non-Friend of an existing target receives profile_forbidden, no stats values, and no viewing attempt recorded', async () => {
    const { repo, callsForUser } = makeFakeRepo();
    // Not friends, but the target exists → profile_forbidden (not not-found).
    const pool = makeFakePool(false, true);
    const app = await buildApp({ pool, repo });

    try {
      const res = await app.inject({
        method: 'GET',
        url: `/me/stats/summary?for=${TARGET_ID}`,
        headers: { 'x-test-user-id': VIEWER_ID },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json() as { error: { code: string } };
      expect(body.error.code).toBe('profile_forbidden');

      // No stats values are returned on the deny path.
      expect(body).not.toHaveProperty('coverage');
      expect(body).not.toHaveProperty('ratings');

      // The friendship lookup ran exactly once with the canonical pair...
      const friendCalls = pool.calls.filter((c) =>
        c.text.includes('FROM friendships'),
      );
      expect(friendCalls).toHaveLength(1);
      expect(friendCalls[0]!.params).toEqual([VIEWER_ID, TARGET_ID]);

      // ...and exactly one existence check ran to distinguish 403 from 404.
      const existenceCalls = pool.calls.filter((c) =>
        c.text.includes('FROM users'),
      );
      expect(existenceCalls).toHaveLength(1);

      // R9.2/R9.3: no viewing attempt recorded — the only DB traffic is the
      // friendship lookup and the existence read; both are SELECTs, no
      // analytics/audit write occurred.
      expect(pool.calls).toHaveLength(2);

      // The target's snapshot was never read on the deny path.
      expect(callsForUser).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('the target can always read their own summary (self is authorized without any lookup)', async () => {
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
      expect(new Set(Object.keys(body.coverage.byAreaType))).toEqual(
        new Set(AREA_TYPES),
      );
      expect(body.coverage.resort).toBeDefined();

      // Self-read consults no friendship or existence row.
      expect(pool.calls).toHaveLength(0);
      expect(callsForUser).toEqual([TARGET_ID]);
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Feature: expanded-stats, Property 13: Friend and self responses are
// structurally identical with independent gating
//
// For any Target_User, the response returned for a friend has the identical
// set of Rating_Statistic types and the same response structure as the self
// response, and the friend's rating statistics are gated by the friend's own
// active-rating count against the threshold (hidden when below, and hidden
// identically when the friend has zero active ratings).
//
// Validates: Requirements 9.1, 9.4, 9.5.
//
// Why this holds structurally
// ---------------------------
// Both endpoints answer with `assembleResponse(getStatsSnapshot(targetId))`,
// and the rating roll-up is a pure fold over the *target's* own active
// ratings. The friend read and the self read therefore share the exact same
// snapshot, so their responses must be deeply identical — including the gating
// decision, which `assembleResponse`/`rollUpRatings` derives purely from the
// target's active-rating count against `MINIMUM_RATINGS_THRESHOLD`. The route
// never knows or cares whether the requester is the owner or a friend (R9.1),
// so the friend's stats are gated by the friend's (== target's) own count
// (R9.4), including the zero-ratings case (R9.5).
// ---------------------------------------------------------------------------

const ratingRowArb: fc.Arbitrary<RawUserRatingRow> = fc.record({
  experienceId: fc.uuid(),
  experienceName: fc.string({ minLength: 1, maxLength: 12 }),
  value: fc.integer({ min: 1, max: 10 }),
  park: parkOrNullArb,
  category: categoryArb,
});

// Span both sides of the threshold, plus the zero case (R9.5): 0..threshold+3.
const ratingsArb: fc.Arbitrary<readonly RawUserRatingRow[]> = fc.array(
  ratingRowArb,
  { minLength: 0, maxLength: MINIMUM_RATINGS_THRESHOLD + 3 },
);

/** The gated Rating_Statistic fields hidden below the threshold (R9.4, R9.5). */
const GATED_RATING_FIELDS = [
  'average',
  'averageByPark',
  'averageByCategory',
  'distribution',
  'highest',
  'lowest',
] as const;

describe('stats — Property 13: friend/self structural parity with independent rating gating', () => {
  it('a friend receives a response deeply identical to the self response, with rating stats gated by the target own active-rating count (R9.1, R9.4, R9.5)', async () => {
    const { repo, setCoverage, setRatings } = makeFakeRepo();
    const pool = makeFakePool(true);
    const app = await buildApp({ pool, repo });

    try {
      await fc.assert(
        fc.asyncProperty(coverageArb, ratingsArb, async (cells, ratings) => {
          setCoverage(cells);
          setRatings(ratings);

          const selfRes = await app.inject({
            method: 'GET',
            url: '/me/stats',
            headers: { 'x-test-user-id': TARGET_ID },
          });
          expect(selfRes.statusCode).toBe(200);
          const selfBody = selfRes.json() as StatsResponse;

          const friendRes = await app.inject({
            method: 'GET',
            url: `/me/stats/summary?for=${TARGET_ID}`,
            headers: { 'x-test-user-id': VIEWER_ID },
          });
          expect(friendRes.statusCode).toBe(200);
          const friendBody = friendRes.json() as StatsResponse;

          // R9.1: identical response structure — the friend response and the
          // self response are deeply equal (same top-level keys, same
          // Rating_Statistic types, same values), since both fold the same
          // target snapshot.
          expect(friendBody).toEqual(selfBody);
          expect(new Set(Object.keys(friendBody))).toEqual(
            new Set(Object.keys(selfBody)),
          );
          expect(new Set(Object.keys(friendBody.ratings))).toEqual(
            new Set(Object.keys(selfBody.ratings)),
          );

          // Independent gating (R9.4, R9.5): the friend's rating statistics are
          // gated by the friend's (== target's) own active-rating count against
          // the threshold, identically for self and friend.
          const sufficient = ratings.length >= MINIMUM_RATINGS_THRESHOLD;
          expect(friendBody.ratings.sufficient).toBe(sufficient);
          expect(selfBody.ratings.sufficient).toBe(sufficient);

          // The rated-completions count is always reported, gate or not.
          expect(friendBody.ratings.ratedCompletionsCount).toBe(
            ratings.length,
          );
          expect(selfBody.ratings.ratedCompletionsCount).toBe(ratings.length);

          if (sufficient) {
            // At or above threshold: every gated field is present for both.
            for (const field of GATED_RATING_FIELDS) {
              expect(friendBody.ratings).toHaveProperty(field);
              expect(selfBody.ratings).toHaveProperty(field);
            }
          } else {
            // Below threshold (including zero ratings, R9.5): every gated field
            // is hidden — identically for self and friend.
            for (const field of GATED_RATING_FIELDS) {
              expect(friendBody.ratings).not.toHaveProperty(field);
              expect(selfBody.ratings).not.toHaveProperty(field);
            }
          }
        }),
        { numRuns: 100 },
      );
    } finally {
      await app.close();
    }
  });
});
