/**
 * Integration / route tests for schedule optimization and planned-item editing (task 4.4):
 *
 *   POST  /trips/:id/schedule/optimize
 *   PATCH /trips/:id/planned-items/:itemId
 *
 * Validates: Requirements 3.1, 3.3, 3.10
 */

import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlannedItemDTO, TripOptimizationResult } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import type { PredictionService } from '../../intelligence/predictionService.js';
import type { TripRepo } from '../repo.js';
import { tripRoutes } from '../routes.js';
import { wdwToday, wdwMinutesFromMidnight } from '../wdwClock.js';

const CALLER_ID = '11111111-1111-1111-1111-111111111111';
const TRIP_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '33333333-3333-3333-3333-333333333333';
const EXP_ID = '44444444-4444-4444-4444-444444444444';

/** Build a full `PlannedItemDTO` for the fake repo, overriding only what matters. */
function pi(overrides: Partial<PlannedItemDTO> = {}): PlannedItemDTO {
  return {
    id: ITEM_ID,
    experienceId: EXP_ID,
    experienceName: 'Space Mountain',
    park: 'Magic Kingdom',
    customTitle: null,
    addedByDisplayName: 'Tester',
    plannedDate: '2026-10-01',
    plannedTime: null,
    isFixed: false,
    isLightningLane: false,
    useSingleRider: false,
    priority: 2,
    itemType: 'experience',
    durationMinutes: 15,
    catalogDurationMinutes: null,
    windowStartMinutes: null,
    windowEndMinutes: null,
    mealPeriod: null,
    scheduledShowtime: null,
    predictedWaitMinutes: null,
    travelFromPrev: null,
    optimizedAt: null,
    // Not a Reservation by default; a case that needs one overrides these.
    reservationKind: null,
    confirmationNumber: null,
    partySize: null,
    ...overrides,
  };
}

function makeRepo(overrides: Partial<TripRepo>): TripRepo {
  const explode = (name: string) => (): never => {
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
    listMyInvites: explode('listMyInvites'),
    listPendingInvites: explode('listPendingInvites'),
    promote: explode('promote'),
    demote: explode('demote'),
    removeMember: explode('removeMember'),
    leaveTrip: explode('leaveTrip'),
    listMembers: explode('listMembers'),
    addPlannedItem: explode('addPlannedItem'),
    editPlannedItem: explode('editPlannedItem'),
    updatePlannedItemTimes: explode('updatePlannedItemTimes'),
    removePlannedItem: explode('removePlannedItem'),
    listPlannedItems: explode('listPlannedItems'),
    logCompletion: explode('logCompletion'),
    listLogEntries: explode('listLogEntries'),
    confirmRodeWithTag: explode('confirmRodeWithTag'),
    declineRodeWithTag: explode('declineRodeWithTag'),
    getRodeWithTag: explode('getRodeWithTag'),
    listPendingRodeWithTags: explode('listPendingRodeWithTags'),
    addReaction: explode('addReaction'),
    removeReaction: explode('removeReaction'),
    addComment: explode('addComment'),
    getFeed: explode('getFeed'),
    getSummary: explode('getSummary'),
    listMyTrips: explode('listMyTrips'),
    ...overrides,
  } as unknown as TripRepo;
}

describe('Schedule optimization & planned item edit routes', () => {
  let app: FastifyInstance;
  let mockRole: string | null;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T14:00:00.000Z')); // 10:00 AM ET (EDT, UTC-4)
    mockRole = 'member';
    const fakePool = {
      query: vi.fn(async (text: string) => {
        if (text.includes('FROM trip_memberships')) {
          if (mockRole === null) return { rows: [], rowCount: 0 };
          return { rows: [{ role: mockRole }], rowCount: 1 };
        }
        if (text.includes('FROM trips WHERE id = $1')) {
          return { rows: [{ walking_speed: 'moderate', early_entry_eligible: false }], rowCount: 1 };
        }
        if (text.includes('FROM experiences WHERE id = ANY')) {
          return { rows: [{ id: EXP_ID, latitude: 28.4177, longitude: -81.5812 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as DbPool;

    const dummyRequireSession: preHandlerHookHandler = async (request) => {
      (request as unknown as { userId: string }).userId = CALLER_ID;
    };

    app = Fastify();
    registerErrorHandler(app);

    const repo = makeRepo({
      listPlannedItems: async () => [pi()],
      updatePlannedItemTimes: async () => {},
      editPlannedItem: async (_t, _i, input) =>
        pi({
          plannedDate: input.plannedDate ?? '2026-10-01',
          plannedTime: input.plannedTime ?? null,
          isFixed: input.isFixed ?? false,
          isLightningLane: input.isLightningLane ?? false,
          useSingleRider: input.useSingleRider ?? false,
          priority: input.priority ?? 2,
          itemType: input.itemType ?? 'experience',
          durationMinutes: input.durationMinutes ?? 15,
        }),
    });

    await app.register(
      tripRoutes({
        pool: fakePool,
        repo,
        requireSession: dummyRequireSession,
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('POST /trips/:id/schedule/optimize', () => {
    it('rejects non-members with trip_forbidden', async () => {
      mockRole = null;
      const res = await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/schedule/optimize`,
        payload: { date: '2026-10-01' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('trip_forbidden');
    });

    it('optimizes schedule and returns result for trip members', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/schedule/optimize`,
        payload: { date: '2026-10-01' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as TripOptimizationResult;
      expect(body.items).toHaveLength(1);
      expect(body.items[0]!.plannedItemId).toBe(ITEM_ID);
    });

    it('persists the derived predicted wait and travel leg for each optimized item (R8.1)', async () => {
      const poolForCapture = {
        query: vi.fn(async (text: string) => {
          if (text.includes('FROM trip_memberships')) {
            return { rows: [{ role: 'member' }], rowCount: 1 };
          }
          if (text.includes('FROM trips WHERE id = $1')) {
            return { rows: [{ walking_speed: 'moderate', early_entry_eligible: false }], rowCount: 1 };
          }
          if (text.includes('FROM experiences WHERE id = ANY')) {
            return { rows: [{ id: EXP_ID, latitude: 28.4177, longitude: -81.5812 }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }),
      } as unknown as DbPool;

      const dummyRequireSession: preHandlerHookHandler = async (request) => {
        (request as unknown as { userId: string }).userId = CALLER_ID;
      };

      let captured: Array<{
        itemId: string;
        plannedTime: string;
        predictedWaitMinutes?: number | null;
        travelFromPrev?: { kind: 'walk' | 'park_hop'; minutes: number } | null;
      }> = [];
      const captureApp = Fastify();
      registerErrorHandler(captureApp);
      const repo = makeRepo({
        listPlannedItems: async () => [pi()],
        updatePlannedItemTimes: async (_id, times) => {
          captured = times as typeof captured;
        },
      });
      await captureApp.register(
        tripRoutes({ pool: poolForCapture, repo, requireSession: dummyRequireSession })
      );

      const res = await captureApp.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/schedule/optimize`,
        payload: { date: '2026-10-01' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as TripOptimizationResult;
      // The persistence payload carries the same derived result the optimizer
      // returned, so a returning member reads back real waits (R8.1/R8.2).
      expect(captured).toHaveLength(1);
      expect(captured[0]!.itemId).toBe(ITEM_ID);
      expect(captured[0]!.predictedWaitMinutes).toBe(body.items[0]!.predictedWaitMinutes);
      expect(typeof captured[0]!.predictedWaitMinutes).toBe('number');
      // First (only) item has no prior leg.
      expect(captured[0]!.travelFromPrev ?? null).toEqual(body.items[0]!.travelFromPrev);
    });

    it('persists scheduled_showtime for show experiences on optimize run (R8.1)', async () => {
      const showExpId = 'exp-show-1';
      const showItemId = 'item-show-1';
      const poolForCapture = {
        query: vi.fn(async (text: string) => {
          if (text.includes('FROM trip_memberships')) {
            return { rows: [{ role: 'member' }], rowCount: 1 };
          }
          if (text.includes('FROM trips WHERE id = $1')) {
            return { rows: [{ walking_speed: 'moderate', early_entry_eligible: false, day_touring_hours: {} }], rowCount: 1 };
          }
          if (text.includes('FROM experiences WHERE id = ANY')) {
            return {
              rows: [{ id: showExpId, latitude: 28.4177, longitude: -81.5812, category: 'Show' }],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        }),
      } as unknown as DbPool;

      const dummyRequireSession: preHandlerHookHandler = async (request) => {
        (request as unknown as { userId: string }).userId = CALLER_ID;
      };

      let captured: Array<{
        itemId: string;
        plannedTime: string;
        predictedWaitMinutes?: number | null;
        travelFromPrev?: { kind: 'walk' | 'park_hop'; minutes: number } | null;
        scheduledShowtime?: string | null;
      }> = [];

      const captureApp = Fastify();
      registerErrorHandler(captureApp);
      const repo = makeRepo({
        listPlannedItems: async () => [
          pi({
            id: showItemId,
            experienceId: showExpId,
            plannedDate: '2026-10-01',
          }),
        ],
        updatePlannedItemTimes: async (_id, times) => {
          captured = times as typeof captured;
        },
      });

      const predictionServiceWithShow = {
        getDaySnapshot: vi.fn(async () => ({
          [showExpId]: {
            experienceId: showExpId,
            isVirtualQueue: false,
            showtimes: ['2026-10-01T18:00:00.000Z'], // 2:00 PM EDT
            waits: Array.from({ length: 14 }, (_, i) => ({
              hour: i + 8,
              predictedWaitMinutes: 0,
            })),
          },
        })),
        crowdMultiplier: vi.fn(async () => 1.0),
      } as unknown as PredictionService;

      await captureApp.register(
        tripRoutes({
          pool: poolForCapture,
          repo,
          requireSession: dummyRequireSession,
          predictionService: predictionServiceWithShow,
        })
      );

      const res = await captureApp.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/schedule/optimize`,
        payload: { date: '2026-10-01' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as TripOptimizationResult;
      expect(captured).toHaveLength(1);
      expect(captured[0]!.itemId).toBe(showItemId);
      // 2:00 PM ET on 2026-10-01 is 18:00:00.000Z (UTC-4) -> 14:00 ET = 18:00 UTC
      expect(captured[0]!.scheduledShowtime).toBe('2026-10-01T18:00:00.000Z');
      expect(body.items[0]!.scheduledShowtime).toBe('2026-10-01T18:00:00.000Z');
    });

    it('does not schedule a non-early-entry ride before official open (R3.12)', async () => {
      // Early-entry-eligible day, default start 9:00 → early-entry open 8:30,
      // official open 9:00. A ride flagged not-early-entry must land at 9:00.
      const poolNonEE = {
        query: vi.fn(async (text: string) => {
          if (text.includes('FROM trip_memberships')) {
            return { rows: [{ role: 'member' }], rowCount: 1 };
          }
          if (text.includes('FROM trips WHERE id = $1')) {
            return { rows: [{ walking_speed: 'moderate', early_entry_eligible: true, day_touring_hours: {} }], rowCount: 1 };
          }
          if (text.includes('FROM experiences WHERE id = ANY')) {
            return {
              rows: [{ id: EXP_ID, latitude: 28.4177, longitude: -81.5812, operates_during_early_entry: false }],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        }),
      } as unknown as DbPool;

      const dummyRequireSession: preHandlerHookHandler = async (request) => {
        (request as unknown as { userId: string }).userId = CALLER_ID;
      };

      const eeApp = Fastify();
      registerErrorHandler(eeApp);
      const repo = makeRepo({
        listPlannedItems: async () => [pi()],
        updatePlannedItemTimes: async () => {},
      });
      await eeApp.register(
        tripRoutes({ pool: poolNonEE, repo, requireSession: dummyRequireSession })
      );

      const res = await eeApp.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/schedule/optimize`,
        payload: { date: '2026-10-01' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as TripOptimizationResult;
      expect(body.items).toHaveLength(1);
      // 9:00 AM ET on 2026-10-01 (EDT, UTC-4) is 13:00:00Z — official open, not 8:30.
      expect(body.items[0]!.suggestedArrival).toContain('T13:00:00');
    });

    it('extracts per-date day_touring_hours overrides from trip record', async () => {
      let queriedDayHours = false;
      const poolWithDayHours = {
        query: vi.fn(async (text: string) => {
          if (text.includes('FROM trip_memberships')) {
            return { rows: [{ role: 'member' }], rowCount: 1 };
          }
          if (text.includes('FROM trips WHERE id = $1')) {
            queriedDayHours = true;
            return {
              rows: [
                {
                  walking_speed: 'fast',
                  early_entry_eligible: true,
                  day_touring_hours: {
                    '2026-10-01': {
                      startHour: 8,
                      endHour: 23,
                      useEarlyEntry: true,
                      useExtendedEvening: true,
                      hasAfterHoursTicket: true,
                    },
                  },
                },
              ],
              rowCount: 1,
            };
          }
          if (text.includes('FROM experiences WHERE id = ANY')) {
            return { rows: [{ id: EXP_ID, latitude: 28.4177, longitude: -81.5812 }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }),
      } as unknown as DbPool;

      const dummyRequireSession: preHandlerHookHandler = async (request) => {
        (request as unknown as { userId: string }).userId = CALLER_ID;
      };

      const customApp = Fastify();
      registerErrorHandler(customApp);

      const repo = makeRepo({
        listPlannedItems: async () => [pi()],
        updatePlannedItemTimes: async () => {},
      });

      await customApp.register(
        tripRoutes({
          pool: poolWithDayHours,
          repo,
          requireSession: dummyRequireSession,
        })
      );

      const res = await customApp.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/schedule/optimize`,
        payload: { date: '2026-10-01' },
      });

      expect(res.statusCode).toBe(200);
      expect(queriedDayHours).toBe(true);
    });

    it('drives 4 PM mix-in start through optimize route when day_touring_hours hasAfterHoursTicket is set', async () => {
      const poolWithAfterHours = {
        query: vi.fn(async (text: string) => {
          if (text.includes('FROM trip_memberships')) {
            return { rows: [{ role: 'member' }], rowCount: 1 };
          }
          if (text.includes('FROM trips WHERE id = $1')) {
            return {
              rows: [
                {
                  walking_speed: 'moderate',
                  early_entry_eligible: false,
                  day_touring_hours: {
                    '2026-10-01': {
                      hasAfterHoursTicket: true,
                    },
                  },
                },
              ],
              rowCount: 1,
            };
          }
          if (text.includes('FROM experiences WHERE id = ANY')) {
            return { rows: [{ id: EXP_ID, latitude: 28.4177, longitude: -81.5812 }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }),
      } as unknown as DbPool;

      const dummyRequireSession: preHandlerHookHandler = async (request) => {
        (request as unknown as { userId: string }).userId = CALLER_ID;
      };

      let updatedTimes: Array<{ itemId: string; plannedTime: string }> = [];
      const customApp = Fastify();
      registerErrorHandler(customApp);

      const repo = makeRepo({
        listPlannedItems: async () => [pi()],
        updatePlannedItemTimes: async (_id, times) => {
          updatedTimes = times;
        },
      });

      await customApp.register(
        tripRoutes({
          pool: poolWithAfterHours,
          repo,
          requireSession: dummyRequireSession,
        })
      );

      const res = await customApp.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/schedule/optimize`,
        payload: { date: '2026-10-01' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as TripOptimizationResult;
      expect(body.items).toHaveLength(1);
      // 4 PM ET (16:00) on 2026-10-01 is 20:00:00Z
      expect(body.items[0]!.suggestedArrival).toContain('T20:00:00');
      expect(updatedTimes[0]!.plannedTime).toContain('T20:00:00');
    });

    it('schedules from custom startMinutes and startMode through optimize route', async () => {
      const poolCustom = {
        query: vi.fn(async (text: string) => {
          if (text.includes('FROM trip_memberships')) {
            return { rows: [{ role: 'member' }], rowCount: 1 };
          }
          if (text.includes('FROM trips WHERE id = $1')) {
            return {
              rows: [
                {
                  walking_speed: 'moderate',
                  early_entry_eligible: false,
                  day_touring_hours: null,
                },
              ],
              rowCount: 1,
            };
          }
          if (text.includes('FROM experiences WHERE id = ANY')) {
            return { rows: [{ id: EXP_ID, latitude: 28.4177, longitude: -81.5812 }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }),
      } as unknown as DbPool;

      const dummyRequireSession: preHandlerHookHandler = async (request) => {
        (request as unknown as { userId: string }).userId = CALLER_ID;
      };

      let updatedTimes: Array<{ itemId: string; plannedTime: string }> = [];
      const customApp = Fastify();
      registerErrorHandler(customApp);

      const repo = makeRepo({
        listPlannedItems: async () => [pi()],
        updatePlannedItemTimes: async (_id, times) => {
          updatedTimes = times;
        },
      });

      await customApp.register(
        tripRoutes({
          pool: poolCustom,
          repo,
          requireSession: dummyRequireSession,
        })
      );

      // Request with startMode: 'custom', startMinutes: 810 (1:30 PM ET = 17:30 UTC on 2026-10-01)
      const res = await customApp.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/schedule/optimize`,
        payload: { date: '2026-10-01', startMode: 'custom', startMinutes: 810 },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as TripOptimizationResult;
      expect(body.items).toHaveLength(1);
      // 1:30 PM ET (13:30) on 2026-10-01 is 17:30:00Z
      expect(body.items[0]!.suggestedArrival).toContain('T17:30:00');
      expect(updatedTimes[0]!.plannedTime).toContain('T17:30:00');
    });

    it('strictly scopes optimization to requested date and leaves other dates and unassigned items untouched (R3.1)', async () => {
      const itemDay1 = pi({ id: 'item-day-1', plannedDate: '2026-10-01', plannedTime: null });
      const itemDay2 = pi({ id: 'item-day-2', plannedDate: '2026-10-02', plannedTime: '2026-10-02T14:00:00.000Z' });
      const itemUnassigned = pi({ id: 'item-unassigned', plannedDate: null, plannedTime: null });

      const poolScope = {
        query: vi.fn(async (text: string) => {
          if (text.includes('FROM trip_memberships')) {
            return { rows: [{ role: 'member' }], rowCount: 1 };
          }
          if (text.includes('FROM trips WHERE id = $1')) {
            return { rows: [{ walking_speed: 'moderate', early_entry_eligible: false }], rowCount: 1 };
          }
          if (text.includes('FROM experiences WHERE id = ANY')) {
            return { rows: [{ id: EXP_ID, latitude: 28.4177, longitude: -81.5812 }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }),
      } as unknown as DbPool;

      const dummyRequireSession: preHandlerHookHandler = async (request) => {
        (request as unknown as { userId: string }).userId = CALLER_ID;
      };

      let updatedTimes: Array<{ itemId: string; plannedTime: string }> = [];
      const scopeApp = Fastify();
      registerErrorHandler(scopeApp);

      const repo = makeRepo({
        listPlannedItems: async () => [itemDay1, itemDay2, itemUnassigned],
        updatePlannedItemTimes: async (_id, times) => {
          updatedTimes = times;
        },
      });

      await scopeApp.register(
        tripRoutes({
          pool: poolScope,
          repo,
          requireSession: dummyRequireSession,
        })
      );

      const res = await scopeApp.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/schedule/optimize`,
        payload: { date: '2026-10-01' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as TripOptimizationResult;
      // Only itemDay1 should be in the optimization result
      expect(body.items).toHaveLength(1);
      expect(body.items[0]!.plannedItemId).toBe('item-day-1');

      // Persistence call must only update itemDay1
      expect(updatedTimes).toHaveLength(1);
      expect(updatedTimes[0]!.itemId).toBe('item-day-1');
      // itemDay2 and itemUnassigned are NOT passed to updatePlannedItemTimes
      expect(updatedTimes.some((t) => t.itemId === 'item-day-2')).toBe(false);
      expect(updatedTimes.some((t) => t.itemId === 'item-unassigned')).toBe(false);
    });

    it('schedules from explicit startMinutes (R9.1, R9.2)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/schedule/optimize`,
        payload: { date: '2026-10-01', startMinutes: 750 },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as TripOptimizationResult;
      expect(body.items).toHaveLength(1);
      const arrivalMins = wdwMinutesFromMidnight('2026-10-01', body.items[0]!.suggestedArrival);
      expect(arrivalMins).toBeGreaterThanOrEqual(750);
    });

    it('anchors startMode: "party_mix_in" to 16:00 (4:00 PM) (R9.4)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/schedule/optimize`,
        payload: { date: '2026-10-01', startMode: 'party_mix_in' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as TripOptimizationResult;
      expect(body.items).toHaveLength(1);
      const arrivalMins = wdwMinutesFromMidnight('2026-10-01', body.items[0]!.suggestedArrival);
      expect(arrivalMins).toBeGreaterThanOrEqual(960);
    });

    it('anchors startMode: "now" to current WDW time on today, but falls back to park open on future date (R9.3)', async () => {
      // Future date falls back to park open (540 = 9:00 AM)
      const resFuture = await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/schedule/optimize`,
        payload: { date: '2026-10-01', startMode: 'now' },
      });
      expect(resFuture.statusCode).toBe(200);
      const bodyFuture = resFuture.json() as TripOptimizationResult;
      expect(bodyFuture.items).toHaveLength(1);
      const arrivalFuture = wdwMinutesFromMidnight('2026-10-01', bodyFuture.items[0]!.suggestedArrival);
      expect(arrivalFuture).toBe(540);

      // Today anchors to now rounded to 15m. "Now" is pinned to a safe
      // mid-morning WDW-local time (10:00 AM ET) rather than the real wall
      // clock: this route always reads `new Date()`/`wdwToday()` directly
      // (it takes no injectable clock), so without pinning, a run late in
      // the WDW day (close to or past the default 21:00 close) would push
      // `roundedNow` past `itemEndMins` and the optimizer would correctly
      // report the single fixture item as unfittable — an empty `items`
      // array — no matter what real time the suite happens to run at.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-06-15T14:00:00.000Z')); // 10:00 AM ET (EDT, UTC-4)
      try {
        const todayStr = wdwToday();
        const todayApp = Fastify();
        registerErrorHandler(todayApp);
        const todayRepo = makeRepo({
          listPlannedItems: async () => [pi({ plannedDate: todayStr })],
          updatePlannedItemTimes: async () => {},
        });
        const dummyAuth: preHandlerHookHandler = async (req) => {
          (req as unknown as { userId: string }).userId = CALLER_ID;
        };
        const fakePool = {
          query: vi.fn(async (text: string) => {
            if (text.includes('FROM trip_memberships')) return { rows: [{ role: 'member' }], rowCount: 1 };
            if (text.includes('FROM trips WHERE id = $1')) return { rows: [{ walking_speed: 'moderate', early_entry_eligible: false, day_touring_hours: {} }], rowCount: 1 };
            if (text.includes('FROM experiences WHERE id = ANY')) return { rows: [{ id: EXP_ID, latitude: 28.4177, longitude: -81.5812 }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
          }),
        } as unknown as DbPool;
        await todayApp.register(tripRoutes({ pool: fakePool, repo: todayRepo, requireSession: dummyAuth }));

        const resToday = await todayApp.inject({
          method: 'POST',
          url: `/trips/${TRIP_ID}/schedule/optimize`,
          payload: { date: todayStr, startMode: 'now' },
        });
        expect(resToday.statusCode).toBe(200);
        const bodyToday = resToday.json() as TripOptimizationResult;
        expect(bodyToday.items).toHaveLength(1);
        const arrivalToday = wdwMinutesFromMidnight(todayStr, bodyToday.items[0]!.suggestedArrival);
        const nowMins = wdwMinutesFromMidnight(todayStr, new Date().toISOString());
        expect(arrivalToday).toBeGreaterThanOrEqual(Math.min(Math.ceil(nowMins / 15) * 15, 1439));
      } finally {
        vi.useRealTimers();
      }
    });

    it('preserves park open start when startMode: "park_open" is explicitly set on today (R9.5)', async () => {
      // See the "now" test above for why the system clock is pinned rather
      // than left to the real wall clock.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-06-15T14:00:00.000Z')); // 10:00 AM ET (EDT, UTC-4)
      try {
        const todayStr = wdwToday();
        const todayApp = Fastify();
        registerErrorHandler(todayApp);
        const todayRepo = makeRepo({
          listPlannedItems: async () => [pi({ plannedDate: todayStr })],
          updatePlannedItemTimes: async () => {},
        });
        const dummyAuth: preHandlerHookHandler = async (req) => {
          (req as unknown as { userId: string }).userId = CALLER_ID;
        };
        const fakePool = {
          query: vi.fn(async (text: string) => {
            if (text.includes('FROM trip_memberships')) return { rows: [{ role: 'member' }], rowCount: 1 };
            if (text.includes('FROM trips WHERE id = $1')) return { rows: [{ walking_speed: 'moderate', early_entry_eligible: false, day_touring_hours: {} }], rowCount: 1 };
            if (text.includes('FROM experiences WHERE id = ANY')) return { rows: [{ id: EXP_ID, latitude: 28.4177, longitude: -81.5812 }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
          }),
        } as unknown as DbPool;
        await todayApp.register(tripRoutes({ pool: fakePool, repo: todayRepo, requireSession: dummyAuth }));

        const resToday = await todayApp.inject({
          method: 'POST',
          url: `/trips/${TRIP_ID}/schedule/optimize`,
          payload: { date: todayStr, startMode: 'park_open' },
        });
        expect(resToday.statusCode).toBe(200);
        const bodyToday = resToday.json() as TripOptimizationResult;
        expect(bodyToday.items).toHaveLength(1);
        const arrivalToday = wdwMinutesFromMidnight(todayStr, bodyToday.items[0]!.suggestedArrival);
        const nowMins = wdwMinutesFromMidnight(todayStr, new Date().toISOString());
        const roundedNow = Math.min(Math.ceil(nowMins / 15) * 15, 1439);
        expect(arrivalToday).toBe(Math.max(540, roundedNow));
      } finally {
        vi.useRealTimers();
      }
    });

    it('strictly clamps past arrival times and passed park open to current rounded time on today (R9.8)', async () => {
      // See the "now" test above for why the system clock is pinned rather
      // than left to the real wall clock.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-06-15T14:00:00.000Z')); // 10:00 AM ET (EDT, UTC-4)
      try {
        const todayStr = wdwToday();
        const todayApp = Fastify();
        registerErrorHandler(todayApp);
        const todayRepo = makeRepo({
          listPlannedItems: async () => [pi({ plannedDate: todayStr })],
          updatePlannedItemTimes: async () => {},
        });
        const dummyAuth: preHandlerHookHandler = async (req) => {
          (req as unknown as { userId: string }).userId = CALLER_ID;
        };
        const fakePool = {
          query: vi.fn(async (text: string) => {
            if (text.includes('FROM trip_memberships')) return { rows: [{ role: 'member' }], rowCount: 1 };
            if (text.includes('FROM trips WHERE id = $1')) return { rows: [{ walking_speed: 'moderate', early_entry_eligible: false, day_touring_hours: {} }], rowCount: 1 };
            if (text.includes('FROM experiences WHERE id = ANY')) return { rows: [{ id: EXP_ID, latitude: 28.4177, longitude: -81.5812 }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
          }),
        } as unknown as DbPool;
        await todayApp.register(tripRoutes({ pool: fakePool, repo: todayRepo, requireSession: dummyAuth }));

        // Custom time in the past (e.g. 1:00 AM = 60 minutes)
        const resPast = await todayApp.inject({
          method: 'POST',
          url: `/trips/${TRIP_ID}/schedule/optimize`,
          payload: { date: todayStr, startMode: 'custom', startMinutes: 60 },
        });
        expect(resPast.statusCode).toBe(200);
        const bodyPast = resPast.json() as TripOptimizationResult;
        expect(bodyPast.items).toHaveLength(1);
        const arrivalPast = wdwMinutesFromMidnight(todayStr, bodyPast.items[0]!.suggestedArrival);
        const nowMins = wdwMinutesFromMidnight(todayStr, new Date().toISOString());
        const roundedNow = Math.min(Math.ceil(nowMins / 15) * 15, 1439);
        expect(arrivalPast).toBeGreaterThanOrEqual(roundedNow);
      } finally {
        vi.useRealTimers();
      }
    });

    it('reads walk_wait_weighting from the trip row and steers the sequence accordingly (R10.1, R10.2)', async () => {
      // Four flexible items mirroring the Animal-Kingdom-shaped fixture that
      // proves this tradeoff at the optimizer level: two near items (Pandora),
      // one adjacent item (Discovery Island), and one far item (Africa) whose
      // wait ramps steeply through the morning. With only 2 items the search
      // has no real branching choice (the walk cost is order-independent and
      // both would land in the rope-drop floor); 4 items are needed for a
      // genuine tradeoff to exist for the search to find.
      const idA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const expA = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa';
      const idB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const expB = 'bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb';
      const idC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const expC = 'cccccccc-1111-4ccc-8ccc-cccccccccccc';
      const idD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      const expD = 'dddddddd-1111-4ddd-8ddd-dddddddddddd';

      const items = [
        pi({ id: idA, experienceId: expA, plannedDate: '2026-10-01', plannedTime: null, park: 'Animal Kingdom' }),
        pi({ id: idB, experienceId: expB, plannedDate: '2026-10-01', plannedTime: null, park: 'Animal Kingdom' }),
        pi({ id: idC, experienceId: expC, plannedDate: '2026-10-01', plannedTime: null, park: 'Animal Kingdom' }),
        pi({ id: idD, experienceId: expD, plannedDate: '2026-10-01', plannedTime: null, park: 'Animal Kingdom', durationMinutes: 20 }),
      ];

      function flatWaits(wait: number) {
        return Array.from({ length: 24 }, (_, hour) => ({ hour, predictedWaitMinutes: wait }));
      }

      const predictionServiceWithTradeoff = {
        getDaySnapshot: vi.fn(async () => ({
          [expA]: { experienceId: expA, isVirtualQueue: false, waits: flatWaits(5) },
          [expB]: { experienceId: expB, isVirtualQueue: false, waits: flatWaits(15) },
          [expC]: { experienceId: expC, isVirtualQueue: false, waits: flatWaits(8) },
          [expD]: {
            experienceId: expD,
            isVirtualQueue: false,
            // Wait ramps from a walk-on floor at open to a steep afternoon wait.
            waits: Array.from({ length: 24 }, (_, hour) => ({
              hour,
              predictedWaitMinutes: hour < 9 ? 5 : Math.min(75, 5 + (hour - 9) * 20),
            })),
          },
        })),
        crowdMultiplier: vi.fn(async () => 1.0),
      } as unknown as PredictionService;

      // Pandora (A, B) is adjacent to Discovery Island (C); Africa (D) is a
      // long walk (~1.3km) away — the same geography as the optimizer fixture.
      function buildPoolFor(weighting: string): DbPool {
        return {
          query: vi.fn(async (text: string) => {
            if (text.includes('FROM trip_memberships')) return { rows: [{ role: 'member' }], rowCount: 1 };
            if (text.includes('FROM trips WHERE id = $1')) {
              return {
                rows: [{ walking_speed: 'moderate', early_entry_eligible: false, day_touring_hours: {}, walk_wait_weighting: weighting }],
                rowCount: 1,
              };
            }
            if (text.includes('FROM experiences WHERE id = ANY')) {
              return {
                rows: [
                  { id: expA, latitude: 28.355, longitude: -81.594 },
                  { id: expB, latitude: 28.355, longitude: -81.594 },
                  { id: expC, latitude: 28.358, longitude: -81.59 },
                  { id: expD, latitude: 28.361, longitude: -81.582 },
                ],
                rowCount: 4,
              };
            }
            return { rows: [], rowCount: 0 };
          }),
        } as unknown as DbPool;
      }

      const dummyAuth: preHandlerHookHandler = async (req) => {
        (req as unknown as { userId: string }).userId = CALLER_ID;
      };

      async function runWithWeighting(weighting: string): Promise<TripOptimizationResult> {
        const weightApp = Fastify();
        registerErrorHandler(weightApp);
        const repo = makeRepo({
          listPlannedItems: async () => items,
          updatePlannedItemTimes: async () => {},
        });
        await weightApp.register(
          tripRoutes({
            pool: buildPoolFor(weighting),
            repo,
            requireSession: dummyAuth,
            predictionService: predictionServiceWithTradeoff,
          })
        );
        const res = await weightApp.inject({
          method: 'POST',
          url: `/trips/${TRIP_ID}/schedule/optimize`,
          payload: { date: '2026-10-01' },
        });
        expect(res.statusCode).toBe(200);
        return res.json() as TripOptimizationResult;
      }

      const minimizeWaits = await runWithWeighting('minimize_waits');
      const minimizeWalking = await runWithWeighting('minimize_walking');

      // The route must have actually read walk_wait_weighting off the trips
      // row and passed it through — the two runs diverge on the reported
      // totals in the direction each preset names.
      expect(minimizeWaits.totalWaitMinutes).toBeLessThanOrEqual(minimizeWalking.totalWaitMinutes);
      expect(minimizeWalking.totalWalkMinutes).toBeLessThanOrEqual(minimizeWaits.totalWalkMinutes);
      const waitsDiffer = minimizeWaits.totalWaitMinutes !== minimizeWalking.totalWaitMinutes;
      const walkDiffers = minimizeWaits.totalWalkMinutes !== minimizeWalking.totalWalkMinutes;
      expect(waitsDiffer || walkDiffers).toBe(true);
    });
  });

  describe('PATCH /trips/:id/planned-items/:itemId', () => {
    it('rejects non-members with trip_forbidden', async () => {
      mockRole = null;
      const res = await app.inject({
        method: 'PATCH',
        url: `/trips/${TRIP_ID}/planned-items/${ITEM_ID}`,
        payload: { priority: 1 },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('trip_forbidden');
    });

    it('updates scheduling fields and returns updated DTO', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/trips/${TRIP_ID}/planned-items/${ITEM_ID}`,
        payload: { priority: 1, isFixed: true },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as PlannedItemDTO;
      expect(body.priority).toBe(1);
      expect(body.isFixed).toBe(true);
    });
  });
});
