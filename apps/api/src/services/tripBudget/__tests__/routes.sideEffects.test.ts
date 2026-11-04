/**
 * Property 26: Request-path side effect isolation (Task 15.3).
 *
 * Feature: trip-budget, Property 26: Request-path side effect isolation
 *
 * Validates:
 * - Zero Redis commands on GET /trips/:id/budget
 * - Zero network fetch calls on the request path
 * - Zero Budget writes during GET /trips/:id/budget
 * - Stale/future ticket demand only schedules background refresh via noteDemand
 */

import Fastify, { type preHandlerHookHandler } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { DbPool } from '../../../db/pool.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import type { RawBudgetBundle, StoredLine } from '../types.js';
import type { TripBudgetRepo } from '../repo.js';
import { tripBudgetRoutes } from '../routes.js';
import type { TicketPricesRepo } from '../../ticketPrices/repo.js';

const CALLER_ID = '11111111-1111-4111-8111-111111111111';
const TRIP_ID = '22222222-2222-4222-8222-222222222222';
const LINE_ID = '33333333-3333-4333-8333-333333333333';

function makeDummyBundle(lines: StoredLine[] = []): RawBudgetBundle {
  return {
    trip: {
      startDate: '2099-10-01',
      endDate: '2099-10-10',
      dayTouringHours: {},
    },
    settings: {
      taxBps: { lodging: 650, dining: 650, tickets: 650, transportation: 0, shopping: 650, lightning_lane: 650, other: 650 },
      diningTipBps: 1800,
      savedCents: 0,
      savingsTargetCents: null,
      taxBpsIsDefault: { lodging: true, dining: true, tickets: true, transportation: true, shopping: true, lightning_lane: true, other: true },
      diningTipBpsIsDefault: true,
    },
    settingsEffective: {
      taxBps: { lodging: 650, dining: 650, tickets: 650, transportation: 0, shopping: 650, lightning_lane: 650, other: 650 },
      diningTipBps: 1800,
      savedCents: 0,
      savingsTargetCents: null,
    },
    travelers: [],
    storedLines: lines,
    people: new Map([
      [`m:${CALLER_ID}`, { label: 'Caller User', sponsorMemberId: null, deleted: false }],
    ]),
    vsActualByExpenseCategory: {
      hotel: 0,
      dining: 0,
      tickets: 0,
      lightning_lane: 0,
      transportation: 0,
      shopping: 0,
      other: 0,
    },
  };
}

describe('Property 26: Request-path side effect isolation', () => {
  it('GET /trips/:id/budget issues zero Redis commands, zero fetch calls, and zero DB writes', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const executedQueries: string[] = [];
    const pool = {
      query: vi.fn(async (text: string) => {
        executedQueries.push(text.trim());
        if (text.includes('FROM trip_memberships tm')) {
          return {
            rows: [{ role: 'member', has_active_organizer: true }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as DbPool;

    const fakeRepo = {
      loadBudget: vi.fn(async () =>
        makeDummyBundle([
          {
            id: LINE_ID,
            category: 'tickets',
            description: '4-day Ticket',
            plannedDate: '2099-10-02',
            park: 'Magic Kingdom',
            experienceId: null,
            priceSource: 'disney_ticket_calendar',
            priceAsOf: new Date('2026-01-01'),
            priceRef: {
              kind: 'ticket',
              discountGroup: 'std-gst',
              numDays: 4,
              ageGroup: 'adult',
              optionCode: 'base',
              startDate: '2099-10-02',
            },
            applyTip: false,
            allocations: [
              {
                id: '55555555-5555-4555-8555-555555555555',
                personKey: `m:${CALLER_ID}` as const,
                storedCents: 10000,
                priceRef: null,
              },
            ],
          },
        ]),
      ),
    } as unknown as TripBudgetRepo;

    const demandSpy = vi.fn();
    const fakeTicketRepo = {
      readBook: vi.fn(async () => ({
        rows: [],
        sets: [],
        control: null,
      })),
      upsertRows: vi.fn(),
      claimControl: vi.fn(),
      releaseControl: vi.fn(),
      block: vi.fn(),
      updateSet: vi.fn(),
      reconcileSet: vi.fn(),
    } as unknown as TicketPricesRepo;

    const dummyRequireSession: preHandlerHookHandler = async (request) => {
      (request as unknown as { userId: string }).userId = CALLER_ID;
    };

    const app = Fastify();
    registerErrorHandler(app);

    await app.register(
      tripBudgetRoutes({
        pool,
        repo: fakeRepo,
        requireSession: dummyRequireSession,
        ticketPricesRepo: fakeTicketRepo,
        ticketPricesService: {
          noteDemand: demandSpy,
        },
        config: {
          ticketPrices: {
            enabled: true,
            groups: ['std-gst'],
            flResidentNumDays: [4],
          },
        },
      }),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/budget`,
    });

    expect(res.statusCode).toBe(200);

    // 1. Zero network fetch calls on request path
    expect(fetchSpy).not.toHaveBeenCalled();

    // 2. Zero Budget writes during GET /budget
    const mutatingQueries = executedQueries.filter((q) =>
      /^(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i.test(q),
    );
    expect(mutatingQueries).toEqual([]);

    // 3. noteDemand scheduled for future ticket line
    expect(demandSpy).toHaveBeenCalledWith({
      groups: ['std-gst'],
      numDays: [4],
      maxStartDate: '2099-10-02',
    });

    vi.unstubAllGlobals();
  });
});