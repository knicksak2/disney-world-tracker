/**
 * Route-level check that the Interim_Organizer is authorized for an organizer-only action through the unchanged
 * `can(role, action)` matrix (account-deletion R7.1, R7.6). `PATCH /trips/:id/booking-settings` is the
 * organizer-only `edit_booking_settings` action; the route reads the caller's role with `assertTripMember`.
 *
 * Feature: account-deletion, Property 10: Effective role equals persisted role except for the interim organizer
 */
import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { createTripBookingRepo } from '../repo.js';
import { tripBookingRoutes } from '../routes.js';
import { setupTestDb } from './testDb.js';

const ORGANIZER_ID = '11111111-1111-1111-1111-111111111111';
const FIRST_MEMBER_ID = '22222222-2222-2222-2222-222222222222';
const SECOND_MEMBER_ID = '33333333-3333-3333-3333-333333333333';
const TRIP_ID = '44444444-4444-4444-4444-444444444444';

describe('tripBooking routes: interim organizer', () => {
  let pool: DbPool;
  let app: FastifyInstance;
  let activeUserId: string;

  beforeEach(async () => {
    activeUserId = FIRST_MEMBER_ID;
    pool = setupTestDb().pool as unknown as DbPool;

    for (const [uid, name] of [
      [ORGANIZER_ID, 'Org'],
      [FIRST_MEMBER_ID, 'First'],
      [SECOND_MEMBER_ID, 'Second'],
    ] as const) {
      await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash')`, [uid, `${name}@example.com`]);
      await pool.query(`INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)`, [uid, name]);
    }
    await pool.query(
      `INSERT INTO trips (id, name, start_date, end_date, creator_id) VALUES ($1, 'Fall', '2026-10-01', '2026-10-10', $2)`,
      [TRIP_ID, ORGANIZER_ID],
    );
    for (const [uid, role, minute] of [
      [ORGANIZER_ID, 'organizer', 0],
      [FIRST_MEMBER_ID, 'member', 1],
      [SECOND_MEMBER_ID, 'member', 2],
    ] as const) {
      await pool.query(
        `INSERT INTO trip_memberships (trip_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4)`,
        [TRIP_ID, uid, role, new Date(Date.UTC(2026, 0, 1, 0, minute))],
      );
    }

    app = Fastify();
    registerErrorHandler(app);
    const requireSession: preHandlerHookHandler = async (request) => {
      request.userId = activeUserId;
    };
    await app.register(tripBookingRoutes({ repo: createTripBookingRepo(pool), pool, requireSession }));
    await app.ready();
  });

  const patchSettings = (): Promise<{ statusCode: number; json: () => unknown }> =>
    app.inject({ method: 'PATCH', url: `/trips/${TRIP_ID}/booking-settings`, payload: { stayType: 'resort' } });

  async function setOrganizerState(state: 'active' | 'pending_deletion'): Promise<void> {
    if (state === 'active') {
      await pool.query(
        `UPDATE users SET deletion_state = 'active', deletion_requested_at = NULL, scheduled_purge_at = NULL, placeholder_id = NULL WHERE id = $1`,
        [ORGANIZER_ID],
      );
      return;
    }
    await pool.query(
      `UPDATE users SET deletion_state = 'pending_deletion', deletion_requested_at = $2, scheduled_purge_at = $3,
              placeholder_id = 'deadc0de-1111-4111-8111-111111111111' WHERE id = $1`,
      [ORGANIZER_ID, new Date('2026-05-01T00:00:00Z'), new Date('2026-05-31T00:00:00Z')],
    );
  }

  it('denies a plain member while the organizer is active', async () => {
    const res = await patchSettings();
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe('trip_forbidden');
  });

  it('allows the earliest-joined active member while the only organizer is pending deletion', async () => {
    await setOrganizerState('pending_deletion');
    const res = await patchSettings();
    expect(res.statusCode).toBe(200);
  });

  it('still denies the other member', async () => {
    await setOrganizerState('pending_deletion');
    activeUserId = SECOND_MEMBER_ID;
    const res = await patchSettings();
    expect(res.statusCode).toBe(403);
  });

  it('denies the interim organizer again once the organizer is restored', async () => {
    await setOrganizerState('pending_deletion');
    expect((await patchSettings()).statusCode).toBe(200);
    await setOrganizerState('active');
    expect((await patchSettings()).statusCode).toBe(403);
  });

  it('keeps the unauthenticated gate: no session means 401 before any role is read', async () => {
    const bare = Fastify();
    registerErrorHandler(bare);
    await bare.register(
      tripBookingRoutes({
        repo: createTripBookingRepo(pool),
        pool,
        requireSession: async () => {
          throw new AppError('unauthorized', 'Authentication is required.');
        },
      }),
    );
    const res = await bare.inject({ method: 'PATCH', url: `/trips/${TRIP_ID}/booking-settings`, payload: { stayType: 'resort' } });
    expect(res.statusCode).toBe(401);
  });
});
