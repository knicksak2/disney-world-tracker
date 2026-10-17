import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { createTripBookingRepo } from '../repo.js';
import { tripBookingRoutes } from '../routes.js';
import { setupTestDb } from './testDb.js';

interface RouteDef {
  readonly name: string;
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  readonly buildUrl: (tripId: string, itemId: string) => string;
  readonly validPayload?: (memberId: string) => any;
}

const ALL_NON_CRON_ROUTES: readonly RouteDef[] = [
  {
    name: 'GET /trips/:id/booking-timeline',
    method: 'GET',
    buildUrl: (tripId) => `/trips/${tripId}/booking-timeline`,
  },
  {
    name: 'PATCH /trips/:id/booking-settings',
    method: 'PATCH',
    buildUrl: (tripId) => `/trips/${tripId}/booking-settings`,
    validPayload: () => ({ stayType: 'resort' }),
  },
  {
    name: 'PUT /trips/:id/booking-windows/:kind/:dropOn/done',
    method: 'PUT',
    buildUrl: (tripId) => `/trips/${tripId}/booking-windows/dining/2026-08-02/done`,
    validPayload: () => ({ done: true }),
  },
  {
    name: 'PUT /me/trips/:id/booking-reminders',
    method: 'PUT',
    buildUrl: (tripId) => `/me/trips/${tripId}/booking-reminders`,
    validPayload: () => ({ muted: true }),
  },
  {
    name: 'GET /trips/:id/packing-items',
    method: 'GET',
    buildUrl: (tripId) => `/trips/${tripId}/packing-items`,
  },
  {
    name: 'POST /trips/:id/packing-items',
    method: 'POST',
    buildUrl: (tripId) => `/trips/${tripId}/packing-items`,
    validPayload: () => ({ name: 'Hat', category: 'park_gear' }),
  },
  {
    name: 'POST /trips/:id/packing-items/starter',
    method: 'POST',
    buildUrl: (tripId) => `/trips/${tripId}/packing-items/starter`,
  },
  {
    name: 'PATCH /trips/:id/packing-items/:itemId',
    method: 'PATCH',
    buildUrl: (tripId, itemId) => `/trips/${tripId}/packing-items/${itemId}`,
    validPayload: () => ({ name: 'New Name' }),
  },
  {
    name: 'DELETE /trips/:id/packing-items/:itemId',
    method: 'DELETE',
    buildUrl: (tripId, itemId) => `/trips/${tripId}/packing-items/${itemId}`,
  },
  {
    name: 'PUT /trips/:id/packing-items/:itemId/packed',
    method: 'PUT',
    buildUrl: (tripId, itemId) => `/trips/${tripId}/packing-items/${itemId}/packed`,
    validPayload: () => ({ packed: true }),
  },
];

describe('tripBooking cross-route authorization and error properties', () => {
  let pool: DbPool;
  let testDb: ReturnType<typeof setupTestDb>;
  let activeUserId: string | null = null;
  let app: FastifyInstance;

  const ORGANIZER_ID = '11111111-1111-1111-1111-111111111111';
  const MEMBER_ID = '22222222-2222-2222-2222-222222222222';
  const NON_MEMBER_ID = '33333333-3333-3333-3333-333333333333';
  const TRIP_ID = '44444444-4444-4444-4444-444444444444';
  const PACKING_ITEM_ID = '55555555-5555-5555-5555-555555555555';

  async function getTableCounts(): Promise<Record<string, number>> {
    const res = await pool.query(
      `SELECT
        (SELECT count(*) FROM trip_booking_settings) as settings_count,
        (SELECT count(*) FROM trip_booking_window_done) as done_count,
        (SELECT count(*) FROM trip_booking_reminder_mutes) as mutes_count,
        (SELECT count(*) FROM trip_booking_reminder_log) as log_count,
        (SELECT count(*) FROM trip_packing_items) as packing_count`,
    );
    const row = res.rows[0];
    return {
      settings: Number(row?.settings_count),
      done: Number(row?.done_count),
      mutes: Number(row?.mutes_count),
      log: Number(row?.log_count),
      packing: Number(row?.packing_count),
    };
  }

  beforeEach(async () => {
    testDb = setupTestDb();
    pool = testDb.pool as unknown as DbPool;
    activeUserId = MEMBER_ID;

    // Seed users and profiles
    const userSeeds: [string, string][] = [
      [ORGANIZER_ID, 'Alice Organizer'],
      [MEMBER_ID, 'Bob Member'],
      [NON_MEMBER_ID, 'Charlie Stranger'],
    ];
    for (const [uid, name] of userSeeds) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash')`,
        [uid, `${name.toLowerCase().replace(' ', '')}@example.com`],
      );
      await pool.query(
        `INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)`,
        [uid, name],
      );
    }

    // Seed trip
    await pool.query(
      `INSERT INTO trips (id, name, start_date, end_date, creator_id)
       VALUES ($1, 'Main Trip', '2026-10-01', '2026-10-10', $2)`,
      [TRIP_ID, ORGANIZER_ID],
    );

    // Seed memberships
    await pool.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role)
       VALUES ($1, $2, 'organizer'),
              ($1, $3, 'member')`,
      [TRIP_ID, ORGANIZER_ID, MEMBER_ID],
    );

    // Seed an item added by MEMBER_ID
    await pool.query(
      `INSERT INTO trip_packing_items (id, trip_id, name, category, quantity, added_by)
       VALUES ($1, $2, 'Existing Item', 'documents', 1, $3)`,
      [PACKING_ITEM_ID, TRIP_ID, MEMBER_ID],
    );

    const repo = createTripBookingRepo(pool);

    app = Fastify();
    registerErrorHandler(app);

    const requireSession: preHandlerHookHandler = async (request) => {
      if (activeUserId === null) {
        throw new AppError('unauthorized', 'Authentication is required.');
      }
      request.userId = activeUserId;
    };

    await app.register(
      tripBookingRoutes({
        repo,
        pool,
        requireSession,
        now: () => new Date('2026-08-01T12:00:00.000Z'),
      }),
    );
    await app.ready();
  });

  // Feature: trip-booking-timeline, Property 37: Non-members cannot distinguish an existing Trip from an unknown one; authentication precedes lookup.
  it('Property 37: Non-members cannot distinguish an existing Trip from an unknown one; authentication precedes lookup', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ALL_NON_CRON_ROUTES),
        fc.uuid(),
        async (route, randomUnknownTripId) => {
          // 1. Unauthenticated request -> 401 unauthorized, ZERO db queries
          activeUserId = null;
          testDb.recordedQueries.length = 0;

          const unauthRes = await app.inject({
            method: route.method,
            url: route.buildUrl(TRIP_ID, PACKING_ITEM_ID),
            ...(route.validPayload ? { payload: route.validPayload(MEMBER_ID) } : {}),
          });

          expect(unauthRes.statusCode).toBe(401);
          expect(unauthRes.json().error.code).toBe('unauthorized');
          expect(testDb.recordedQueries.length).toBe(0);

          // 2. Non-member targeting real Trip vs non-existent Trip -> byte-identical 403 trip_forbidden
          activeUserId = NON_MEMBER_ID;
          const countsBefore = await getTableCounts();

          const realTripRes = await app.inject({
            method: route.method,
            url: route.buildUrl(TRIP_ID, PACKING_ITEM_ID),
            ...(route.validPayload ? { payload: route.validPayload(NON_MEMBER_ID) } : {}),
          });

          const unknownTripRes = await app.inject({
            method: route.method,
            url: route.buildUrl(randomUnknownTripId, PACKING_ITEM_ID),
            ...(route.validPayload ? { payload: route.validPayload(NON_MEMBER_ID) } : {}),
          });

          expect(realTripRes.statusCode).toBe(403);
          expect(unknownTripRes.statusCode).toBe(403);
          expect(realTripRes.body).toBe(unknownTripRes.body);
          expect(realTripRes.json().error.code).toBe('trip_forbidden');

          // No rows created, changed, or deleted
          const countsAfter = await getTableCounts();
          expect(countsAfter).toEqual(countsBefore);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 37 (revocation): request after membership is deleted is denied with trip_forbidden', async () => {
    // Member Bob is a member initially
    activeUserId = MEMBER_ID;
    const resBefore = await app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/booking-timeline`,
    });
    expect(resBefore.statusCode).toBe(200);

    // Remove Bob's membership
    await pool.query(
      `DELETE FROM trip_memberships WHERE trip_id = $1 AND user_id = $2`,
      [TRIP_ID, MEMBER_ID],
    );

    // Bob is now denied
    const resAfter = await app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/booking-timeline`,
    });
    expect(resAfter.statusCode).toBe(403);
    expect(resAfter.json().error.code).toBe('trip_forbidden');
  });

  // Feature: trip-booking-timeline, Property 38: Failures use only the four existing error codes and leave data unchanged.
  it('Property 38: Failures use only the four existing error codes and leave data unchanged', async () => {
    const ALLOWED_ERROR_CODES = new Set([
      'unauthorized',
      'trip_forbidden',
      'trip_validation_failed',
      'trip_not_found',
    ]);

    // Generator of diverse malformed requests
    const failureCaseArb = fc.oneof(
      // Malformed trip ID
      fc.record({
        kind: fc.constant('bad_trip_id' as const),
        route: fc.constantFrom(...ALL_NON_CRON_ROUTES),
        badId: fc.constantFrom('not-a-uuid', '123', 'bad!uuid', ''),
      }),
      // Malformed item ID
      fc.record({
        kind: fc.constant('bad_item_id' as const),
        route: fc.constantFrom(
          ALL_NON_CRON_ROUTES[7]!, // PATCH packing item
          ALL_NON_CRON_ROUTES[8]!, // DELETE packing item
          ALL_NON_CRON_ROUTES[9]!, // PUT packed
        ),
        badItemId: fc.constantFrom('not-a-uuid', 'xyz', '12345'),
      }),
      // Invalid body for settings
      fc.record({
        kind: fc.constant('bad_settings_body' as const),
        route: fc.constant(ALL_NON_CRON_ROUTES[1]!),
        payload: fc.oneof(
          fc.constant({}),
          fc.constant({ stayType: 'invalid_stay' }),
          fc.constant({ lightningLaneTiming: 'invalid_timing' }),
          fc.constant({ checkInOverride: 'not-a-date' }),
          fc.constant({ checkInOverride: '2026-08-01' }), // out of range (< start-30d)
          fc.constant({ extraKey: 'surprise' }),
        ),
      }),
      // Invalid body for done window
      fc.record({
        kind: fc.constant('bad_done_body' as const),
        route: fc.constant(ALL_NON_CRON_ROUTES[2]!),
        payload: fc.oneof(
          fc.constant({ done: 'yes' }),
          fc.constant({ done: 1 }),
          fc.constant({ done: null }),
          fc.constant({}),
          fc.constant({ done: true, extra: 123 }),
        ),
      }),
      // Invalid body for mute
      fc.record({
        kind: fc.constant('bad_mute_body' as const),
        route: fc.constant(ALL_NON_CRON_ROUTES[3]!),
        payload: fc.oneof(
          fc.constant({ muted: 'true' }),
          fc.constant({}),
          fc.constant({ muted: true, userId: ORGANIZER_ID }), // extra userId rejected
          fc.constant({ muted: true, unknown: 'field' }),
        ),
      }),
      // Invalid body for packing item create
      fc.record({
        kind: fc.constant('bad_packing_create' as const),
        route: fc.constant(ALL_NON_CRON_ROUTES[5]!),
        payload: fc.oneof(
          fc.constant({ name: '   ', category: 'clothing' }),
          fc.constant({ name: 'x'.repeat(81), category: 'clothing' }),
          fc.constant({ name: 'Valid Name', category: 'invalid_category' }),
          fc.constant({ name: 'Valid Name', category: 'clothing', quantity: 0 }),
          fc.constant({ name: 'Valid Name', category: 'clothing', quantity: 100 }),
          fc.constant({ name: 'Valid Name', category: 'clothing', quantity: 2.5 }),
          fc.constant({ name: 'Valid Name', category: 'clothing', assigneeId: NON_MEMBER_ID }),
          fc.constant({ name: 'Valid Name', category: 'clothing', extra: 'bad' }),
        ),
      }),
      // Invalid body for packing item update
      fc.record({
        kind: fc.constant('bad_packing_update' as const),
        route: fc.constant(ALL_NON_CRON_ROUTES[7]!),
        payload: fc.oneof(
          fc.constant({}), // at least one key required
          fc.constant({ name: '' }),
          fc.constant({ name: '  ' }),
          fc.constant({ name: 'a'.repeat(85) }),
          fc.constant({ category: 'bogus' }),
          fc.constant({ quantity: -1 }),
          fc.constant({ assigneeId: 'not-a-uuid' }),
        ),
      }),
    );

    await fc.assert(
      fc.asyncProperty(failureCaseArb, async (failureCase) => {
        activeUserId = ORGANIZER_ID; // organizer role so permissions pass and validation trips
        const countsBefore = await getTableCounts();

        let url: string;
        let payload: any = undefined;

        switch (failureCase.kind) {
          case 'bad_trip_id':
            url = failureCase.route.buildUrl(failureCase.badId, PACKING_ITEM_ID);
            payload = failureCase.route.validPayload?.(ORGANIZER_ID);
            break;
          case 'bad_item_id':
            url = failureCase.route.buildUrl(TRIP_ID, failureCase.badItemId);
            payload = failureCase.route.validPayload?.(ORGANIZER_ID);
            break;
          default:
            url = failureCase.route.buildUrl(TRIP_ID, PACKING_ITEM_ID);
            payload = failureCase.payload;
            break;
        }

        const res = await app.inject({
          method: failureCase.route.method,
          url,
          ...(payload !== undefined ? { payload } : {}),
        });

        // Must fail with 4xx
        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(res.statusCode).toBeLessThan(500);

        const body = res.json();
        expect(body).toHaveProperty('error');
        expect(typeof body.error.code).toBe('string');
        expect(typeof body.error.message).toBe('string');

        // Strictly one of the 4 approved error codes
        expect(ALLOWED_ERROR_CODES.has(body.error.code)).toBe(true);

        // Data in tables remains completely unchanged
        const countsAfter = await getTableCounts();
        expect(countsAfter).toEqual(countsBefore);
      }),
      { numRuns: 100 },
    );
  });
});
