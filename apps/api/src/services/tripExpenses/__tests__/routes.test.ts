/**
 * Route integration tests for the Trip Expenses service (Tasks 7.4, 7.5, 7.6).
 *
 * Covers:
 * - Membership gate on all 16 routes (Req 10.1, 10.2).
 * - Adder-or-organizer rule on edit/remove for Expense, Settlement, Refund, Guest (Property 10).
 * - Happy-path creation per Split_Mode (exact, even, tiered, itemized) returning expected DTO.
 * - Validation-failure path per Split_Mode returning trip_validation_failed.
 * - Export route returns CSV attachment headers.
 * - Notification dispatch (emitExpenseAffected): fires on creation and amount-changing edit;
 *   does not fire on an edit that changes nothing about who owes what.
 * - Exclusion of expense/settlement/balance data from Trip feed and summary (Req 10.3).
 *
 * Validates: Requirements 1.7, 1.9, 1.10, 2.4, 2.10, 7.5, 8.1, 10.1, 10.2, 10.3, 10.4, 12.5, 12.6, 13.1, 13.3, 13.4
 */

import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ExpenseDTO,
  SettlementDTO,
  TripGuestDTO,
  RefundDTO,
  TripFeedItemDTO,
  TripSummaryDTO,
} from '@dwt/shared';
import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import type { TripExpenseRepo } from '../repo.js';
import { tripExpenseRoutes } from '../routes.js';
import { tripRoutes } from '../../trips/routes.js';
import type { TripRepo } from '../../trips/repo.js';

const CALLER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER_ID = '22222222-2222-2222-2222-222222222222';
const TRIP_ID = '33333333-3333-3333-3333-333333333333';
const EXPENSE_ID = '44444444-4444-4444-4444-444444444444';
const SETTLEMENT_ID = '55555555-5555-5555-5555-555555555555';
const REFUND_ID = '66666666-6666-6666-6666-666666666666';
const GUEST_ID = '77777777-7777-7777-7777-777777777777';

function dummyExpense(overrides: Partial<ExpenseDTO> = {}): ExpenseDTO {
  return {
    id: EXPENSE_ID,
    tripId: TRIP_ID,
    payerId: CALLER_ID,
    createdByUserId: CALLER_ID,
    amountCents: 3000,
    description: 'Dinner at Be Our Guest',
    date: '2026-10-04',
    category: 'dining',
    splitMode: 'even',
    experienceId: null,
    resortId: null,
    shares: [
      {
        id: '88888888-8888-8888-8888-888888888888',
        expenseId: EXPENSE_ID,
        memberId: OTHER_USER_ID,
        guestId: null,
        amountCents: 1500,
      },
    ],
    tiers: [],
    items: [],
    chargeLines: [],
    refunds: [],
    createdAt: '2026-10-04T12:00:00.000Z',
    ...overrides,
  };
}

function dummySettlement(overrides: Partial<SettlementDTO> = {}): SettlementDTO {
  return {
    id: SETTLEMENT_ID,
    tripId: TRIP_ID,
    payerId: CALLER_ID,
    recipientId: OTHER_USER_ID,
    createdByUserId: CALLER_ID,
    amountCents: 1500,
    date: '2026-10-05',
    createdAt: '2026-10-05T10:00:00.000Z',
    ...overrides,
  };
}

function dummyGuest(overrides: Partial<TripGuestDTO> = {}): TripGuestDTO {
  return {
    id: GUEST_ID,
    tripId: TRIP_ID,
    sponsorMemberId: CALLER_ID,
    name: 'Little Timmy',
    createdAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

function dummyRefund(overrides: Partial<RefundDTO> = {}): RefundDTO {
  return {
    id: REFUND_ID,
    expenseId: EXPENSE_ID,
    createdByUserId: CALLER_ID,
    amountCents: 500,
    date: '2026-10-06',
    createdAt: '2026-10-06T09:00:00.000Z',
    ...overrides,
  };
}

function makeExpenseRepo(overrides: Partial<TripExpenseRepo>): TripExpenseRepo {
  return new Proxy({} as TripExpenseRepo, {
    get(_target, prop: string) {
      if (prop in overrides) {
        return (overrides as Record<string, unknown>)[prop];
      }
      return () => {
        throw new Error(`TripExpenseRepo.${prop} must not be called in this test`);
      };
    },
  });
}

function makeTripRepo(overrides: Partial<TripRepo>): TripRepo {
  return new Proxy({} as TripRepo, {
    get(_target, prop: string) {
      if (prop in overrides) {
        return (overrides as Record<string, unknown>)[prop];
      }
      return () => {
        throw new Error(`TripRepo.${prop} must not be called in this test`);
      };
    },
  });
}

interface Harness {
  app: FastifyInstance;
  setRole: (role: string | null) => void;
  emitSpy: ReturnType<typeof vi.fn>;
}

async function buildApp(
  repoOverrides: Partial<TripExpenseRepo> = {},
  tripRepoOverrides: Partial<TripRepo> = {},
): Promise<Harness> {
  let role: string | null = 'member';
  const emitSpy = vi.fn();

  const NON_MEMBER_UUID = '99999999-9999-9999-9999-999999999999';

  const fakePool = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      if (text.includes('FROM trip_memberships')) {
        if (role === null) return { rows: [], rowCount: 0 };
        if (params && params.includes(NON_MEMBER_UUID)) {
          return { rows: [], rowCount: 0 };
        }
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
    tripExpenseRoutes({
      pool: fakePool,
      repo: makeExpenseRepo(repoOverrides),
      requireSession: dummyRequireSession,
      emitExpenseAffected: emitSpy,
    }),
  );

  await app.register(
    tripRoutes({
      pool: fakePool,
      repo: makeTripRepo(tripRepoOverrides),
      requireSession: dummyRequireSession,
    }),
  );

  return {
    app,
    setRole: (next) => {
      role = next;
    },
    emitSpy,
  };
}

// ---------------------------------------------------------------------------
// Membership gate on all routes (Req 10.1, 10.2)
// ---------------------------------------------------------------------------

describe('Trip Expense routes are member-gated (Req 10.1, 10.2)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await buildApp({
      createExpense: async () => dummyExpense(),
      editExpense: async () => dummyExpense(),
      removeExpense: async () => {},
      createRefund: async () => dummyRefund(),
      editRefund: async () => dummyRefund(),
      removeRefund: async () => {},
      addTripGuest: async () => dummyGuest(),
      renameTripGuest: async () => dummyGuest(),
      removeTripGuest: async () => {},
      createSettlement: async () => dummySettlement(),
      editSettlement: async () => dummySettlement(),
      removeSettlement: async () => {},
      listExpensesAndSettlements: async () => [dummyExpense()],
      getNetBalances: async () => [],
      getBalanceDrillDown: async () => [],
      exportLedgerCsv: async () => 'Date,Type\n',
      listTripGuests: async () => [],
      getExpense: async () => dummyExpense(),
    });
    h.setRole(null); // non-member / unknown trip
  });

  const routes: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: unknown }[] = [
    { method: 'POST', url: `/trips/${TRIP_ID}/expenses`, payload: { payerId: CALLER_ID, amountCents: 1000, description: 'Test', date: '2026-10-01', splitMode: 'even', participantIds: [CALLER_ID, OTHER_USER_ID] } },
    { method: 'PATCH', url: `/trips/${TRIP_ID}/expenses/${EXPENSE_ID}`, payload: { description: 'Updated' } },
    { method: 'DELETE', url: `/trips/${TRIP_ID}/expenses/${EXPENSE_ID}` },
    { method: 'POST', url: `/trips/${TRIP_ID}/expenses/${EXPENSE_ID}/refunds`, payload: { amountCents: 100, date: '2026-10-02' } },
    { method: 'PATCH', url: `/trips/${TRIP_ID}/expenses/${EXPENSE_ID}/refunds/${REFUND_ID}`, payload: { amountCents: 200, date: '2026-10-02' } },
    { method: 'DELETE', url: `/trips/${TRIP_ID}/expenses/${EXPENSE_ID}/refunds/${REFUND_ID}` },
    { method: 'POST', url: `/trips/${TRIP_ID}/guests`, payload: { name: 'Guest' } },
    { method: 'GET', url: `/trips/${TRIP_ID}/guests` },
    { method: 'PATCH', url: `/trips/${TRIP_ID}/guests/${GUEST_ID}`, payload: { name: 'Guest 2' } },
    { method: 'DELETE', url: `/trips/${TRIP_ID}/guests/${GUEST_ID}` },
    { method: 'POST', url: `/trips/${TRIP_ID}/settlements`, payload: { payerId: CALLER_ID, recipientId: OTHER_USER_ID, amountCents: 500, date: '2026-10-03' } },
    { method: 'PATCH', url: `/trips/${TRIP_ID}/settlements/${SETTLEMENT_ID}`, payload: { amountCents: 600 } },
    { method: 'DELETE', url: `/trips/${TRIP_ID}/settlements/${SETTLEMENT_ID}` },
    { method: 'GET', url: `/trips/${TRIP_ID}/expenses` },
    { method: 'GET', url: `/trips/${TRIP_ID}/balances` },
    { method: 'GET', url: `/trips/${TRIP_ID}/balances/${CALLER_ID}/drilldown` },
    { method: 'GET', url: `/trips/${TRIP_ID}/expenses/export` },
  ];

  for (const r of routes) {
    it(`denies non-member with 403 trip_forbidden on ${r.method} ${r.url}`, async () => {
      const res = await h.app.inject({
        method: r.method,
        url: r.url,
        payload: r.payload as any,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'trip_forbidden' } });
    });
  }
});

// ---------------------------------------------------------------------------
// Property 10: Adder-or-organizer authorization rule
// ---------------------------------------------------------------------------

describe('Property 10: Expense, Settlement, Refund, Guest adder-or-organizer rule', () => {
  it('forwards callerId and callerRole to repo on Expense edit & delete', async () => {
    const editSpy = vi.fn().mockResolvedValue(dummyExpense());
    const removeSpy = vi.fn().mockResolvedValue(undefined);
    const getSpy = vi.fn().mockResolvedValue(dummyExpense());

    const h = await buildApp({
      editExpense: editSpy,
      removeExpense: removeSpy,
      getExpense: getSpy,
      listTripGuests: async () => [],
    });
    h.setRole('organizer');

    const editRes = await h.app.inject({
      method: 'PATCH',
      url: `/trips/${TRIP_ID}/expenses/${EXPENSE_ID}`,
      payload: {
        payerId: CALLER_ID,
        amountCents: 3000,
        description: 'New description',
        date: '2026-10-04',
        splitMode: 'even',
        participantIds: [CALLER_ID, OTHER_USER_ID],
      },
    });
    expect(editRes.statusCode).toBe(200);
    expect(editSpy).toHaveBeenCalledWith(
      TRIP_ID,
      EXPENSE_ID,
      CALLER_ID,
      'organizer',
      expect.objectContaining({ description: 'New description' }),
    );

    const deleteRes = await h.app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/expenses/${EXPENSE_ID}`,
    });
    expect(deleteRes.statusCode).toBe(204);
    expect(removeSpy).toHaveBeenCalledWith(TRIP_ID, EXPENSE_ID, CALLER_ID, 'organizer');
  });

  it('forwards callerId and callerRole to repo on Refund edit & delete', async () => {
    const editSpy = vi.fn().mockResolvedValue(dummyRefund());
    const removeSpy = vi.fn().mockResolvedValue(undefined);

    const h = await buildApp({ editRefund: editSpy, removeRefund: removeSpy });
    h.setRole('member');

    const editRes = await h.app.inject({
      method: 'PATCH',
      url: `/trips/${TRIP_ID}/expenses/${EXPENSE_ID}/refunds/${REFUND_ID}`,
      payload: { amountCents: 300, date: '2026-10-02' },
    });
    expect(editRes.statusCode).toBe(200);
    expect(editSpy).toHaveBeenCalledWith(
      TRIP_ID,
      EXPENSE_ID,
      REFUND_ID,
      CALLER_ID,
      'member',
      { amountCents: 300, date: '2026-10-02' },
    );

    const delRes = await h.app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/expenses/${EXPENSE_ID}/refunds/${REFUND_ID}`,
    });
    expect(delRes.statusCode).toBe(204);
    expect(removeSpy).toHaveBeenCalledWith(TRIP_ID, EXPENSE_ID, REFUND_ID, CALLER_ID, 'member');
  });

  it('forwards callerId and callerRole to repo on Guest rename & delete', async () => {
    const editSpy = vi.fn().mockResolvedValue(dummyGuest());
    const removeSpy = vi.fn().mockResolvedValue(undefined);

    const h = await buildApp({ renameTripGuest: editSpy, removeTripGuest: removeSpy });
    h.setRole('member');

    const editRes = await h.app.inject({
      method: 'PATCH',
      url: `/trips/${TRIP_ID}/guests/${GUEST_ID}`,
      payload: { name: 'Renamed Guest' },
    });
    expect(editRes.statusCode).toBe(200);
    expect(editSpy).toHaveBeenCalledWith(
      TRIP_ID,
      GUEST_ID,
      CALLER_ID,
      'member',
      { name: 'Renamed Guest' },
    );

    const delRes = await h.app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/guests/${GUEST_ID}`,
    });
    expect(delRes.statusCode).toBe(204);
    expect(removeSpy).toHaveBeenCalledWith(TRIP_ID, GUEST_ID, CALLER_ID, 'member');
  });

  it('returns trip guests for member on GET /trips/:id/guests', async () => {
    const listSpy = vi.fn().mockResolvedValue([dummyGuest()]);
    const h = await buildApp({ listTripGuests: listSpy });
    h.setRole('member');

    const res = await h.app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/guests`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([dummyGuest()]);
    expect(listSpy).toHaveBeenCalledWith(TRIP_ID);
  });

  it('creates guest with explicit sponsorMemberId on POST /trips/:id/guests (Req 2.1)', async () => {
    const addSpy = vi.fn().mockResolvedValue(dummyGuest({ sponsorMemberId: OTHER_USER_ID }));
    const h = await buildApp({ addTripGuest: addSpy });
    h.setRole('member');

    const res = await h.app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/guests`,
      payload: { name: 'Oliver', sponsorMemberId: OTHER_USER_ID },
    });

    expect(res.statusCode).toBe(201);
    expect(addSpy).toHaveBeenCalledWith(TRIP_ID, OTHER_USER_ID, {
      name: 'Oliver',
      sponsorMemberId: OTHER_USER_ID,
    });
  });

  it('rejects POST /trips/:id/guests with non-member sponsor (Req 2.1)', async () => {
    const addSpy = vi.fn().mockResolvedValue(dummyGuest());
    const h = await buildApp({ addTripGuest: addSpy });
    h.setRole('member');

    const res = await h.app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/guests`,
      payload: { name: 'Oliver', sponsorMemberId: '99999999-9999-9999-9999-999999999999' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'trip_validation_failed' } });
    expect(addSpy).not.toHaveBeenCalled();
  });

  it('reassigns guest sponsor on PATCH /trips/:id/guests/:guestId (Req 2.11)', async () => {
    const editSpy = vi.fn().mockResolvedValue(dummyGuest({ sponsorMemberId: OTHER_USER_ID }));
    const h = await buildApp({ renameTripGuest: editSpy });
    h.setRole('member');

    const res = await h.app.inject({
      method: 'PATCH',
      url: `/trips/${TRIP_ID}/guests/${GUEST_ID}`,
      payload: { name: 'Oliver Updated', sponsorMemberId: OTHER_USER_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(editSpy).toHaveBeenCalledWith(
      TRIP_ID,
      GUEST_ID,
      CALLER_ID,
      'member',
      { name: 'Oliver Updated', sponsorMemberId: OTHER_USER_ID },
    );
  });

  it('rejects PATCH /trips/:id/guests/:guestId with non-member sponsor (Req 2.11)', async () => {
    const editSpy = vi.fn().mockResolvedValue(dummyGuest());
    const h = await buildApp({ renameTripGuest: editSpy });
    h.setRole('member');

    const res = await h.app.inject({
      method: 'PATCH',
      url: `/trips/${TRIP_ID}/guests/${GUEST_ID}`,
      payload: { name: 'Oliver Updated', sponsorMemberId: '99999999-9999-9999-9999-999999999999' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'trip_validation_failed' } });
    expect(editSpy).not.toHaveBeenCalled();
  });

  it('forwards callerId and callerRole to repo on Settlement edit & delete', async () => {
    const editSpy = vi.fn().mockResolvedValue(dummySettlement());
    const removeSpy = vi.fn().mockResolvedValue(undefined);

    const h = await buildApp({ editSettlement: editSpy, removeSettlement: removeSpy });
    h.setRole('organizer');

    const editRes = await h.app.inject({
      method: 'PATCH',
      url: `/trips/${TRIP_ID}/settlements/${SETTLEMENT_ID}`,
      payload: {
        payerId: CALLER_ID,
        recipientId: OTHER_USER_ID,
        amountCents: 2000,
        date: '2026-10-05',
      },
    });
    expect(editRes.statusCode).toBe(200);
    expect(editSpy).toHaveBeenCalledWith(
      TRIP_ID,
      SETTLEMENT_ID,
      CALLER_ID,
      'organizer',
      {
        payerId: CALLER_ID,
        recipientId: OTHER_USER_ID,
        amountCents: 2000,
        date: '2026-10-05',
      },
    );

    const delRes = await h.app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/settlements/${SETTLEMENT_ID}`,
    });
    expect(delRes.statusCode).toBe(204);
    expect(removeSpy).toHaveBeenCalledWith(TRIP_ID, SETTLEMENT_ID, CALLER_ID, 'organizer');
  });

  it('propagates trip_forbidden from repo when non-organizer non-creator attempts mutation', async () => {
    const h = await buildApp({
      editExpense: async () => {
        throw new AppError('trip_forbidden', 'Only creator or organizer may edit an expense');
      },
      getExpense: async () => dummyExpense(),
    });

    const res = await h.app.inject({
      method: 'PATCH',
      url: `/trips/${TRIP_ID}/expenses/${EXPENSE_ID}`,
      payload: {
        payerId: CALLER_ID,
        amountCents: 3000,
        description: 'Hacked',
        date: '2026-10-04',
        splitMode: 'even',
        participantIds: [CALLER_ID, OTHER_USER_ID],
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'trip_forbidden' } });
  });
});

// ---------------------------------------------------------------------------
// Happy-path create and validation-failure per Split_Mode
// ---------------------------------------------------------------------------

describe('Happy-path creation and validation-failure per Split_Mode', () => {
  it('creates exact mode expense', async () => {
    const createdExp = dummyExpense({
      splitMode: 'exact',
      amountCents: 1000,
      shares: [
        {
          id: '88888888-8888-8888-8888-888888888888',
          expenseId: EXPENSE_ID,
          memberId: OTHER_USER_ID,
          guestId: null,
          amountCents: 400,
        },
      ],
    });
    const createSpy = vi.fn().mockResolvedValue(createdExp);
    const h = await buildApp({
      createExpense: createSpy,
      listTripGuests: async () => [],
    });

    const res = await h.app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/expenses`,
      payload: {
        payerId: CALLER_ID,
        amountCents: 1000,
        description: 'Snacks',
        date: '2026-10-04',
        splitMode: 'exact',
        shares: [{ memberId: OTHER_USER_ID, amountCents: 400 }],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual(createdExp);
  });

  it('rejects exact mode expense with invalid shares', async () => {
    const h = await buildApp({ createExpense: async () => dummyExpense() });

    const res = await h.app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/expenses`,
      payload: {
        payerId: CALLER_ID,
        amountCents: 1000,
        description: 'Snacks',
        date: '2026-10-04',
        splitMode: 'exact',
        shares: [{ amountCents: -50 }], // missing memberId/guestId and negative cents
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'trip_validation_failed' } });
  });

  it('creates even mode expense', async () => {
    const createdExp = dummyExpense({ splitMode: 'even' });
    const createSpy = vi.fn().mockResolvedValue(createdExp);
    const h = await buildApp({
      createExpense: createSpy,
      listTripGuests: async () => [],
    });

    const res = await h.app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/expenses`,
      payload: {
        payerId: CALLER_ID,
        amountCents: 3000,
        description: 'Dinner',
        date: '2026-10-04',
        splitMode: 'even',
        participantIds: [CALLER_ID, OTHER_USER_ID],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual(createdExp);
  });

  it('rejects even mode expense with fewer than 2 participants', async () => {
    const h = await buildApp({ createExpense: async () => dummyExpense() });

    const res = await h.app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/expenses`,
      payload: {
        payerId: CALLER_ID,
        amountCents: 3000,
        description: 'Dinner',
        date: '2026-10-04',
        splitMode: 'even',
        participantIds: [CALLER_ID], // only 1 participant
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'trip_validation_failed' } });
  });

  it('creates tiered mode expense', async () => {
    const tierId = '99999999-9999-9999-9999-999999999999';
    const createdExp = dummyExpense({
      splitMode: 'tiered',
      tiers: [{ id: tierId, expenseId: EXPENSE_ID, name: 'Adult', priceCents: 5000 }],
    });
    const createSpy = vi.fn().mockResolvedValue(createdExp);
    const h = await buildApp({
      createExpense: createSpy,
      listTripGuests: async () => [],
    });

    const res = await h.app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/expenses`,
      payload: {
        payerId: CALLER_ID,
        amountCents: 5000,
        description: 'Tickets',
        date: '2026-10-04',
        splitMode: 'tiered',
        tiers: [{ id: tierId, name: 'Adult', priceCents: 5000 }],
        tierCounts: [{ tierId, memberId: OTHER_USER_ID, count: 1 }],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual(createdExp);
  });

  it('rejects tiered mode expense with empty tiers', async () => {
    const h = await buildApp({ createExpense: async () => dummyExpense() });

    const res = await h.app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/expenses`,
      payload: {
        payerId: CALLER_ID,
        amountCents: 5000,
        description: 'Tickets',
        date: '2026-10-04',
        splitMode: 'tiered',
        tiers: [], // empty tiers
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'trip_validation_failed' } });
  });

  it('creates itemized mode expense', async () => {
    const createdExp = dummyExpense({
      splitMode: 'itemized',
      items: [
        {
          id: '13131313-1313-1313-1313-131313131313',
          expenseId: EXPENSE_ID,
          name: 'Burger',
          priceCents: 1500,
          isAlcohol: false,
          assigneeIds: [OTHER_USER_ID],
        },
      ],
    });
    const createSpy = vi.fn().mockResolvedValue(createdExp);
    const h = await buildApp({
      createExpense: createSpy,
      listTripGuests: async () => [],
    });

    const res = await h.app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/expenses`,
      payload: {
        payerId: CALLER_ID,
        description: 'Lunch',
        date: '2026-10-04',
        splitMode: 'itemized',
        items: [
          {
            name: 'Burger',
            priceCents: 1500,
            assigneeIds: [OTHER_USER_ID],
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual(createdExp);
  });

  it('rejects itemized mode expense with invalid item price', async () => {
    const h = await buildApp({ createExpense: async () => dummyExpense() });

    const res = await h.app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/expenses`,
      payload: {
        payerId: CALLER_ID,
        description: 'Lunch',
        date: '2026-10-04',
        splitMode: 'itemized',
        items: [
          {
            name: 'Burger',
            priceCents: -500, // negative price
            assigneeIds: [OTHER_USER_ID],
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'trip_validation_failed' } });
  });
});

// ---------------------------------------------------------------------------
// Export route
// ---------------------------------------------------------------------------

describe('GET /trips/:id/expenses/export', () => {
  it('returns CSV with attachment headers', async () => {
    const csvContent = 'Date,Type,Description,Amount,Payer,Attribution,Notes\n2026-10-04,Expense,Dinner,30.00,User1,User2,\n';
    const h = await buildApp({
      exportLedgerCsv: vi.fn().mockResolvedValue(csvContent),
    });

    const res = await h.app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/expenses/export`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="trip-${TRIP_ID}-expenses.csv"`);
    expect(res.payload).toBe(csvContent);
  });
});

// ---------------------------------------------------------------------------
// Notification dispatch (emitExpenseAffected)
// ---------------------------------------------------------------------------

describe('emitExpenseAffected notification dispatch (Req 1.9, 1.10)', () => {
  it('fires on creation with affectedMemberIds', async () => {
    const createdExp = dummyExpense();
    const h = await buildApp({
      createExpense: async () => createdExp,
      listTripGuests: async () => [],
    });

    const res = await h.app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/expenses`,
      payload: {
        payerId: CALLER_ID,
        amountCents: 3000,
        description: 'Dinner',
        date: '2026-10-04',
        splitMode: 'even',
        participantIds: [CALLER_ID, OTHER_USER_ID],
      },
    });

    expect(res.statusCode).toBe(201);
    expect(h.emitSpy).toHaveBeenCalledTimes(1);
    expect(h.emitSpy).toHaveBeenCalledWith({
      expenseId: EXPENSE_ID,
      tripId: TRIP_ID,
      actorUserId: CALLER_ID,
      affectedMemberIds: [OTHER_USER_ID],
    });
  });

  it('fires on amount-changing edit with affectedMemberIds', async () => {
    const oldExp = dummyExpense({
      shares: [{ id: 's1', expenseId: EXPENSE_ID, memberId: OTHER_USER_ID, guestId: null, amountCents: 1500 }],
    });
    const updatedExp = dummyExpense({
      shares: [{ id: 's1', expenseId: EXPENSE_ID, memberId: OTHER_USER_ID, guestId: null, amountCents: 2000 }],
    });

    const h = await buildApp({
      getExpense: async () => oldExp,
      editExpense: async () => updatedExp,
      listTripGuests: async () => [],
    });

    const res = await h.app.inject({
      method: 'PATCH',
      url: `/trips/${TRIP_ID}/expenses/${EXPENSE_ID}`,
      payload: {
        payerId: CALLER_ID,
        amountCents: 4000,
        description: 'Dinner',
        date: '2026-10-04',
        splitMode: 'exact',
        shares: [{ memberId: OTHER_USER_ID, amountCents: 2000 }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(h.emitSpy).toHaveBeenCalledTimes(1);
    expect(h.emitSpy).toHaveBeenCalledWith({
      expenseId: EXPENSE_ID,
      tripId: TRIP_ID,
      actorUserId: CALLER_ID,
      affectedMemberIds: [OTHER_USER_ID],
    });
  });

  it('does NOT fire on an edit that changes nothing about who owes what', async () => {
    const exp = dummyExpense({
      shares: [{ id: 's1', expenseId: EXPENSE_ID, memberId: OTHER_USER_ID, guestId: null, amountCents: 1500 }],
    });

    const h = await buildApp({
      getExpense: async () => exp,
      editExpense: async () => ({ ...exp, description: 'Updated title only' }),
      listTripGuests: async () => [],
    });

    const res = await h.app.inject({
      method: 'PATCH',
      url: `/trips/${TRIP_ID}/expenses/${EXPENSE_ID}`,
      payload: {
        payerId: CALLER_ID,
        amountCents: 3000,
        description: 'Updated title only',
        date: '2026-10-04',
        splitMode: 'exact',
        shares: [{ memberId: OTHER_USER_ID, amountCents: 1500 }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(h.emitSpy).not.toHaveBeenCalled();
  });

  it('GET /trips/:id/balances/:memberId/drilldown passes counterpartyId query param to repo (Req 6.7)', async () => {
    let capturedCounterparty: string | undefined;
    const h = await buildApp({
      getBalanceDrillDown: async (_tripId, _memberId, counterpartyId) => {
        capturedCounterparty = counterpartyId;
        return [
          {
            kind: 'expense',
            sourceId: 'exp-1',
            description: 'Lunch',
            date: '2026-10-04',
            contributionCents: 1500,
          },
        ];
      },
    });

    const res = await h.app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/balances/${CALLER_ID}/drilldown?counterpartyId=${OTHER_USER_ID}`,
    });

    expect(res.statusCode).toBe(200);
    expect(capturedCounterparty).toBe(OTHER_USER_ID);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].contributionCents).toBe(1500);
  });
});

// ---------------------------------------------------------------------------
// Feed and Summary exclusion (Req 10.3 / Task 7.6)
// ---------------------------------------------------------------------------

describe('Requirement 10.3: Trip feed and summary do not contain expense/settlement/balance data', () => {
  it('GET /trips/:id/feed payload contains no expense data', async () => {
    const feedItem: TripFeedItemDTO = {
      id: 'feed-1',
      type: 'trip_created',
      createdAt: '2026-10-01T00:00:00.000Z',
      actorDisplayName: 'Alice',
      actorAvatarPreset: null,
      metadata: {},
      reactions: [],
      comments: [],
    } as any;

    const h = await buildApp({}, {
      getFeed: async () => [feedItem],
    });

    const res = await h.app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/feed`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toMatch(/splitMode|amountCents|chargeLines|netCents|settlement/i);
  });

  it('GET /trips/:id/summary payload contains no expense data', async () => {
    const summary: TripSummaryDTO = {
      trip: {
        id: TRIP_ID,
        name: 'Disney 2026',
        startDate: '2026-10-01',
        endDate: '2026-10-07',
        state: 'active',
        inviteCode: 'ABCDEF',
        inviteExpiresAt: '2026-10-08T00:00:00.000Z',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
      memberCount: 2,
      members: [
        { userId: CALLER_ID, displayName: 'Alice', role: 'organizer', joinedAt: '2026-09-01T00:00:00.000Z' },
        { userId: OTHER_USER_ID, displayName: 'Bob', role: 'member', joinedAt: '2026-09-02T00:00:00.000Z' },
      ],
      plannedItemsCount: 5,
      completedItemsCount: 2,
    } as any;

    const h = await buildApp({}, {
      getSummary: async () => summary,
    });

    const res = await h.app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/summary`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toMatch(/splitMode|amountCents|chargeLines|netCents|settlement/i);
  });
});
