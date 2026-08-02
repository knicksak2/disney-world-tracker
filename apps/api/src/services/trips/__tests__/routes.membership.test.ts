/**
 * Unit tests for the Trip membership-management routes (task 7.4):
 *
 *   GET    /trips/:id/members
 *   POST   /trips/:id/members/:userId/promote
 *   POST   /trips/:id/members/:userId/demote
 *   DELETE /trips/:id/members/:userId
 *   POST   /trips/:id/leave
 *
 * Validates: Requirements 4.5, 4.6, 4.8, 5.2, 5.3, 5.4, 8.1, 8.2, 8.3, 8.8,
 * 8.9
 *
 * These tests pin the route wiring — the authorization gate (Organizer for
 * promote/demote/remove, Member for list/leave), the success status codes, and
 * the propagation of the repo's mapped `AppError`s (`trip_last_organizer`,
 * `trip_role_invalid`, `trip_validation_failed`) through the shared error
 * handler. The repo's own transactional behaviour is covered by the membership
 * and departure property tests; here the repo is a controllable fake so each
 * route can be exercised in isolation.
 *
 * The `assertTripMember` / `assertTripOrganizer` gates issue a single
 * `SELECT role FROM trip_memberships ...`; the fake pool returns whatever role
 * the test wants for that lookup so the gate can be driven to allow or deny.
 */

import Fastify, {
  type FastifyInstance,
  type preHandlerHookHandler,
} from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TripMemberDTO, TripPendingInviteDTO } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import type { TripDeparture, TripRepo } from '../repo.js';
import { tripRoutes } from '../routes.js';

const CALLER_ID = '11111111-1111-1111-1111-111111111111';
const TRIP_ID = '22222222-2222-2222-2222-222222222222';
const TARGET_ID = '33333333-3333-3333-3333-333333333333';

/**
 * Build a `TripRepo` where every method throws unless the test overrides it.
 * Route tests override only the method the route under test invokes so an
 * unexpected call surfaces as a failure.
 */
function makeRepo(overrides: Partial<TripRepo>): TripRepo {
  const explode =
    (name: string) =>
    (): never => {
      throw new Error(`repo.${name} must not be called in this test`);
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
    promote: explode('promote'),
    demote: explode('demote'),
    removeMember: explode('removeMember'),
    leaveTrip: explode('leaveTrip'),
    listMembers: explode('listMembers'),
    listPendingInvites: explode('listPendingInvites'),
    addPlannedItem: explode('addPlannedItem'),
    removePlannedItem: explode('removePlannedItem'),
    listPlannedItems: explode('listPlannedItems'),
    ...overrides,
  } as unknown as TripRepo;
}

/**
 * A pool whose membership lookup returns the supplied `role` (or no row when
 * `null`), driving the `assertTripMember` / `assertTripOrganizer` gate.
 */
function makePool(role: 'organizer' | 'member' | null): DbPool {
  return {
    async query(): Promise<{ rows: unknown[]; rowCount: number }> {
      return role === null
        ? { rows: [], rowCount: 0 }
        : { rows: [{ role }], rowCount: 1 };
    },
  } as unknown as DbPool;
}

async function buildApp(
  role: 'organizer' | 'member' | null,
  repo: TripRepo,
): Promise<FastifyInstance> {
  const requireSession: preHandlerHookHandler = async (request) => {
    request.userId = CALLER_ID;
  };
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    tripRoutes({ repo, requireSession, pool: makePool(role) }),
  );
  await app.ready();
  return app;
}

let app: FastifyInstance | undefined;

beforeEach(() => {
  app = undefined;
});

describe('GET /trips/:id/members', () => {
  it('returns the member roster for a Member', async () => {
    const members: TripMemberDTO[] = [
      { userId: CALLER_ID, displayName: 'Ariel', avatarPreset: 'castle', role: 'organizer' },
      { userId: TARGET_ID, displayName: 'Eric', avatarPreset: null, role: 'member' },
    ];
    const listMembers = vi.fn().mockResolvedValue(members);
    app = await buildApp('member', makeRepo({ listMembers }));

    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/members` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(members);
    expect(listMembers).toHaveBeenCalledWith(TRIP_ID);
  });

  it('denies a non-member with trip_forbidden and never reads the roster', async () => {
    const listMembers = vi.fn();
    app = await buildApp(null, makeRepo({ listMembers }));

    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/members` });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'trip_forbidden' } });
    expect(listMembers).not.toHaveBeenCalled();
  });
});

describe('GET /trips/:id/invites', () => {
  it('returns the pending invites for an Organizer', async () => {
    const invites: TripPendingInviteDTO[] = [
      {
        inviteId: '44444444-4444-4444-4444-444444444444',
        inviteeId: TARGET_ID,
        inviteeDisplayName: 'Flounder',
        inviteeAvatarPreset: null,
      },
    ];
    const listPendingInvites = vi.fn().mockResolvedValue(invites);
    app = await buildApp('organizer', makeRepo({ listPendingInvites }));

    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/invites` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(invites);
    expect(listPendingInvites).toHaveBeenCalledWith(TRIP_ID);
  });

  it('denies a non-organizer Member with trip_forbidden and never reads invites', async () => {
    const listPendingInvites = vi.fn();
    app = await buildApp('member', makeRepo({ listPendingInvites }));

    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/invites` });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'trip_forbidden' } });
    expect(listPendingInvites).not.toHaveBeenCalled();
  });

  it('denies a non-member with trip_forbidden (non-disclosure)', async () => {
    const listPendingInvites = vi.fn();
    app = await buildApp(null, makeRepo({ listPendingInvites }));

    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/invites` });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'trip_forbidden' } });
    expect(listPendingInvites).not.toHaveBeenCalled();
  });
});

describe('POST /trips/:id/members/:userId/promote', () => {
  it('promotes for an Organizer and returns 204', async () => {
    const promote = vi.fn().mockResolvedValue(undefined);
    app = await buildApp('organizer', makeRepo({ promote }));

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/members/${TARGET_ID}/promote`,
    });

    expect(res.statusCode).toBe(204);
    expect(promote).toHaveBeenCalledWith(TRIP_ID, TARGET_ID);
  });

  it('denies a non-organizer Member and never promotes', async () => {
    const promote = vi.fn();
    app = await buildApp('member', makeRepo({ promote }));

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/members/${TARGET_ID}/promote`,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'trip_forbidden' } });
    expect(promote).not.toHaveBeenCalled();
  });

  it('maps a no-op role change to trip_role_invalid (400)', async () => {
    const promote = vi
      .fn()
      .mockRejectedValue(new AppError('trip_role_invalid', 'Already an organizer.'));
    app = await buildApp('organizer', makeRepo({ promote }));

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/members/${TARGET_ID}/promote`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'trip_role_invalid' } });
  });
});

describe('POST /trips/:id/members/:userId/demote', () => {
  it('demotes for an Organizer and returns 204', async () => {
    const demote = vi.fn().mockResolvedValue(undefined);
    app = await buildApp('organizer', makeRepo({ demote }));

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/members/${TARGET_ID}/demote`,
    });

    expect(res.statusCode).toBe(204);
    expect(demote).toHaveBeenCalledWith(TRIP_ID, TARGET_ID);
  });

  it('maps a Last_Organizer_Rule violation to trip_last_organizer (409)', async () => {
    const demote = vi
      .fn()
      .mockRejectedValue(
        new AppError('trip_last_organizer', 'A trip must always have at least one organizer.'),
      );
    app = await buildApp('organizer', makeRepo({ demote }));

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/members/${TARGET_ID}/demote`,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'trip_last_organizer' } });
  });
});

describe('DELETE /trips/:id/members/:userId', () => {
  it('removes a Member for an Organizer and returns 204', async () => {
    const removeMember = vi.fn().mockResolvedValue({ tripDeleted: false } as TripDeparture);
    app = await buildApp('organizer', makeRepo({ removeMember }));

    const res = await app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/members/${TARGET_ID}`,
    });

    expect(res.statusCode).toBe(204);
    expect(removeMember).toHaveBeenCalledWith(TRIP_ID, TARGET_ID);
  });

  it('maps a non-member target to trip_validation_failed (400)', async () => {
    const removeMember = vi
      .fn()
      .mockRejectedValue(
        new AppError('trip_validation_failed', 'That User is not a member of this trip.'),
      );
    app = await buildApp('organizer', makeRepo({ removeMember }));

    const res = await app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/members/${TARGET_ID}`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'trip_validation_failed' } });
  });
});

describe('POST /trips/:id/leave', () => {
  it('lets any Member leave and returns the departure outcome', async () => {
    const leaveTrip = vi.fn().mockResolvedValue({ tripDeleted: true } as TripDeparture);
    app = await buildApp('member', makeRepo({ leaveTrip }));

    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/leave` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tripDeleted: true });
    expect(leaveTrip).toHaveBeenCalledWith(TRIP_ID, CALLER_ID);
  });

  it('denies a non-member with trip_forbidden and never leaves', async () => {
    const leaveTrip = vi.fn();
    app = await buildApp(null, makeRepo({ leaveTrip }));

    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/leave` });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'trip_forbidden' } });
    expect(leaveTrip).not.toHaveBeenCalled();
  });

  it('maps a Last_Organizer_Rule violation to trip_last_organizer (409)', async () => {
    const leaveTrip = vi
      .fn()
      .mockRejectedValue(
        new AppError('trip_last_organizer', 'A trip must always have at least one organizer.'),
      );
    app = await buildApp('organizer', makeRepo({ leaveTrip }));

    const res = await app.inject({ method: 'POST', url: `/trips/${TRIP_ID}/leave` });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'trip_last_organizer' } });
  });
});
