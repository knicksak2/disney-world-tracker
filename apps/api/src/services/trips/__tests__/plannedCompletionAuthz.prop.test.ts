// Feature: planned-list-completion-sync, Property 6: Planned-completion-sync data and actions require membership and never disclose existence
/**
 * Property-based test for the authorization and non-disclosure guarantee the
 * Planned List Completion Sync feature inherits from the shipped Trips gate
 * (task 2.5).
 *
 * Validates: Requirements 5.7, 7.1, 7.2, 7.3, 7.4
 *
 * Design Property 6 (design.md → Correctness Properties): "Planned-completion-
 * sync data and actions require membership and never disclose existence." This
 * feature adds **no new endpoint** — it is a read-time derivation layer that
 * rides on four existing, already-gated Trip endpoints:
 *
 *   GET  /trips/:id/summary        planned-vs-completed counts (R5.7)
 *   GET  /trips/:id/planned-items  the Planned_List            (R7.1, R7.2)
 *   GET  /trips/:id/feed           the Trip_Activity used to derive completion
 *   POST /trips/:id/log-entries    log a Completion from a Planned_Item (R7.3)
 *
 * Every one of them runs the shared `requireSession` pre-handler first and then
 * `assertTripMember`, so the feature inherits the two-layer gate wholesale. The
 * property pins the three facts that gate must uphold for every one of these
 * reads/actions:
 *
 *   (a) R7.4 — a request lacking a valid authenticated session is denied
 *       `unauthorized` **before** any membership or existence evaluation. We
 *       prove the ordering by observing that the membership lookup (the only
 *       query these deny paths make) never runs on the no-session path.
 *
 *   (b) R7.2 / R7.3 / R5.7 — an authenticated non-member of an existing Trip
 *       and an authenticated requester of a non-existent Trip collapse to the
 *       **byte-for-byte identical** `trip_forbidden` response, carrying no data
 *       and making no change: no repo method is ever reached, so no
 *       `Trip_Log_Entry` is created and no Planned_Item_Completion_State or
 *       Planned_List_Progress is read or altered. Neither requester can infer
 *       whether the Trip exists.
 *
 *   (c) R7.1 — an authenticated current Trip_Member is authorized and the repo
 *       is invoked with **exactly** the requested Trip's id, so the response
 *       carries only that Trip's data.
 *
 * Test strategy (mirrors `routes.sessionOrder.prop.test.ts` and
 * `authz.prop.test.ts`): register the real {@link tripRoutes} plugin against an
 * in-process Fastify instance wired with
 *
 *   - a **fake `requireSession`** toggled per run — it either throws
 *     `unauthorized` (no session) or assigns `request.userId` (valid session);
 *   - a **fake `pool`** that answers only the one membership lookup the gate
 *     performs (`SELECT role FROM trip_memberships WHERE trip_id = $1 AND
 *     user_id = $2`), recording every query so we can assert whether the
 *     membership lookup ran, and seeded so a Trip "exists" iff it has any
 *     membership rows — precisely how a non-existent Trip and an
 *     existing-but-inaccessible Trip both reduce to "no row for (trip, caller)";
 *   - a **recording repo** whose every method records its call and then throws,
 *     so any deny path that reaches persistence is caught twice over (a
 *     recorded call and a 500 instead of the expected 401/403), while the
 *     member path can still assert the single scoped call it expects.
 *
 * Denials are captured as the full wire response the global error hook emits
 * (status + envelope body), so deep equality is a faithful stand-in for the
 * byte-for-byte identity R7.2 demands. `numRuns: 100` per the spec convention;
 * the endpoint and Trip id vary across runs.
 */

import Fastify, {
  type FastifyInstance,
  type preHandlerHookHandler,
} from 'fastify';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { tripRoutes } from '../routes.js';
import type { TripRepo } from '../repo.js';
import type { TripRole } from '../permissions.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// The planned-completion-sync reads/actions under test
// ---------------------------------------------------------------------------

/**
 * The four existing, member-gated endpoints this feature rides on. Each carries
 * the repo method it delegates to once authorized, the success status, and (for
 * the POST) a valid body so validation is never the reason for a rejection.
 * All four sit behind `requireSession` + `assertTripMember`; none is new.
 */
interface GatedRoute {
  readonly label: string;
  readonly method: 'GET' | 'POST';
  readonly url: (id: string) => string;
  /** The repo method the handler reaches only after the membership gate passes. */
  readonly repoMethod: keyof TripRepo;
  /** Success status when an authorized Member makes the request. */
  readonly okStatus: number;
  /** A valid body for methods that take one (a well-formed log-entry). */
  readonly body?: () => Record<string, unknown>;
}

const GATED_ROUTES: readonly GatedRoute[] = [
  {
    label: 'GET /trips/:id/summary',
    method: 'GET',
    url: (id) => `/trips/${id}/summary`,
    repoMethod: 'getSummary',
    okStatus: 200,
  },
  {
    label: 'GET /trips/:id/planned-items',
    method: 'GET',
    url: (id) => `/trips/${id}/planned-items`,
    repoMethod: 'listPlannedItems',
    okStatus: 200,
  },
  {
    label: 'GET /trips/:id/feed',
    method: 'GET',
    url: (id) => `/trips/${id}/feed`,
    repoMethod: 'getFeed',
    okStatus: 200,
  },
  {
    label: 'POST /trips/:id/log-entries',
    method: 'POST',
    url: (id) => `/trips/${id}/log-entries`,
    repoMethod: 'logCompletion',
    okStatus: 201,
    body: () => ({
      // A well-formed log-entry body so `tripLogEntryCreateSchema` passes and
      // the membership gate — never validation — is the deciding factor.
      experienceId: '11111111-1111-4111-8111-111111111111',
      rodeWith: [],
    }),
  },
];

// ---------------------------------------------------------------------------
// In-memory model of the single table the gate queries
// ---------------------------------------------------------------------------

interface MembershipRow {
  readonly tripId: string;
  readonly userId: string;
  readonly role: TripRole;
}

/**
 * Build a fake pool exposing only the membership lookup the gate performs,
 * recording every query so the property can assert whether it ran. A Trip with
 * no rows is indistinguishable, at this layer, from a Trip that does not
 * exist — which is exactly the collapse Property 6 requires. Any other SQL
 * throws so a future change to the gate's query surfaces here rather than being
 * silently mis-modelled.
 */
function makeFakePool(rows: readonly MembershipRow[]): {
  pool: DbPool;
  queries: string[];
} {
  const queries: string[] = [];
  const pool = {
    async query(
      text: string,
      params?: readonly unknown[],
    ): Promise<{ rows: unknown[] }> {
      queries.push(text.trim());
      const trimmed = text.trim();
      if (trimmed.startsWith('SELECT role FROM trip_memberships')) {
        const tripId = String(params?.[0]);
        const userId = String(params?.[1]);
        const matches = rows.filter(
          (r) => r.tripId === tripId && r.userId === userId,
        );
        return { rows: matches.map((r) => ({ role: r.role })) };
      }
      throw new Error(`unhandled SQL in fake pool: ${trimmed.slice(0, 64)}`);
    },
  } as unknown as DbPool;
  return { pool, queries };
}

// ---------------------------------------------------------------------------
// Recording repo
// ---------------------------------------------------------------------------

interface RepoCall {
  readonly method: string;
  readonly tripId: string;
}

/**
 * A repo that records every call. On the deny paths (no session / non-member /
 * non-existent Trip) it must never be reached, so its methods additionally
 * throw — any invocation is caught twice: the recorded call is non-empty and
 * the response is a 500 rather than the expected 401/403. On the authorized
 * member path the four in-scope methods return that Trip's scoped data instead,
 * so the property can assert the response carries only the requested Trip's id.
 */
function makeRecordingRepo(opts: {
  readonly scoped: boolean;
}): { repo: TripRepo; calls: RepoCall[] } {
  const calls: RepoCall[] = [];

  const record = (method: string, tripId: string): void => {
    calls.push({ method, tripId });
  };

  // Deny-path guard: throws so a denied request that slips through to the repo
  // is caught by the status assertion as well as the recorded-call assertion.
  const deny = (method: string) => (tripId: string): never => {
    record(method, tripId);
    throw new Error(`repo.${method} must not be called on a denied request`);
  };

  const scopedHandlers = {
    getSummary: async (tripId: string) => {
      record('getSummary', tripId);
      return { scopedTo: tripId, plannedTotalCount: 0, plannedCompletedCount: 0 };
    },
    listPlannedItems: async (tripId: string) => {
      record('listPlannedItems', tripId);
      return [{ scopedTo: tripId }];
    },
    getFeed: async (tripId: string) => {
      record('getFeed', tripId);
      return [{ scopedTo: tripId }];
    },
    logCompletion: async (tripId: string) => {
      record('logCompletion', tripId);
      return { logEntryId: `log-${tripId}`, pendingTags: [] };
    },
  };

  const denyHandlers = {
    getSummary: deny('getSummary'),
    listPlannedItems: deny('listPlannedItems'),
    getFeed: deny('getFeed'),
    logCompletion: deny('logCompletion'),
  };

  const inScope = opts.scoped ? scopedHandlers : denyHandlers;

  // Every other repo method also explodes: no in-scope route should reach them,
  // so a stray call is a bug the property should catch.
  const explode = (name: string) => (): never => {
    throw new Error(`repo.${name} must not be called by an in-scope route`);
  };

  const repo = {
    ...inScope,
    createTrip: explode('createTrip'),
    getTripForMember: explode('getTripForMember'),
    editTrip: explode('editTrip'),
    deleteTrip: explode('deleteTrip'),
    sendInvite: explode('sendInvite'),
    cancelInvite: explode('cancelInvite'),
    acceptInvite: explode('acceptInvite'),
    declineInvite: explode('declineInvite'),
    getInvite: explode('getInvite'),
    listMyInvites: explode('listMyInvites'),
    listMembers: explode('listMembers'),
    listPendingInvites: explode('listPendingInvites'),
    addPlannedItem: explode('addPlannedItem'),
    removePlannedItem: explode('removePlannedItem'),
    listLogEntries: explode('listLogEntries'),
    confirmRodeWithTag: explode('confirmRodeWithTag'),
    getRodeWithTag: explode('getRodeWithTag'),
    promote: explode('promote'),
    demote: explode('demote'),
    removeMember: explode('removeMember'),
    addReaction: explode('addReaction'),
    removeReaction: explode('removeReaction'),
    addComment: explode('addComment'),
    removeComment: explode('removeComment'),
    listMyTrips: explode('listMyTrips'),
  } as unknown as TripRepo;

  return { repo, calls };
}

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

interface BuiltApp {
  readonly app: FastifyInstance;
  readonly queries: string[];
  readonly calls: RepoCall[];
}

/**
 * Build a Fastify instance with the real Trip routes plugin. `authenticate`
 * toggles the fake `requireSession`: when `false` it throws `unauthorized`
 * before assigning a `userId`; when `true` it assigns `userId` so the request
 * proceeds into the membership gate. `membershipRows` seeds the fake pool, and
 * `scopedRepo` selects whether the repo returns scoped data (authorized member)
 * or explodes (deny path).
 */
async function buildApp(config: {
  readonly authenticate: boolean;
  readonly userId: string;
  readonly membershipRows: readonly MembershipRow[];
  readonly scopedRepo: boolean;
}): Promise<BuiltApp> {
  const { pool, queries } = makeFakePool(config.membershipRows);
  const { repo, calls } = makeRecordingRepo({ scoped: config.scopedRepo });

  const requireSession: preHandlerHookHandler = async (request) => {
    if (!config.authenticate) {
      // No valid unexpired session: reject before any Trip is touched (R7.4).
      throw new AppError('unauthorized', 'Authentication is required.');
    }
    request.userId = config.userId;
  };

  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(tripRoutes({ repo, requireSession, pool }));
  await app.ready();

  return { app, queries, calls };
}

/** Build inject options, only attaching a payload when the route carries one. */
function injectOpts(route: GatedRoute, tripId: string) {
  const url = route.url(tripId);
  return route.body !== undefined
    ? { method: route.method, url, payload: route.body() }
    : { method: route.method, url };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const roleArb: fc.Arbitrary<TripRole> = fc.constantFrom('organizer', 'member');
const routeArb = fc.constantFrom(...GATED_ROUTES);

/**
 * A Trip that genuinely exists — it has one or more *other* Members — plus a
 * caller who is NOT one of them. The caller stands in for both a stranger and a
 * former Member; the gate cannot tell them apart.
 */
const nonMemberScenarioArb = fc
  .record({
    tripId: fc.uuid(),
    callerId: fc.uuid(),
    otherMembers: fc.array(fc.record({ userId: fc.uuid(), role: roleArb }), {
      minLength: 1,
      maxLength: 5,
    }),
  })
  .map((s) => ({
    ...s,
    otherMembers: s.otherMembers.filter((m) => m.userId !== s.callerId),
  }))
  .filter((s) => s.otherMembers.length >= 1);

const memberScenarioArb = fc.record({
  tripId: fc.uuid(),
  callerId: fc.uuid(),
  role: roleArb,
});

// ---------------------------------------------------------------------------
// Property 6
// ---------------------------------------------------------------------------

describe('planned-completion-sync authz — Property 6: data and actions require membership and never disclose existence', () => {
  it('denies every planned-completion-sync read/action with `unauthorized` before any membership or existence check when there is no valid session (R7.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        routeArb,
        fc.uuid(),
        fc.uuid(),
        async (route, tripId, userId) => {
          const built = await buildApp({
            authenticate: false,
            userId,
            membershipRows: [],
            scopedRepo: false,
          });
          try {
            const res = await built.app.inject(injectOpts(route, tripId));

            // Denied `unauthorized` (401) with the bare envelope — nothing about
            // the Trip's existence or the caller's membership is disclosed.
            expect(res.statusCode).toBe(401);
            expect(res.json()).toMatchObject({
              error: { code: 'unauthorized' },
            });

            // The security-critical ordering: the membership/existence lookup
            // never ran, so the session check provably precedes it (R7.4)...
            expect(built.queries).toEqual([]);
            // ...and no repo work happened, so no data was read or written.
            expect(built.calls).toEqual([]);
          } finally {
            await built.app.close();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('collapses an authenticated non-member of an existing Trip and a non-existent Trip to an identical `trip_forbidden`, reading no data and creating no Trip_Log_Entry (R7.2, R7.3, R5.7)', async () => {
    await fc.assert(
      fc.asyncProperty(nonMemberScenarioArb, routeArb, async (s, route) => {
        // Case A: the Trip exists (other Members) but the caller is not one.
        const existingRows: MembershipRow[] = s.otherMembers.map((m) => ({
          tripId: s.tripId,
          userId: m.userId,
          role: m.role,
        }));
        const existing = await buildApp({
          authenticate: true,
          userId: s.callerId,
          membershipRows: existingRows,
          scopedRepo: false,
        });
        // Case B: the Trip does not exist at all — no membership rows anywhere.
        const absent = await buildApp({
          authenticate: true,
          userId: s.callerId,
          membershipRows: [],
          scopedRepo: false,
        });

        try {
          const resExisting = await existing.app.inject(
            injectOpts(route, s.tripId),
          );
          const resAbsent = await absent.app.inject(
            injectOpts(route, s.tripId),
          );

          // Both are denied `trip_forbidden` (403): no data leaks (R7.2).
          expect(resExisting.statusCode).toBe(403);
          expect(resAbsent.statusCode).toBe(403);
          expect(resExisting.json()).toMatchObject({
            error: { code: 'trip_forbidden' },
          });

          // Non-disclosure: the two responses are byte-for-byte identical, so a
          // non-member cannot tell an inaccessible Trip from a non-existent one
          // (R7.2, R5.7).
          expect(resExisting.statusCode).toBe(resAbsent.statusCode);
          expect(resExisting.json()).toEqual(resAbsent.json());

          // No change and no disclosure: the repo was never reached on either
          // path, so no Trip_Log_Entry was created and no Planned_Item state or
          // Planned_List_Progress was read or altered (R7.3, R7.2).
          expect(existing.calls).toEqual([]);
          expect(absent.calls).toEqual([]);
        } finally {
          await existing.app.close();
          await absent.app.close();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('authorizes an authenticated current Trip_Member and returns only that Trip\'s data (R7.1)', async () => {
    await fc.assert(
      fc.asyncProperty(memberScenarioArb, routeArb, async (s, route) => {
        const built = await buildApp({
          authenticate: true,
          userId: s.callerId,
          membershipRows: [
            { tripId: s.tripId, userId: s.callerId, role: s.role },
          ],
          scopedRepo: true,
        });

        try {
          const res = await built.app.inject(injectOpts(route, s.tripId));

          // The Member is authorized: the request succeeds.
          expect(res.statusCode).toBe(route.okStatus);

          // The membership lookup ran (the gate was consulted) and the repo was
          // invoked exactly once, scoped to the requested Trip — only that
          // Trip's data is returned, never another Trip's (R7.1).
          expect(built.calls).toEqual([
            { method: route.repoMethod, tripId: s.tripId },
          ]);

          // The response body carries only the requested Trip's id.
          const body = res.json();
          if (route.repoMethod === 'logCompletion') {
            expect(body).toEqual({ logEntryId: `log-${s.tripId}` });
          } else if (Array.isArray(body)) {
            expect(body).toEqual([{ scopedTo: s.tripId }]);
          } else {
            expect(body).toMatchObject({ scopedTo: s.tripId });
          }
        } finally {
          await built.app.close();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
