/**
 * Route tests for the Reservation booking facet on the existing Planned_Item
 * endpoints. The trip-reservations feature adds NO new endpoint: a Reservation
 * is written through `POST/PATCH/DELETE /trips/:id/planned-items` and read
 * through `GET /trips/:id/planned-items`, so it inherits the membership gate,
 * the adder-or-organizer removal rule, and the shared DTO.
 *
 * Covers the membership gate (including that an unknown Trip id collapses to the
 * same `trip_forbidden`, so Trip existence cannot be probed), the happy path
 * carrying the three new DTO fields, validation failures, that the route passes
 * the reservation fields through to the repo untouched, and that no
 * confirmation number or party size leaks into the non-Reservation payloads.
 *
 * Validates: trip-reservations Requirements 3.1, 3.4, 3.5, 3.6, 6.1, 6.2, 6.3
 * (Correctness Property 7)
 */

import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  PlannedItemAddInput,
  PlannedItemDTO,
  PlannedItemEditInput,
  TripFeedItemDTO,
  TripSummaryDTO,
} from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import type { TripRepo } from '../repo.js';
import { tripRoutes } from '../routes.js';

const CALLER_ID = '11111111-1111-1111-1111-111111111111';
const TRIP_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '33333333-3333-3333-3333-333333333333';
const EXP_ID = '44444444-4444-4444-4444-444444444444';

const BOOKED_AT = '2026-10-01T22:00:00.000Z';

/** A full `PlannedItemDTO`, overriding only what a case cares about. */
function pi(overrides: Partial<PlannedItemDTO> = {}): PlannedItemDTO {
  return {
    id: ITEM_ID,
    experienceId: EXP_ID,
    experienceName: 'Be Our Guest',
    park: 'Magic Kingdom',
    customTitle: null,
    addedByDisplayName: 'Tester',
    plannedDate: '2026-10-01',
    plannedTime: BOOKED_AT,
    isFixed: true,
    isLightningLane: false,
    useSingleRider: false,
    priority: 2,
    itemType: 'experience',
    durationMinutes: 60,
    windowStartMinutes: null,
    windowEndMinutes: null,
    mealPeriod: null,
    scheduledShowtime: null,
    predictedWaitMinutes: null,
    travelFromPrev: null,
    optimizedAt: null,
    reservationKind: 'dining',
    confirmationNumber: 'ABC123456',
    partySize: 4,
    ...overrides,
  };
}

/**
 * A `TripRepo` where only the named methods exist; anything else the route
 * touches throws loudly rather than silently returning `undefined`.
 */
function makeRepo(overrides: Partial<TripRepo>): TripRepo {
  return new Proxy({} as TripRepo, {
    get(_target, prop: string) {
      if (prop in overrides) {
        return (overrides as Record<string, unknown>)[prop];
      }
      return () => {
        throw new Error(`repo.${prop} must not be called in this test`);
      };
    },
  });
}

interface Harness {
  app: FastifyInstance;
  /** Set to null to make the caller a non-member (or the Trip unknown). */
  setRole: (role: string | null) => void;
}

async function buildApp(overrides: Partial<TripRepo>): Promise<Harness> {
  let role: string | null = 'member';

  const fakePool = {
    query: vi.fn(async (text: string) => {
      if (text.includes('FROM trip_memberships')) {
        if (role === null) return { rows: [], rowCount: 0 };
        return { rows: [{ role }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as DbPool;

  const dummyRequireSession: preHandlerHookHandler = async (request) => {
    (request as unknown as { userId: string }).userId = CALLER_ID;
  };

  const app = Fastify();
  registerErrorHandler(app);
  await app.register(
    tripRoutes({ pool: fakePool, repo: makeRepo(overrides), requireSession: dummyRequireSession }),
  );

  return {
    app,
    setRole: (next) => {
      role = next;
    },
  };
}

// ---------------------------------------------------------------------------
// Membership gate (R6.1, Property 7)
// ---------------------------------------------------------------------------

describe('Reservation routes are member-gated (Property 7)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await buildApp({
      addPlannedItem: async () => pi(),
      listPlannedItems: async () => [pi()],
      editPlannedItem: async () => pi(),
      removePlannedItem: async () => true,
    });
  });

  it('rejects a non-member creating a reservation with trip_forbidden', async () => {
    h.setRole(null);
    const res = await h.app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/planned-items`,
      payload: {
        experienceId: EXP_ID,
        plannedDate: '2026-10-01',
        plannedTime: BOOKED_AT,
        reservationKind: 'dining',
        confirmationNumber: 'ABC123456',
        partySize: 4,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('trip_forbidden');
  });

  it('rejects a non-member reading reservations with trip_forbidden', async () => {
    h.setRole(null);
    const res = await h.app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/planned-items`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('trip_forbidden');
    expect(res.payload).not.toContain('ABC123456');
  });

  it('rejects a non-member editing a reservation with trip_forbidden', async () => {
    h.setRole(null);
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/trips/${TRIP_ID}/planned-items/${ITEM_ID}`,
      payload: { partySize: 6 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('trip_forbidden');
  });

  it('gives an unknown Trip id the SAME trip_forbidden, so existence cannot be probed', async () => {
    // The fake pool returns no membership row for any Trip when role is null,
    // which is exactly the state for both "not a member" and "no such Trip".
    h.setRole(null);
    const unknownTrip = '99999999-9999-4999-8999-999999999999';
    const res = await h.app.inject({
      method: 'GET',
      url: `/trips/${unknownTrip}/planned-items`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('trip_forbidden');
  });

  it('lets a member read a reservation with its booking details', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/planned-items`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as PlannedItemDTO[];
    expect(body).toHaveLength(1);
    expect(body[0]!.reservationKind).toBe('dining');
    expect(body[0]!.confirmationNumber).toBe('ABC123456');
    expect(body[0]!.partySize).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Create (R3.1) and pass-through
// ---------------------------------------------------------------------------

describe('POST /trips/:id/planned-items creates a Reservation (R3.1)', () => {
  it('returns 201 with the booking facet on the created item', async () => {
    const h = await buildApp({ addPlannedItem: async () => pi() });

    const res = await h.app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/planned-items`,
      payload: {
        experienceId: EXP_ID,
        plannedDate: '2026-10-01',
        plannedTime: BOOKED_AT,
        reservationKind: 'dining',
        confirmationNumber: 'ABC123456',
        partySize: 4,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as PlannedItemDTO;
    expect(body.reservationKind).toBe('dining');
    expect(body.confirmationNumber).toBe('ABC123456');
    expect(body.partySize).toBe(4);
  });

  it('passes the reservation fields through to the repo untouched', async () => {
    let captured: PlannedItemAddInput | null = null;
    const h = await buildApp({
      addPlannedItem: async (_tripId, _adderId, input) => {
        captured = input;
        return pi();
      },
    });

    await h.app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/planned-items`,
      payload: {
        experienceId: EXP_ID,
        plannedDate: '2026-10-01',
        plannedTime: BOOKED_AT,
        reservationKind: 'lightning_lane',
        confirmationNumber: 'LL-99',
        partySize: 2,
      },
    });

    expect(captured).not.toBeNull();
    expect(captured!.reservationKind).toBe('lightning_lane');
    expect(captured!.confirmationNumber).toBe('LL-99');
    expect(captured!.partySize).toBe(2);
    expect(captured!.plannedTime).toBe(BOOKED_AT);
  });

  it('accepts a non-catalog reservation carried as a break with a custom title (R5.1)', async () => {
    let captured: PlannedItemAddInput | null = null;
    const h = await buildApp({
      addPlannedItem: async (_tripId, _adderId, input) => {
        captured = input;
        return pi({
          experienceId: null,
          experienceName: null,
          park: null,
          itemType: 'break',
          customTitle: 'Off-property steakhouse',
        });
      },
    });

    const res = await h.app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/planned-items`,
      payload: {
        experienceId: null,
        itemType: 'break',
        customTitle: 'Off-property steakhouse',
        plannedDate: '2026-10-03',
        plannedTime: '2026-10-03T23:00:00.000Z',
        reservationKind: 'dining',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(captured!.customTitle).toBe('Off-property steakhouse');
    expect(captured!.itemType).toBe('break');
    expect((res.json() as PlannedItemDTO).itemType).toBe('break');
  });
});

// ---------------------------------------------------------------------------
// Validation (R3.6)
// ---------------------------------------------------------------------------

describe('Reservation validation failures are rejected before the repo (R3.6)', () => {
  const cases: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['a party size below the minimum', { partySize: 0 }],
    ['a party size above the maximum', { partySize: 51 }],
    ['an over-long confirmation number', { confirmationNumber: 'C'.repeat(41) }],
    ['a kind outside the vocabulary', { reservationKind: 'adr' }],
  ];

  it.each(cases)('rejects %s with trip_validation_failed', async (_label, patch) => {
    const h = await buildApp({
      addPlannedItem: async () => {
        throw new Error('repo.addPlannedItem must not be reached for an invalid body');
      },
    });

    const res = await h.app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/planned-items`,
      payload: {
        experienceId: EXP_ID,
        plannedDate: '2026-10-01',
        plannedTime: BOOKED_AT,
        reservationKind: 'dining',
        ...patch,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('trip_validation_failed');
  });

  it('rejects a reservation with no plannedTime (R1.5)', async () => {
    const h = await buildApp({
      addPlannedItem: async () => {
        throw new Error('repo.addPlannedItem must not be reached for an invalid body');
      },
    });

    const res = await h.app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/planned-items`,
      payload: {
        experienceId: EXP_ID,
        plannedDate: '2026-10-01',
        reservationKind: 'dining',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('trip_validation_failed');
  });

  it('surfaces the repo anchored-invariant rejection as a 400 (R1.6)', async () => {
    const h = await buildApp({
      editPlannedItem: async () => {
        throw new AppError('trip_validation_failed', 'A reservation requires a planned date.', {
          field: 'plannedDate',
        });
      },
    });

    const res = await h.app.inject({
      method: 'PATCH',
      url: `/trips/${TRIP_ID}/planned-items/${ITEM_ID}`,
      payload: { plannedDate: null },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('trip_validation_failed');
  });
});

// ---------------------------------------------------------------------------
// Edit and remove (R3.4, R3.5, R6.3)
// ---------------------------------------------------------------------------

describe('Editing and removing a Reservation reuses the Planned_Item rules', () => {
  it('PATCHes only the changed booking fields', async () => {
    let captured: PlannedItemEditInput | null = null;
    const h = await buildApp({
      editPlannedItem: async (_tripId, _itemId, input) => {
        captured = input;
        return pi({ partySize: 6, confirmationNumber: 'ZZZ999' });
      },
    });

    const res = await h.app.inject({
      method: 'PATCH',
      url: `/trips/${TRIP_ID}/planned-items/${ITEM_ID}`,
      payload: { partySize: 6, confirmationNumber: 'ZZZ999' },
    });

    expect(res.statusCode).toBe(200);
    expect(captured!.partySize).toBe(6);
    expect(captured!.confirmationNumber).toBe('ZZZ999');
    // Untouched fields are absent from the patch rather than sent as null.
    expect('plannedTime' in captured!).toBe(false);
    expect('reservationKind' in captured!).toBe(false);
    expect((res.json() as PlannedItemDTO).partySize).toBe(6);
  });

  it('DELETEs a reservation through the planned-item route', async () => {
    let removedItemId: string | null = null;
    const h = await buildApp({
      removePlannedItem: async (_tripId, itemId) => {
        removedItemId = itemId;
        return true;
      },
    });

    const res = await h.app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/planned-items/${ITEM_ID}`,
    });

    expect(res.statusCode).toBe(204);
    expect(removedItemId).toBe(ITEM_ID);
  });

  it('rejects a non-adding member removing a reservation with trip_forbidden (R6.3)', async () => {
    const h = await buildApp({
      removePlannedItem: async () => {
        throw new AppError('trip_forbidden', 'You can only remove planned items you added.');
      },
    });

    const res = await h.app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/planned-items/${ITEM_ID}`,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('trip_forbidden');
  });
});

// ---------------------------------------------------------------------------
// R6.2: booking details never leak into non-Reservation payloads
// ---------------------------------------------------------------------------

describe('Booking details do not leak into other Trip payloads (R6.2)', () => {
  it('omits confirmationNumber and partySize from the Trip feed and summary', async () => {
    const feed: TripFeedItemDTO[] = [
      {
        id: '66666666-6666-4666-8666-666666666666',
        type: 'completion_logged',
        actorDisplayName: 'Tester',
        actorAvatarPreset: null,
        createdAt: '2026-10-01T12:00:00.000Z',
        metadata: { experienceId: EXP_ID },
        reactions: [],
        comments: [],
      } as unknown as TripFeedItemDTO,
    ];
    const summary = {
      tripId: TRIP_ID,
      completionCount: 1,
      memberCount: 2,
      topRated: [],
      plannedCount: 1,
      plannedDoneCount: 0,
    } as unknown as TripSummaryDTO;

    const h = await buildApp({
      getFeed: async () => feed,
      getSummary: async () => summary,
    });

    const feedRes = await h.app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/feed` });
    expect(feedRes.statusCode).toBe(200);
    expect(feedRes.payload).not.toContain('confirmationNumber');
    expect(feedRes.payload).not.toContain('partySize');
    expect(feedRes.payload).not.toContain('ABC123456');

    const summaryRes = await h.app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/summary` });
    expect(summaryRes.statusCode).toBe(200);
    expect(summaryRes.payload).not.toContain('confirmationNumber');
    expect(summaryRes.payload).not.toContain('partySize');
    expect(summaryRes.payload).not.toContain('ABC123456');
  });

  it('does not expose the reservation fields on any other Trip route in this suite', async () => {
    // The feed/summary repos above are the only Trip reads besides the
    // membership-gated planned-items list; a future payload that joined
    // planned_items would have to opt in explicitly.
    const h = await buildApp({ getSummary: async () => ({}) as unknown as TripSummaryDTO });
    const res = await h.app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/summary` });
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toMatch(/reservationKind|confirmationNumber|partySize/u);
  });
});

// ---------------------------------------------------------------------------
// No new endpoint (design decision 5)
// ---------------------------------------------------------------------------

describe('The feature adds no /reservations endpoint', () => {
  it('404s a dedicated reservations route: reservations are read from planned-items', async () => {
    const h = await buildApp({ listPlannedItems: async () => [pi()] });
    const res = await h.app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/reservations` });
    expect(res.statusCode).toBe(404);
  });
});
