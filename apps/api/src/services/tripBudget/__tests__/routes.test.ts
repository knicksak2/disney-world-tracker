/**
 * Route tests for Trip Budget (Tasks 15.1, 15.3).
 *
 * Validates: Requirements 1.2, 1.3, 1.4, 1.5, 2.5, 4.6, 7.5, 12.9, 14.8, 14.12,
 *            18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.8, 18.9, 20.1, 20.6, 21.5
 * Properties: 24, 31, 39, 41
 */

import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type {
  BudgetLineDTO,
  BudgetSettingsDTO,
  TravelerProfileDTO,
} from '@dwt/shared';
import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import type { RawBudgetBundle, StoredLine } from '../types.js';
import type { TripBudgetRepo } from '../repo.js';
import { tripBudgetRoutes, type TicketPriceDemandService } from '../routes.js';
import type { TicketPricesRepo } from '../../ticketPrices/repo.js';
import type { LightningLaneReadRepo } from '../../lightningLane/repo.js';

const CALLER_ID = '11111111-1111-4111-8111-111111111111';
const TRIP_ID = '22222222-2222-4222-8222-222222222222';
const LINE_ID = '33333333-3333-4333-8333-333333333333';
const PROFILE_ID = '44444444-4444-4444-8444-444444444444';
const UNKNOWN_TRIP_ID = '99999999-9999-4999-8999-999999999999';

function dummyStoredLine(overrides: Partial<StoredLine> = {}): StoredLine {
  return {
    id: LINE_ID,
    category: 'lodging',
    description: 'Hotel Room',
    plannedDate: '2026-10-01',
    park: null,
    experienceId: null,
    priceSource: 'user_entered',
    priceAsOf: new Date('2026-09-01T12:00:00Z'),
    priceRef: null,
    applyTip: false,
    allocations: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        personKey: `m:${CALLER_ID}` as const,
        storedCents: 15000,
        priceRef: null,
      },
    ],
    ...overrides,
  };
}

function dummyRawBundle(lines: StoredLine[] = [dummyStoredLine()]): RawBudgetBundle {
  return {
    trip: {
      startDate: '2026-10-01',
      endDate: '2026-10-10',
      dayTouringHours: {},
    },
    settings: {
      taxBps: { lodging: 650, dining: 650, tickets: 650, shopping: 650, transportation: 0, lightning_lane: 0, other: 650 },
      diningTipBps: 1800,
      savedCents: 0,
      savingsTargetCents: null,
      taxBpsIsDefault: { lodging: true, dining: true, tickets: true, shopping: true, transportation: true, lightning_lane: true, other: true },
      diningTipBpsIsDefault: true,
    },
    settingsEffective: {
      taxBps: { lodging: 650, dining: 650, tickets: 650, shopping: 650, transportation: 0, lightning_lane: 0, other: 650 },
      diningTipBps: 1800,
      savedCents: 0,
      savingsTargetCents: null,
    },
    travelers: [
      {
        id: PROFILE_ID,
        memberId: CALLER_ID,
        guestId: null,
        label: 'Caller User',
        ageBracket: 'adult',
        ticketOption: null,
        ticketDays: null,
        ticketStartDate: null,
        discountGroup: 'std-gst',
        passType: 'none',
      },
    ],
    storedLines: lines,
    people: new Map([
      [`m:${CALLER_ID}`, { label: 'Caller User', sponsorMemberId: null, deleted: false }],
    ]),
    vsActualByExpenseCategory: {
      hotel: 0,
      dining: 0,
      tickets: 0,
      lightning_lane: 0,
      shopping: 0,
      transportation: 0,
      other: 0,
    },
  };
}

function makeFakeRepo(overrides: Partial<TripBudgetRepo> = {}): TripBudgetRepo {
  return new Proxy({} as TripBudgetRepo, {
    get(_target, prop: string) {
      if (prop in overrides) {
        return (overrides as Record<string, unknown>)[prop];
      }
      return () => {
        throw new Error(`TripBudgetRepo.${prop} was called unexpectedly without override`);
      };
    },
  });
}

interface HarnessOptions {
  role?: string | null;
  lineExists?: boolean;
  profileExists?: boolean;
  repoOverrides?: Partial<TripBudgetRepo>;
  ticketPricesRepo?: TicketPricesRepo;
  ticketPricesService?: TicketPriceDemandService;
  lightningLaneRepo?: LightningLaneReadRepo;
  tpConfig?: {
    enabled?: boolean;
    groups?: readonly string[];
    flResidentNumDays?: readonly number[];
    minAttemptIntervalHours?: number;
    staleAfterDays?: number;
  };
}

async function buildApp(options: HarnessOptions = {}): Promise<{
  app: FastifyInstance;
  setRole: (r: string | null) => void;
  setLineExists: (e: boolean) => void;
  setProfileExists: (e: boolean) => void;
}> {
  let currentRole = options.role !== undefined ? options.role : 'member';
  let lineExists = options.lineExists ?? true;
  let profileExists = options.profileExists ?? true;

  const fakePool = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      // 1. Membership query in assertTripMember
      if (text.includes('FROM trip_memberships tm')) {
        if (currentRole === null) return { rows: [], rowCount: 0 };
        if (params && params[0] === UNKNOWN_TRIP_ID) return { rows: [], rowCount: 0 };
        return {
          rows: [
            {
              role: currentRole,
              has_active_organizer: true,
            },
          ],
          rowCount: 1,
        };
      }
      // 2. Line existence check
      if (text.includes('SELECT id, created_by FROM trip_budget_lines') || text.includes('SELECT id FROM trip_budget_lines')) {
        if (!lineExists) return { rows: [], rowCount: 0 };
        return {
          rows: [{ id: LINE_ID, created_by: CALLER_ID }],
          rowCount: 1,
        };
      }
      // 3. Traveler profile existence check
      if (text.includes('FROM trip_traveler_profiles')) {
        if (!profileExists) return { rows: [], rowCount: 0 };
        return {
          rows: [{ id: PROFILE_ID }],
          rowCount: 1,
        };
      }
      // 4. Trip query for suggestions
      if (text.includes('SELECT start_date, day_touring_hours FROM trips')) {
        return {
          rows: [{ start_date: '2026-10-01', day_touring_hours: {} }],
          rowCount: 1,
        };
      }
      // 5. Existing suggestion keys on lines
      if (text.includes('SELECT suggestion_key FROM trip_budget_lines')) {
        return { rows: [], rowCount: 0 };
      }
      // 6. Experiences query for suggestions
      if (text.includes('SELECT id, park FROM experiences')) {
        return { rows: [], rowCount: 0 };
      }
      // 7. Lightning lane single prices query for suggestions
      if (text.includes('FROM lightning_lane_single_prices')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as DbPool;

  const dummyRequireSession: preHandlerHookHandler = async (request) => {
    (request as unknown as { userId: string }).userId = CALLER_ID;
  };

  const defaultRepoOverrides: Partial<TripBudgetRepo> = {
    loadBudget: async () => dummyRawBundle(),
    listPlannedItemsForSuggestions: async () => [],
    listTravelerProfiles: async () => [],
    listDismissedSuggestions: async () => new Set(),
    getServiceStylesForExperiences: async () => new Map(),
    createLine: async (_t: string, _u: string, input: any): Promise<BudgetLineDTO> => {
      const line = dummyStoredLine({
        description: input.description,
        category: input.category,
        priceSource: input.priceSource,
      });
      return {
        id: line.id,
        tripId: TRIP_ID,
        createdBy: CALLER_ID,
        category: line.category,
        description: line.description,
        plannedDate: line.plannedDate,
        park: line.park,
        experienceId: line.experienceId,
        priceSource: input.priceSource,
        effectivePriceSource: input.priceSource,
        priceLabelKind: 'current' as const,
        asOf: new Date().toISOString(),
        attribution: null,
        applyTip: line.applyTip,
        linkedExpenseId: null,
        suggestionKey: null,
        subtotalCents: 15000,
        taxCents: 975,
        tipCents: 0,
        totalCents: 15975,
        allocations: line.allocations.map((a) => ({
          id: a.id,
          memberId: CALLER_ID,
          guestId: null,
          storedCents: a.storedCents,
          effectiveCents: a.storedCents,
          taxCents: 975,
          tipCents: 0,
          priceRef: null,
        })),
      };
    },
    editLine: async (_t: string, _l: string, _u: string, _r: any, input: any): Promise<BudgetLineDTO> => {
      const line = dummyStoredLine({
        description: input.description,
        category: input.category,
        priceSource: input.priceSource,
      });
      return {
        id: line.id,
        tripId: TRIP_ID,
        createdBy: CALLER_ID,
        category: line.category,
        description: line.description,
        plannedDate: line.plannedDate,
        park: line.park,
        experienceId: line.experienceId,
        priceSource: input.priceSource,
        effectivePriceSource: input.priceSource,
        priceLabelKind: 'current' as const,
        asOf: new Date().toISOString(),
        attribution: null,
        applyTip: line.applyTip,
        linkedExpenseId: null,
        suggestionKey: null,
        subtotalCents: 15000,
        taxCents: 975,
        tipCents: 0,
        totalCents: 15975,
        allocations: line.allocations.map((a) => ({
          id: a.id,
          memberId: CALLER_ID,
          guestId: null,
          storedCents: a.storedCents,
          effectiveCents: a.storedCents,
          taxCents: 975,
          tipCents: 0,
          priceRef: null,
        })),
      };
    },
    removeLine: async () => {},
    upsertProfile: async (_t: string, _u: string, _r: any, body: any): Promise<TravelerProfileDTO> => ({
      id: PROFILE_ID,
      memberId: body.memberId ?? null,
      guestId: body.guestId ?? null,
      label: 'Test Traveler',
      ageBracket: body.ageBracket,
      ticketOption: body.ticketOption ?? null,
      ticketDays: body.ticketDays ?? null,
      ticketStartDate: body.ticketStartDate ?? null,
      discountGroup: body.discountGroup ?? 'std-gst',
      passType: body.passType ?? 'none',
    }),
    deleteProfile: async () => {},
    patchSettings: async (_t: string, body: any): Promise<BudgetSettingsDTO> => ({
      taxBps: body.taxBps ?? { lodging: 650, dining: 650, tickets: 650, shopping: 650, transportation: 0, lightning_lane: 0, other: 650 },
      diningTipBps: body.diningTipBps ?? 1800,
      savedCents: body.savedCents ?? 0,
      savingsTargetCents: body.savingsTargetCents ?? null,
      taxBpsIsDefault: { lodging: true, dining: true, tickets: true, shopping: true, transportation: true, lightning_lane: true, other: true },
      diningTipBpsIsDefault: body.diningTipBps === undefined,
    }),
    dismissSuggestion: async () => {},
    ...options.repoOverrides,
  };

  const app = Fastify();
  registerErrorHandler(app);

  await app.register(
    tripBudgetRoutes({
      pool: fakePool,
      repo: makeFakeRepo(defaultRepoOverrides),
      requireSession: dummyRequireSession,
      ...(options.ticketPricesRepo ? { ticketPricesRepo: options.ticketPricesRepo } : {}),
      ...(options.ticketPricesService ? { ticketPricesService: options.ticketPricesService } : {}),
      ...(options.lightningLaneRepo ? { lightningLaneRepo: options.lightningLaneRepo } : {}),
      config: options.tpConfig !== undefined ? { ticketPrices: options.tpConfig } : {},
    }),
  );

  return {
    app,
    setRole: (r) => {
      currentRole = r;
    },
    setLineExists: (e) => {
      lineExists = e;
    },
    setProfileExists: (e) => {
      profileExists = e;
    },
  };
}

describe('Trip Budget Routes (Property 24 & Contract Table)', () => {
  // ---------------------------------------------------------------------------
  // 1. Role Authorization across all 10 endpoints
  // ---------------------------------------------------------------------------
  it('member is authorized for 9 routes but forbidden from patch settings (Property 24)', async () => {
    const { app } = await buildApp({ role: 'member' });

    // 1. GET /budget
    const res1 = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/budget` });
    expect(res1.statusCode).toBe(200);

    // 2. GET /budget/suggestions
    const res2 = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/budget/suggestions` });
    expect(res2.statusCode).toBe(200);

    // 3. POST /budget/lines
    const res3 = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/budget/lines`,
      payload: {
        category: 'lodging',
        description: 'Hotel',
        priceSource: 'user_entered',
        allocations: [{ memberId: CALLER_ID, amountCents: 10000 }],
      },
    });
    expect(res3.statusCode).toBe(201);

    // 4. PATCH /budget/lines/:lineId
    const res4 = await app.inject({
      method: 'PATCH',
      url: `/trips/${TRIP_ID}/budget/lines/${LINE_ID}`,
      payload: {
        category: 'lodging',
        description: 'Hotel Updated',
        priceSource: 'user_entered',
        allocations: [{ memberId: CALLER_ID, amountCents: 12000 }],
      },
    });
    expect(res4.statusCode).toBe(200);

    // 5. DELETE /budget/lines/:lineId
    const res5 = await app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/budget/lines/${LINE_ID}`,
    });
    expect(res5.statusCode).toBe(204);

    // 6. PUT /budget/travelers
    const res6 = await app.inject({
      method: 'PUT',
      url: `/trips/${TRIP_ID}/budget/travelers`,
      payload: {
        memberId: CALLER_ID,
        ageBracket: 'adult',
      },
    });
    expect(res6.statusCode).toBe(200);

    // 7. DELETE /budget/travelers/:profileId
    const res7 = await app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/budget/travelers/${PROFILE_ID}`,
    });
    expect(res7.statusCode).toBe(204);

    // 8. POST /budget/suggestions/dismiss
    const res8 = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/budget/suggestions/dismiss`,
      payload: { suggestionKey: 'sug-key-1' },
    });
    expect(res8.statusCode).toBe(204);

    // 9. POST /budget/quotes
    const res9 = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/budget/quotes`,
      payload: { requests: [] },
    });
    // empty requests violates min(1) -> 400
    expect(res9.statusCode).toBe(400);

    // 10. PATCH /budget/settings: forbidden for regular members!
    const res10 = await app.inject({
      method: 'PATCH',
      url: `/trips/${TRIP_ID}/budget/settings`,
      payload: { savedCents: 5000 },
    });
    expect(res10.statusCode).toBe(403);
    expect(res10.json().error.code).toBe('trip_forbidden');
  });

  it('organizer is authorized for all 10 routes including patch settings', async () => {
    const { app } = await buildApp({ role: 'organizer' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/trips/${TRIP_ID}/budget/settings`,
      payload: { savedCents: 5000 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().savedCents).toBe(5000);
  });

  it('non-member is rejected with 403 trip_forbidden on all routes', async () => {
    const { app } = await buildApp({ role: null });

    const sampleRoutes = [
      { method: 'GET', url: `/trips/${TRIP_ID}/budget` },
      { method: 'GET', url: `/trips/${TRIP_ID}/budget/suggestions` },
      {
        method: 'POST',
        url: `/trips/${TRIP_ID}/budget/lines`,
        payload: {
          category: 'lodging',
          description: 'Hotel',
          priceSource: 'user_entered',
          allocations: [{ memberId: CALLER_ID, amountCents: 10000 }],
        },
      },
      {
        method: 'PATCH',
        url: `/trips/${TRIP_ID}/budget/lines/${LINE_ID}`,
        payload: {
          category: 'lodging',
          description: 'Hotel',
          priceSource: 'user_entered',
          allocations: [{ memberId: CALLER_ID, amountCents: 10000 }],
        },
      },
      { method: 'DELETE', url: `/trips/${TRIP_ID}/budget/lines/${LINE_ID}` },
      {
        method: 'PUT',
        url: `/trips/${TRIP_ID}/budget/travelers`,
        payload: { memberId: CALLER_ID, ageBracket: 'adult' },
      },
      { method: 'DELETE', url: `/trips/${TRIP_ID}/budget/travelers/${PROFILE_ID}` },
      {
        method: 'PATCH',
        url: `/trips/${TRIP_ID}/budget/settings`,
        payload: { savedCents: 1000 },
      },
      {
        method: 'POST',
        url: `/trips/${TRIP_ID}/budget/suggestions/dismiss`,
        payload: { suggestionKey: 'sug-1' },
      },
      {
        method: 'POST',
        url: `/trips/${TRIP_ID}/budget/quotes`,
        payload: {
          requests: [
            {
              kind: 'ticket',
              discountGroup: 'std-gst',
              numDays: 4,
              ageGroup: 'adult',
              optionCode: 'base',
              startDate: '2026-10-05',
            },
          ],
        },
      },
    ] as const;

    for (const r of sampleRoutes) {
      const res = await app.inject({
        method: r.method,
        url: r.url,
        payload: (r as any).payload,
      });
      expect(res.statusCode, `${r.method} ${r.url} should be 403`).toBe(403);
      expect(res.json().error.code).toBe('trip_forbidden');
    }
  });

  it('unknown trip id is indistinguishable from non-member (403 trip_forbidden)', async () => {
    const { app } = await buildApp({ role: 'member' });

    const res = await app.inject({
      method: 'GET',
      url: `/trips/${UNKNOWN_TRIP_ID}/budget`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('trip_forbidden');
  });

  // ---------------------------------------------------------------------------
  // 2. Round 5 L2: Not found vs Forbidden ordering
  // ---------------------------------------------------------------------------
  it('PATCH / DELETE of non-existent line returns 404 trip_not_found for member', async () => {
    const { app } = await buildApp({ role: 'member', lineExists: false });

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/trips/${TRIP_ID}/budget/lines/${LINE_ID}`,
      payload: {
        category: 'lodging',
        description: 'Hotel',
        priceSource: 'user_entered',
        allocations: [{ memberId: CALLER_ID, amountCents: 10000 }],
      },
    });
    expect(patchRes.statusCode).toBe(404);
    expect(patchRes.json().error.code).toBe('trip_not_found');

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/budget/lines/${LINE_ID}`,
    });
    expect(deleteRes.statusCode).toBe(404);
    expect(deleteRes.json().error.code).toBe('trip_not_found');
  });

  it('DELETE of non-existent traveler profile returns 404 trip_not_found for member', async () => {
    const { app } = await buildApp({ role: 'member', profileExists: false });

    const res = await app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/budget/travelers/${PROFILE_ID}`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('trip_not_found');
  });

  it('non-member gets 403 trip_forbidden before any 404 check', async () => {
    const { app } = await buildApp({ role: null, lineExists: false });

    const res = await app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/budget/lines/${LINE_ID}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('trip_forbidden');
  });

  // ---------------------------------------------------------------------------
  // 3. Status codes and Contract table body shapes
  // ---------------------------------------------------------------------------
  it('happy path returns exact contract shapes (201, 200, 204)', async () => {
    const { app } = await buildApp({ role: 'organizer' });

    // POST line -> 201 + BudgetLineDTO
    const postLineRes = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/budget/lines`,
      payload: {
        category: 'lodging',
        description: 'Grand Floridian',
        priceSource: 'user_entered',
        allocations: [{ memberId: CALLER_ID, amountCents: 50000 }],
      },
    });
    expect(postLineRes.statusCode).toBe(201);
    const postBody: BudgetLineDTO = postLineRes.json();
    expect(postBody.id).toBeDefined();
    expect(postBody.category).toBe('lodging');
    expect(postBody.description).toBe('Grand Floridian');
    expect(postBody.allocations[0]!.effectiveCents).toBe(15000);

    // PATCH line -> 200 + BudgetLineDTO
    const patchLineRes = await app.inject({
      method: 'PATCH',
      url: `/trips/${TRIP_ID}/budget/lines/${LINE_ID}`,
      payload: {
        category: 'lodging',
        description: 'Grand Floridian (Renovated)',
        priceSource: 'user_entered',
        suggestionKey: 'stray-key-ignored',
        allocations: [{ memberId: CALLER_ID, amountCents: 60000 }],
      },
    });
    expect(patchLineRes.statusCode).toBe(200);
    const patchBody: BudgetLineDTO = patchLineRes.json();
    expect(patchBody.description).toBe('Grand Floridian (Renovated)');
    expect(patchBody.asOf).toBeDefined();

    // Missing allocations on PATCH is rejected with trip_validation_failed (no partial update)
    const badPatchRes = await app.inject({
      method: 'PATCH',
      url: `/trips/${TRIP_ID}/budget/lines/${LINE_ID}`,
      payload: {
        category: 'lodging',
        description: 'Missing allocations',
        priceSource: 'user_entered',
      },
    });
    expect(badPatchRes.statusCode).toBe(400);
    expect(badPatchRes.json().error.code).toBe('trip_validation_failed');

    // PUT travelers -> 200 + TravelerProfileDTO
    const putTravRes = await app.inject({
      method: 'PUT',
      url: `/trips/${TRIP_ID}/budget/travelers`,
      payload: {
        memberId: CALLER_ID,
        ageBracket: 'adult',
        ticketDays: 4,
        discountGroup: 'std-gst',
      },
    });
    expect(putTravRes.statusCode).toBe(200);
    const travBody: TravelerProfileDTO = putTravRes.json();
    expect(travBody.id).toBe(PROFILE_ID);
    expect(travBody.ageBracket).toBe('adult');
    expect(travBody.ticketDays).toBe(4);

    // DELETE line -> 204
    const delLineRes = await app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/budget/lines/${LINE_ID}`,
    });
    expect(delLineRes.statusCode).toBe(204);
    expect(delLineRes.body).toBe('');

    // DELETE traveler -> 204
    const delTravRes = await app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/budget/travelers/${PROFILE_ID}`,
    });
    expect(delTravRes.statusCode).toBe(204);
    expect(delTravRes.body).toBe('');

    // PATCH settings -> 200 + BudgetSettingsDTO
    const patchSetRes = await app.inject({
      method: 'PATCH',
      url: `/trips/${TRIP_ID}/budget/settings`,
      payload: {
        taxBps: { dining: 700 },
        savedCents: 25000,
      },
    });
    expect(patchSetRes.statusCode).toBe(200);
    const setBody: BudgetSettingsDTO = patchSetRes.json();
    expect(setBody.taxBps.dining).toBe(700);
    expect(setBody.savedCents).toBe(25000);

    // POST dismiss -> 204, calling twice is 204 both times (round 4 M5)
    const disRes1 = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/budget/suggestions/dismiss`,
      payload: { suggestionKey: 'dining:exp-1' },
    });
    expect(disRes1.statusCode).toBe(204);

    const disRes2 = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/budget/suggestions/dismiss`,
      payload: { suggestionKey: 'dining:exp-1' },
    });
    expect(disRes2.statusCode).toBe(204);
  });

  // ---------------------------------------------------------------------------
  // 4. Validation failures (discriminatedUnion error & .strict())
  // ---------------------------------------------------------------------------
  it('rejects malformed discriminatedUnion and strict unknown keys with 400 trip_validation_failed', async () => {
    const { app } = await buildApp({ role: 'member' });

    // Unknown priceRef.kind in quotes
    const badUnionRes = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/budget/quotes`,
      payload: {
        requests: [
          {
            kind: 'invalid_kind',
          },
        ],
      },
    });
    expect(badUnionRes.statusCode).toBe(400);
    expect(badUnionRes.json().error.code).toBe('trip_validation_failed');

    // Unknown key rejected by .strict() in quotes
    const badStrictQuotesRes = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/budget/quotes`,
      payload: {
        requests: [
          {
            kind: 'll',
            passType: 'multi_pass',
            park: 'Magic Kingdom',
            date: '2026-10-02',
          },
        ],
        extraKey: 'not_allowed',
      },
    });
    expect(badStrictQuotesRes.statusCode).toBe(400);
    expect(badStrictQuotesRes.json().error.code).toBe('trip_validation_failed');

    // Unknown key in budget lines
    const badStrictLineRes = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/budget/lines`,
      payload: {
        category: 'lodging',
        description: 'Hotel',
        priceSource: 'user_entered',
        allocations: [{ memberId: CALLER_ID, amountCents: 10000 }],
        unrecognizedStrayField: 123,
      },
    });
    expect(badStrictLineRes.statusCode).toBe(400);
    expect(badStrictLineRes.json().error.code).toBe('trip_validation_failed');
  });

  // ---------------------------------------------------------------------------
  // 5. Ticket cacheState & Florida resident quoting (Req 14.12, Round 4 M2, Round 5 M3/M4)
  // ---------------------------------------------------------------------------
  describe('Ticket quotes cacheState and flUnavailable', () => {
    it('returns cacheState disabled when kill switch is off', async () => {
      const { app } = await buildApp({
        role: 'member',
        tpConfig: { enabled: false },
        ticketPricesRepo: {
          readBook: async () => ({ rows: [], sets: [], control: null }),
        } as unknown as TicketPricesRepo,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/budget/quotes`,
        payload: {
          requests: [
            {
              kind: 'ticket',
              discountGroup: 'std-gst',
              numDays: 4,
              ageGroup: 'adult',
              optionCode: 'base',
              startDate: '2026-10-05',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const quotes = res.json();
      expect(quotes[0].cacheState).toBe('disabled');
      expect(quotes[0].attribution).toBe('disney');
    });

    it('round 4 M2: fl-resident under DEFAULT config (groups=[std-gst]) returns flUnavailable: true and cacheState: ready', async () => {
      const { app } = await buildApp({
        role: 'member',
        tpConfig: { enabled: true, groups: ['std-gst'] },
        ticketPricesRepo: {
          readBook: async () => ({ rows: [], sets: [], control: null }),
        } as unknown as TicketPricesRepo,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/budget/quotes`,
        payload: {
          requests: [
            {
              kind: 'ticket',
              discountGroup: 'fl-resident',
              numDays: 4,
              ageGroup: 'adult',
              optionCode: 'base',
              startDate: '2026-10-05',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const quotes = res.json();
      expect(quotes[0].flUnavailable).toBe(true);
      expect(quotes[0].cacheState).toBe('ready');
    });

    it('never-fetched std-gst quote with switch on and no block returns warming', async () => {
      const { app } = await buildApp({
        role: 'member',
        tpConfig: { enabled: true, groups: ['std-gst'] },
        ticketPricesRepo: {
          readBook: async () => ({
            rows: [],
            sets: [],
            control: {
              blockedUntil: null,
              inProgressSince: null,
              lastAttemptAt: null,
            },
          }),
        } as unknown as TicketPricesRepo,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/budget/quotes`,
        payload: {
          requests: [
            {
              kind: 'ticket',
              discountGroup: 'std-gst',
              numDays: 4,
              ageGroup: 'adult',
              optionCode: 'base',
              startDate: '2026-10-05',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const quotes = res.json();
      expect(quotes[0].cacheState).toBe('warming');
    });

    it('round 5 M3 and M4: permitted fl-resident pair returns flUnavailable: false, warming, and calls noteDemand', async () => {
      const demandSpy = vi.fn();
      const { app } = await buildApp({
        role: 'member',
        tpConfig: {
          enabled: true,
          groups: ['std-gst', 'fl-resident'],
          flResidentNumDays: [4],
          minAttemptIntervalHours: 24,
        },
        ticketPricesService: {
          noteDemand: demandSpy,
        },
        ticketPricesRepo: {
          readBook: async () => ({
            rows: [],
            sets: [],
            control: {
              blockedUntil: null,
              inProgressSince: null,
              lastAttemptAt: null,
            },
          }),
        } as unknown as TicketPricesRepo,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/budget/quotes`,
        payload: {
          requests: [
            {
              kind: 'ticket',
              discountGroup: 'fl-resident',
              numDays: 4,
              ageGroup: 'adult',
              optionCode: 'base',
              startDate: '2099-10-05',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const quotes = res.json();
      expect(quotes[0].flUnavailable).toBe(false);
      expect(quotes[0].cacheState).toBe('warming');
      expect(demandSpy).toHaveBeenCalledWith({
        groups: ['fl-resident'],
        numDays: [4],
        maxStartDate: '2099-10-05',
      });
    });

    it('round 5 M3 and M4: non-permitted fl-resident request (numDays: 3) returns flUnavailable: true and ready and calls noteDemand zero times', async () => {
      const demandSpy = vi.fn();
      const { app } = await buildApp({
        role: 'member',
        tpConfig: {
          enabled: true,
          groups: ['std-gst', 'fl-resident'],
          flResidentNumDays: [4],
        },
        ticketPricesService: {
          noteDemand: demandSpy,
        },
        ticketPricesRepo: {
          readBook: async () => ({
            rows: [],
            sets: [],
            control: null,
          }),
        } as unknown as TicketPricesRepo,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/budget/quotes`,
        payload: {
          requests: [
            {
              kind: 'ticket',
              discountGroup: 'fl-resident',
              numDays: 3,
              ageGroup: 'adult',
              optionCode: 'base',
              startDate: '2099-10-05',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const quotes = res.json();
      expect(quotes[0].flUnavailable).toBe(true);
      expect(quotes[0].cacheState).toBe('ready');
      expect(demandSpy).not.toHaveBeenCalled();
    });

    it('std-gst set with lastError="network", asOf=null returns failed (not warming)', async () => {
      const { app } = await buildApp({
        role: 'member',
        tpConfig: { enabled: true, groups: ['std-gst'] },
        ticketPricesRepo: {
          readBook: async () => ({
            rows: [],
            sets: [
              {
                discountGroup: 'std-gst',
                numDays: 4,
                asOf: null,
                lastError: 'network',
                rowCount: 0,
                windowDays: null,
                lastAttemptAt: new Date(Date.now() - 3600000),
                inProgressSince: null,
              },
            ],
            control: {
              blockedUntil: null,
              inProgressSince: null,
              lastAttemptAt: null,
            },
          }),
        } as unknown as TicketPricesRepo,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/budget/quotes`,
        payload: {
          requests: [
            {
              kind: 'ticket',
              discountGroup: 'std-gst',
              numDays: 4,
              ageGroup: 'adult',
              optionCode: 'base',
              startDate: '2099-10-05',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const quotes = res.json();
      expect(quotes[0].cacheState).toBe('failed');
    });

    it('blockedUntil in future returns disabled whatever set says', async () => {
      const { app } = await buildApp({
        role: 'member',
        tpConfig: { enabled: true, groups: ['std-gst'] },
        ticketPricesRepo: {
          readBook: async () => ({
            rows: [],
            sets: [
              {
                discountGroup: 'std-gst',
                numDays: 4,
                asOf: new Date(),
                lastError: null,
                rowCount: 100,
                windowDays: 70,
                lastAttemptAt: new Date(),
                inProgressSince: null,
              },
            ],
            control: {
              blockedUntil: new Date(Date.now() + 3600000), // 1 hour in future
              inProgressSince: null,
              lastAttemptAt: null,
            },
          }),
        } as unknown as TicketPricesRepo,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/budget/quotes`,
        payload: {
          requests: [
            {
              kind: 'ticket',
              discountGroup: 'std-gst',
              numDays: 4,
              ageGroup: 'adult',
              optionCode: 'base',
              startDate: '2099-10-05',
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const quotes = res.json();
      expect(quotes[0].cacheState).toBe('disabled');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Account deletion 409 trip_party_deleted (Property 41)
  // ---------------------------------------------------------------------------
  it('returns 409 trip_party_deleted when a write names a pending_deletion account', async () => {
    const { app } = await buildApp({
      role: 'member',
      repoOverrides: {
        createLine: async () => {
          throw new AppError('trip_party_deleted', 'A party named in this allocation has deleted their account.');
        },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/budget/lines`,
      payload: {
        category: 'lodging',
        description: 'Hotel with deleted member',
        priceSource: 'user_entered',
        allocations: [{ memberId: CALLER_ID, amountCents: 10000 }],
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('trip_party_deleted');
  });

  it('passes resolved amounts and allocationPriceRefs to repo.createLine for ticket lines', async () => {
    let capturedResolved: any = null;
    const { app } = await buildApp({
      role: 'member',
      ticketPricesRepo: {
        readBook: async () => ({
          rows: [
            {
              discountGroup: 'std-gst',
              numDays: 1,
              ageGroup: 'adult',
              optionCode: 'base',
              park: 'mk',
              startDate: '2099-10-29',
              priceCents: 19400,
              taxCents: 1261,
            },
          ],
          sets: [{ discountGroup: 'std-gst', numDays: 1, asOf: new Date(), horizonDate: '2099-12-31', rowCount: 1, windowDays: 60 }],
          control: null,
        }),
      } as unknown as TicketPricesRepo,
      repoOverrides: {
        createLine: async (_t: string, _u: string, _input: any, resolved: any): Promise<BudgetLineDTO> => {
          capturedResolved = resolved;
          const line = dummyStoredLine();
          return {
            id: line.id,
            tripId: TRIP_ID,
            createdBy: CALLER_ID,
            category: 'tickets',
            description: 'tickets',
            plannedDate: '2099-10-29',
            park: 'Magic Kingdom',
            experienceId: null,
            priceSource: 'disney_ticket_calendar',
            effectivePriceSource: 'disney_ticket_calendar',
            priceLabelKind: 'current',
            asOf: new Date().toISOString(),
            attribution: 'disney',
            applyTip: false,
            linkedExpenseId: null,
            suggestionKey: null,
            subtotalCents: 19400,
            taxCents: 1261,
            tipCents: 0,
            totalCents: 20661,
            allocations: [],
          };
        },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/budget/lines`,
      payload: {
        category: 'tickets',
        description: 'tickets',
        plannedDate: '2099-10-29',
        park: 'Magic Kingdom',
        priceSource: 'disney_ticket_calendar',
        priceRef: {
          kind: 'ticket',
          discountGroup: 'std-gst',
          numDays: 1,
          ageGroup: 'adult',
          optionCode: 'base',
          startDate: '2099-10-29',
          park: 'mk',
        },
        allocations: [{ memberId: CALLER_ID, amountCents: 0 }],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(capturedResolved).toBeDefined();
    expect(capturedResolved.amounts).toEqual([19400]);
    expect(capturedResolved.allocationPriceRefs).toHaveLength(1);
    expect(capturedResolved.allocationPriceRefs[0].park).toBe('mk');
  });

  // ---------------------------------------------------------------------------
  // 7. Route table scan: no registered route returns raw list of price rows
  // ---------------------------------------------------------------------------
  it('route-table scan finds no registered route returning raw list of ticket_prices or lightning_lane_single_prices (Property 39)', async () => {
    const { app } = await buildApp();
    await app.ready();

    // Fastify printRoutes gives the registered routing tree
    const routesText = app.printRoutes();
    expect(routesText).not.toContain('/ticket_prices');
    expect(routesText).not.toContain('/ticket-prices');
    expect(routesText).not.toContain('/lightning_lane_single_prices');
    expect(routesText).not.toContain('/lightning-lane-prices');
  });

  // ---------------------------------------------------------------------------
  // 8. Requirement 1 Isolation
  // ---------------------------------------------------------------------------
  it('Requirement 1: Budget rows never carry payer, splitMode or balance; Budget repo never writes expense tables', async () => {
    const { app } = await buildApp({ role: 'member' });

    // Budget GET /budget returns lines without payer, splitMode or balance
    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/budget` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const line of body.lines) {
      expect((line as any).payer).toBeUndefined();
      expect((line as any).payerId).toBeUndefined();
      expect((line as any).splitMode).toBeUndefined();
      expect((line as any).balance).toBeUndefined();
      for (const alloc of line.allocations) {
        expect((alloc as any).balance).toBeUndefined();
      }
    }

    // Budget repo writes never write to expenses, expense_shares, settlements, or expense_refunds
    // (guarded by repo tests & schema definition)
  });
});