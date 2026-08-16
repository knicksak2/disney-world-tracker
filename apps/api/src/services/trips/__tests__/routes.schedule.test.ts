/**
 * Integration / route tests for schedule optimization and planned-item editing (task 4.4):
 *
 *   POST  /trips/:id/schedule/optimize
 *   PATCH /trips/:id/planned-items/:itemId
 *
 * Validates: Requirements 3.1, 3.3, 3.10
 */

import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlannedItemDTO, TripOptimizationResult } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import type { PredictionService } from '../../intelligence/predictionService.js';
import type { TripRepo } from '../repo.js';
import { tripRoutes } from '../routes.js';

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
    windowStartMinutes: null,
    windowEndMinutes: null,
    mealPeriod: null,
    scheduledShowtime: null,
    predictedWaitMinutes: null,
    travelFromPrev: null,
    optimizedAt: null,
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
