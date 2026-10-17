import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { BOOKING_RULES_VERSION, type BookingTimelineDTO, type BookingWindowDTO } from '@dwt/shared';
import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { createTripBookingRepo } from '../repo.js';
import { tripBookingRoutes } from '../routes.js';
import { setupTestDb } from './testDb.js';

describe('tripBooking routes: timeline, settings, done, mute', () => {
  let pool: DbPool;
  let testNow: Date;
  let activeUserId: string | null = null;
  let app: FastifyInstance;

  const ORGANIZER_ID = '11111111-1111-1111-1111-111111111111';
  const MEMBER_ID = '22222222-2222-2222-2222-222222222222';
  const NON_MEMBER_ID = '33333333-3333-3333-3333-333333333333';
  const TRIP_ID = '44444444-4444-4444-4444-444444444444';
  const UNKNOWN_TRIP_ID = '55555555-5555-5555-5555-555555555555';

  beforeEach(async () => {
    testNow = new Date('2026-08-01T12:00:00.000Z');
    activeUserId = ORGANIZER_ID;

    const setup = setupTestDb();
    pool = setup.pool as unknown as DbPool;

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

    // Seed trip (2026-10-01 to 2026-10-10)
    await pool.query(
      `INSERT INTO trips (id, name, start_date, end_date, creator_id)
       VALUES ($1, 'Disney Fall 2026', '2026-10-01', '2026-10-10', $2)`,
      [TRIP_ID, ORGANIZER_ID],
    );

    // Seed memberships
    await pool.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role) VALUES ($1, $2, 'organizer')`,
      [TRIP_ID, ORGANIZER_ID],
    );
    await pool.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role) VALUES ($1, $2, 'member')`,
      [TRIP_ID, MEMBER_ID],
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
        now: () => testNow,
      }),
    );
    await app.ready();
  });

  describe('GET /trips/:id/booking-timeline', () => {
    it('returns 401 unauthorized when session is absent', async () => {
      activeUserId = null;
      const res = await app.inject({
        method: 'GET',
        url: `/trips/${TRIP_ID}/booking-timeline`,
      });
      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error.code).toBe('unauthorized');
    });

    it('returns byte-identical 403 trip_forbidden for non-member and unknown trip', async () => {
      activeUserId = NON_MEMBER_ID;
      const resNonMember = await app.inject({
        method: 'GET',
        url: `/trips/${TRIP_ID}/booking-timeline`,
      });

      const resUnknownTrip = await app.inject({
        method: 'GET',
        url: `/trips/${UNKNOWN_TRIP_ID}/booking-timeline`,
      });

      expect(resNonMember.statusCode).toBe(403);
      expect(resUnknownTrip.statusCode).toBe(403);
      expect(resNonMember.body).toBe(resUnknownTrip.body);
      expect(resNonMember.json().error.code).toBe('trip_forbidden');
    });

    it('returns sorted windows, rulesVersion, muted scoped to viewer, and leaves table counts unchanged', async () => {
      activeUserId = ORGANIZER_ID;
      // Set mute for ORGANIZER_ID
      await app.inject({
        method: 'PUT',
        url: `/me/trips/${TRIP_ID}/booking-reminders`,
        payload: { muted: true },
      });

      // Snapshot table counts
      const countsBefore = await pool.query(
        `SELECT
          (SELECT count(*) FROM trip_booking_settings) as s,
          (SELECT count(*) FROM trip_booking_window_done) as d,
          (SELECT count(*) FROM trip_booking_reminder_mutes) as m,
          (SELECT count(*) FROM trip_booking_reminder_log) as l,
          (SELECT count(*) FROM trip_packing_items) as p`,
      );

      // GET as organizer
      const resOrg = await app.inject({
        method: 'GET',
        url: `/trips/${TRIP_ID}/booking-timeline`,
      });
      expect(resOrg.statusCode).toBe(200);
      const dtoOrg: BookingTimelineDTO = resOrg.json();
      expect(dtoOrg.tripId).toBe(TRIP_ID);
      expect(dtoOrg.rulesVersion).toBe(BOOKING_RULES_VERSION);
      expect(dtoOrg.muted).toBe(true);
      expect(dtoOrg.windows.length).toBeGreaterThan(0);

      // Windows are sorted by dropAt ASC, dining before lightning_lane on tie
      for (let i = 1; i < dtoOrg.windows.length; i++) {
        const prev = dtoOrg.windows[i - 1]!;
        const curr = dtoOrg.windows[i]!;
        expect(prev.dropAt <= curr.dropAt).toBe(true);
      }

      // Read leaves table counts unchanged
      const countsAfter = await pool.query(
        `SELECT
          (SELECT count(*) FROM trip_booking_settings) as s,
          (SELECT count(*) FROM trip_booking_window_done) as d,
          (SELECT count(*) FROM trip_booking_reminder_mutes) as m,
          (SELECT count(*) FROM trip_booking_reminder_log) as l,
          (SELECT count(*) FROM trip_packing_items) as p`,
      );
      expect(countsAfter.rows[0]).toEqual(countsBefore.rows[0]);

      // GET as Bob (MEMBER_ID) -> muted is false
      activeUserId = MEMBER_ID;
      const resBob = await app.inject({
        method: 'GET',
        url: `/trips/${TRIP_ID}/booking-timeline`,
      });
      expect(resBob.statusCode).toBe(200);
      expect(resBob.json().muted).toBe(false);
    });

    it('rejects malformed tripId with 400 trip_validation_failed', async () => {
      activeUserId = ORGANIZER_ID;
      const res = await app.inject({
        method: 'GET',
        url: `/trips/not-a-uuid/booking-timeline`,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('trip_validation_failed');
    });
  });

  describe('PATCH /trips/:id/booking-settings', () => {
    it('returns 403 trip_forbidden when called by a non-organizer member', async () => {
      activeUserId = MEMBER_ID;
      const res = await app.inject({
        method: 'PATCH',
        url: `/trips/${TRIP_ID}/booking-settings`,
        payload: { stayType: 'resort' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('trip_forbidden');

      // Stored row is unchanged
      const rows = await pool.query(`SELECT * FROM trip_booking_settings WHERE trip_id = $1`, [TRIP_ID]);
      expect(rows.rowCount).toBe(0);
    });

    it('returns 400 trip_validation_failed when empty body is sent', async () => {
      activeUserId = ORGANIZER_ID;
      const res = await app.inject({
        method: 'PATCH',
        url: `/trips/${TRIP_ID}/booking-settings`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('trip_validation_failed');
    });

    it('returns 400 trip_validation_failed on out-of-range override and rolls back atomically', async () => {
      activeUserId = ORGANIZER_ID;
      // Start is 2026-10-01. Range is [2026-09-01, 2026-10-01]. 2026-08-30 is invalid.
      const res = await app.inject({
        method: 'PATCH',
        url: `/trips/${TRIP_ID}/booking-settings`,
        payload: {
          stayType: 'resort',
          checkInOverride: '2026-08-30',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('trip_validation_failed');

      // Valid sibling field (stayType) was not persisted
      const rows = await pool.query(`SELECT * FROM trip_booking_settings WHERE trip_id = $1`, [TRIP_ID]);
      expect(rows.rowCount).toBe(0);
    });

    it('updates settings and subsequent GET /booking-timeline reflects the changes', async () => {
      activeUserId = ORGANIZER_ID;
      const res = await app.inject({
        method: 'PATCH',
        url: `/trips/${TRIP_ID}/booking-settings`,
        payload: {
          stayType: 'resort',
          lightningLaneTiming: 'seven_day',
          checkInOverride: '2026-09-25',
        },
      });
      expect(res.statusCode).toBe(200);
      const updated = res.json();
      expect(updated.stayType).toBe('resort');
      expect(updated.lightningLaneTiming).toBe('seven_day');
      expect(updated.checkInOverride).toBe('2026-09-25');

      // GET reflects the change
      const timelineRes = await app.inject({
        method: 'GET',
        url: `/trips/${TRIP_ID}/booking-timeline`,
      });
      expect(timelineRes.statusCode).toBe(200);
      const timeline: BookingTimelineDTO = timelineRes.json();
      expect(timeline.stayType).toEqual({ value: 'resort', source: 'override' });
      expect(timeline.lightningLaneTiming).toEqual({ value: 'seven_day', source: 'override' });
      expect(timeline.arrivalDate).toEqual({ value: '2026-09-25', source: 'override' });
    });
  });

  describe('PUT /trips/:id/booking-windows/:kind/:dropOn/done', () => {
    it('marks a window done, returns updated window, and repeating leaves doneAt identical', async () => {
      activeUserId = MEMBER_ID;

      // First fetch timeline to get a real valid window
      const timelineRes = await app.inject({
        method: 'GET',
        url: `/trips/${TRIP_ID}/booking-timeline`,
      });
      const timeline: BookingTimelineDTO = timelineRes.json();
      const firstWindow = timeline.windows[0]!;

      // Mark done: true
      const putRes = await app.inject({
        method: 'PUT',
        url: `/trips/${TRIP_ID}/booking-windows/${firstWindow.kind}/${firstWindow.dropOn}/done`,
        payload: { done: true },
      });
      expect(putRes.statusCode).toBe(200);
      const winDone: BookingWindowDTO = putRes.json();
      expect(winDone.done).toBe(true);
      expect(winDone.doneByDisplayName).toBe('Bob Member');
      expect(winDone.doneAt).toBeTruthy();

      const originalDoneAt = winDone.doneAt;

      // Advance clock and mark done again as organizer
      testNow = new Date('2026-08-02T12:00:00.000Z');
      activeUserId = ORGANIZER_ID;

      const repeatRes = await app.inject({
        method: 'PUT',
        url: `/trips/${TRIP_ID}/booking-windows/${firstWindow.kind}/${firstWindow.dropOn}/done`,
        payload: { done: true },
      });
      expect(repeatRes.statusCode).toBe(200);
      const repeatWin: BookingWindowDTO = repeatRes.json();
      expect(repeatWin.done).toBe(true);
      expect(repeatWin.doneAt).toBe(originalDoneAt);
      expect(repeatWin.doneByDisplayName).toBe('Bob Member'); // original marker preserved

      // Untoggle done
      const untoggleRes = await app.inject({
        method: 'PUT',
        url: `/trips/${TRIP_ID}/booking-windows/${firstWindow.kind}/${firstWindow.dropOn}/done`,
        payload: { done: false },
      });
      expect(untoggleRes.statusCode).toBe(200);
      const untoggled: BookingWindowDTO = untoggleRes.json();
      expect(untoggled.done).toBe(false);
      expect(untoggled.doneAt).toBeNull();
      expect(untoggled.doneByDisplayName).toBeNull();
    });

    it('rejects unknown (kind, dropOn) with 400 trip_validation_failed and writes 0 rows', async () => {
      activeUserId = MEMBER_ID;
      const res = await app.inject({
        method: 'PUT',
        url: `/trips/${TRIP_ID}/booking-windows/dining/1999-01-01/done`,
        payload: { done: true },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('trip_validation_failed');

      // Verify no row was inserted
      const countRes = await pool.query(`SELECT count(*) as c FROM trip_booking_window_done WHERE trip_id = $1`, [TRIP_ID]);
      expect(Number(countRes.rows[0]?.c)).toBe(0);
    });

    it('rejects invalid payload ({ done: "yes" }) with 400 trip_validation_failed', async () => {
      activeUserId = MEMBER_ID;
      const res = await app.inject({
        method: 'PUT',
        url: `/trips/${TRIP_ID}/booking-windows/dining/2026-08-02/done`,
        payload: { done: 'yes' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('trip_validation_failed');
    });
  });

  describe('PUT /me/trips/:id/booking-reminders', () => {
    it('sets reminder mute idempotently, leaving one row', async () => {
      activeUserId = MEMBER_ID;

      const res1 = await app.inject({
        method: 'PUT',
        url: `/me/trips/${TRIP_ID}/booking-reminders`,
        payload: { muted: true },
      });
      expect(res1.statusCode).toBe(200);
      expect(res1.json()).toEqual({ tripId: TRIP_ID, muted: true });

      const res2 = await app.inject({
        method: 'PUT',
        url: `/me/trips/${TRIP_ID}/booking-reminders`,
        payload: { muted: true },
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json()).toEqual({ tripId: TRIP_ID, muted: true });

      // Stored row is exactly 1
      const countRes = await pool.query(
        `SELECT count(*) as c FROM trip_booking_reminder_mutes WHERE trip_id = $1 AND user_id = $2`,
        [TRIP_ID, MEMBER_ID],
      );
      expect(Number(countRes.rows[0]?.c)).toBe(1);

      // Unmute
      const resUnmute = await app.inject({
        method: 'PUT',
        url: `/me/trips/${TRIP_ID}/booking-reminders`,
        payload: { muted: false },
      });
      expect(resUnmute.statusCode).toBe(200);
      expect(resUnmute.json()).toEqual({ tripId: TRIP_ID, muted: false });

      const countAfter = await pool.query(
        `SELECT count(*) as c FROM trip_booking_reminder_mutes WHERE trip_id = $1 AND user_id = $2`,
        [TRIP_ID, MEMBER_ID],
      );
      expect(Number(countAfter.rows[0]?.c)).toBe(0);
    });

    it('rejects smuggled userId with 400 trip_validation_failed and creates no row', async () => {
      activeUserId = MEMBER_ID;
      const res = await app.inject({
        method: 'PUT',
        url: `/me/trips/${TRIP_ID}/booking-reminders`,
        payload: { muted: true, userId: ORGANIZER_ID },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('trip_validation_failed');

      // Neither user got a row
      const countRes = await pool.query(
        `SELECT count(*) as c FROM trip_booking_reminder_mutes WHERE trip_id = $1`,
        [TRIP_ID],
      );
      expect(Number(countRes.rows[0]?.c)).toBe(0);
    });
  });
});
