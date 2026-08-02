// Feature: trips, Property 12: The authenticated-session check precedes the membership check
/**
 * Property-based test for the Trip routes' session-before-membership ordering
 * (task 5.7).
 *
 * Validates: Requirements 15.3
 *
 * Design Property 12 (design.md → Correctness Properties): for any Trip request
 * lacking a valid unexpired session, the Trip_Service denies it with
 * `unauthorized` *before* evaluating the Trip_Member_Rule, disclosing nothing
 * about the Trip's existence or the requester's membership.
 *
 * The routes enforce this by construction: every Trip-scoped endpoint runs the
 * shared `requireSession` pre-handler (which assigns `request.userId`) *before*
 * the handler body reaches `assertTripMember` / `assertTripOrganizer`. A
 * pre-handler that rejects the request short-circuits Fastify's lifecycle, so
 * the membership lookup never runs.
 *
 * Test strategy: register the real {@link tripRoutes} plugin against an
 * in-process Fastify instance wired with
 *
 *   - a **fake `requireSession`** whose behaviour is toggled per run — it either
 *     throws `unauthorized` (no session) or assigns a `userId` (valid session),
 *   - a **spy pool** that records every `query` it receives (the membership
 *     lookup performed by `assertTripMember` is the only query these routes
 *     make on the deny path), and returns no membership row so an authenticated
 *     caller is treated as a non-member, and
 *   - a **spy repo** whose every method throws if ever invoked, proving the
 *     request never reaches persistence on either deny path.
 *
 * For every membership-gated route/method and any Trip id, the property asserts
 * two mirror-image facts that together pin the ordering:
 *
 *   1. **No session → `unauthorized` (401) with the membership lookup never
 *      run.** The spy pool records zero queries, so the session check provably
 *      precedes — and blocks — the membership check (R15.3). The response body
 *      is the bare `unauthorized` envelope, disclosing nothing about the Trip.
 *
 *   2. **Valid session, non-member → `trip_forbidden` (403) with the membership
 *      lookup having run.** The spy pool records the membership query, so with a
 *      session present the request proceeds *past* the session gate and *into*
 *      the membership check — which is exactly the step that was skipped in (1).
 *
 * The contrast between the two runs is the property: the membership lookup is
 * absent precisely when the session is absent, and present once the session is
 * supplied. `numRuns: 100` per the spec convention; the route/method and Trip
 * id vary across runs.
 */

import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { tripRoutes } from '../routes.js';
import type { TripRepo } from '../repo.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Membership-gated routes under test
// ---------------------------------------------------------------------------

/**
 * The Trip-scoped routes currently registered by {@link tripRoutes} that gate
 * on membership (`assertTripMember` / `assertTripOrganizer`). `POST /me/trips`
 * is deliberately excluded: creating a Trip has no membership gate (any
 * authenticated User may create one), so it exercises no membership check and
 * is irrelevant to session-before-membership ordering.
 */
const GATED_ROUTES: ReadonlyArray<{
  readonly method: 'GET' | 'PATCH' | 'DELETE';
  readonly url: (id: string) => string;
  /** A body to send for methods that take one, so validation is never the reason for a rejection. */
  readonly body?: Record<string, unknown>;
}> = [
  { method: 'GET', url: (id) => `/trips/${id}` },
  { method: 'PATCH', url: (id) => `/trips/${id}`, body: { name: 'Renamed trip' } },
  { method: 'DELETE', url: (id) => `/trips/${id}` },
];

// ---------------------------------------------------------------------------
// Spies
// ---------------------------------------------------------------------------

/**
 * A `TripRepo` whose every method throws when called. The deny paths under test
 * (`unauthorized` and `trip_forbidden`) must both reject *before* any
 * persistence work, so any invocation here is a bug the property should catch.
 */
function makeExplodingRepo(): TripRepo {
  const explode = (name: string) => (): never => {
    throw new Error(`repo.${name} must not be called on a denied request`);
  };
  return {
    createTrip: explode('createTrip'),
    getTripForMember: explode('getTripForMember'),
    editTrip: explode('editTrip'),
    deleteTrip: explode('deleteTrip'),
    sendInvite: explode('sendInvite'),
    cancelInvite: explode('cancelInvite'),
    acceptInvite: explode('acceptInvite'),
    declineInvite: explode('declineInvite'),
    getInvite: explode('getInvite'),
  } as unknown as TripRepo;
}

/**
 * A spy pool that records the SQL text of every `query` it receives and always
 * returns an empty result set. `assertTripMember` issues exactly one membership
 * `SELECT` on the deny path; returning no rows makes an authenticated caller a
 * non-member. Recording the calls lets the property assert whether the
 * membership lookup ran.
 */
function makeSpyPool(): { pool: DbPool; queries: string[] } {
  const queries: string[] = [];
  const pool = {
    async query(text: string): Promise<{ rows: unknown[]; rowCount: number }> {
      queries.push(text);
      return { rows: [], rowCount: 0 };
    },
  } as unknown as DbPool;
  return { pool, queries };
}

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

interface BuiltApp {
  readonly app: FastifyInstance;
  readonly queries: string[];
}

/**
 * Build a Fastify instance with the real Trip routes plugin. `authenticate`
 * toggles the fake `requireSession`: when `false` it throws `unauthorized`
 * before assigning a `userId` (no valid session); when `true` it assigns a
 * `userId` so the request proceeds into the membership gate.
 */
async function buildApp(authenticate: boolean, userId: string): Promise<BuiltApp> {
  const { pool, queries } = makeSpyPool();

  const requireSession: preHandlerHookHandler = async (request) => {
    if (!authenticate) {
      // No valid unexpired session: reject before touching the Trip (R15.3).
      throw new AppError('unauthorized', 'Authentication is required.');
    }
    request.userId = userId;
  };

  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(tripRoutes({ repo: makeExplodingRepo(), requireSession, pool }));
  await app.ready();

  return { app, queries };
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('trip routes — Property 12: the session check precedes the membership check', () => {
  it('denies an unauthenticated request with `unauthorized` before any membership lookup, and only reaches the membership check once a session is present', async () => {
    const routeArb = fc.constantFrom(...GATED_ROUTES);
    const tripIdArb = fc.uuid();

    await fc.assert(
      fc.asyncProperty(routeArb, tripIdArb, fc.uuid(), async (route, tripId, userId) => {
        const url = route.url(tripId);
        // Only include `payload` when the route carries a body: under
        // exactOptionalPropertyTypes an explicit `payload: undefined` is not a
        // valid `InjectOptions`.
        const injectOpts = (method: 'GET' | 'PATCH' | 'DELETE') =>
          route.body !== undefined
            ? { method, url, payload: route.body }
            : { method, url };

        // (1) No session: rejected with `unauthorized` (401) and the membership
        // lookup is never performed — the session gate blocks the request
        // before `assertTripMember` runs (R15.3).
        const unauth = await buildApp(false, userId);
        try {
          const res = await unauth.app.inject(injectOpts(route.method));
          expect(res.statusCode).toBe(401);
          expect(res.json()).toMatchObject({ error: { code: 'unauthorized' } });
          // The security-critical assertion: no membership query ran, so the
          // response discloses nothing about the Trip's existence or the
          // caller's membership.
          expect(unauth.queries).toEqual([]);
        } finally {
          await unauth.app.close();
        }

        // (2) Valid session, non-member: the request proceeds past the session
        // gate and into the membership check, which denies with
        // `trip_forbidden` (403). The membership lookup DID run — the very step
        // that was skipped in (1) — confirming the ordering.
        const authed = await buildApp(true, userId);
        try {
          const res = await authed.app.inject(injectOpts(route.method));
          expect(res.statusCode).toBe(403);
          expect(res.json()).toMatchObject({ error: { code: 'trip_forbidden' } });
          // With a session present, exactly the membership lookup that was
          // absent in (1) is now performed.
          expect(authed.queries.length).toBeGreaterThanOrEqual(1);
        } finally {
          await authed.app.close();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
