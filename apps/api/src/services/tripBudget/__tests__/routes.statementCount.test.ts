/**
 * Round 5 M1: Whole-request statement count integration test (Task 15.3).
 *
 * Validates:
 * - GET /trips/:id/budget whole-request statement count through server.inject
 * - Real assertTripMember, real loadBudget, real ticketPrices repo, real lightningLane repo over pg-mem
 * - Counting proxy on pool.query and client.query
 * - 1 line vs 300 lines spread over ticket and LL keys: counts are EQUAL
 * - Common case is between 13 and BUDGET_READ_MAX_STATEMENTS (14)
 * - Interim organizer case costs exactly 1 more statement and is at most 14
 *
 * Validates: Requirements 1.2, 14.8, 18.2, 18.3, 18.4, Round 5 M1
 */

import { randomUUID } from 'node:crypto';
import Fastify, { type preHandlerHookHandler } from 'fastify';
import { describe, expect, it } from 'vitest';
import { BUDGET_READ_MAX_STATEMENTS } from '@dwt/shared';
import type { DbPool } from '../../../db/pool.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { createLightningLaneRepo } from '../../lightningLane/repo.js';
import { createTicketPricesRepo } from '../../ticketPrices/repo.js';
import { createTripBudgetRepo } from '../repo.js';
import { tripBudgetRoutes } from '../routes.js';
import { seedTestData, setupTestDb } from './testDb.js';

function createCountingPool(basePool: DbPool): {
  pool: DbPool;
  getCount: () => number;
  resetCount: () => number;
  queries: string[];
} {
  let count = 0;
  const queries: string[] = [];

  const pool = {
    async query(text: string, params?: ReadonlyArray<unknown>) {
      count++;
      queries.push(text.trim());
      return (basePool.query as any)(text, params as unknown[]);
    },
    async connect() {
      const client = await basePool.connect();
      return {
        async query(text: string, params?: ReadonlyArray<unknown>) {
          count++;
          queries.push(text.trim());
          return (client.query as any)(text, params as unknown[]);
        },
        release() {
          client.release();
        },
      };
    },
  } as unknown as DbPool;

  return {
    pool,
    getCount: () => count,
    resetCount: () => {
      const prev = count;
      count = 0;
      queries.length = 0;
      return prev;
    },
    queries,
  };
}

describe('Round 5 M1: Whole-request statement count (GET /budget)', () => {
  it('statement count is constant (13) for 1 line vs 300 lines spread over ticket and LL keys, and at most 14 for interim organizer', async () => {
    const { pool: basePool } = setupTestDb();
    const data = await seedTestData(basePool);

    // Initialize ticket_price_control and sets so ticket repo executes cleanly
    await basePool.query(
      `UPDATE ticket_price_control
       SET last_attempt_at = now(), updated_at = now()
       WHERE id = 1`,
    );
    await basePool.query(
      `INSERT INTO ticket_price_sets (discount_group, num_days, as_of, horizon_date, row_count, window_days)
       VALUES ('std-gst', 4, now(), '2026-12-31', 10, 30)`,
    );

    const counting = createCountingPool(basePool);
    const budgetRepo = createTripBudgetRepo(counting.pool);
    const ticketRepo = createTicketPricesRepo(counting.pool as any);
    const llRepo = createLightningLaneRepo(counting.pool as any);

    let activeCallerId = data.memberId;

    const dummyRequireSession: preHandlerHookHandler = async (request) => {
      (request as unknown as { userId: string }).userId = activeCallerId;
    };

    const server = Fastify();
    registerErrorHandler(server);

    await server.register(
      tripBudgetRoutes({
        pool: counting.pool,
        repo: budgetRepo,
        requireSession: dummyRequireSession,
        ticketPricesRepo: ticketRepo,
        lightningLaneRepo: llRepo,
        config: {
          ticketPrices: { enabled: false },
        },
      }),
    );

    await server.ready();

    // -------------------------------------------------------------------------
    // 1. Seed 1 ticket line + 1 LL line
    // -------------------------------------------------------------------------
    const ticketLineId = randomUUID();
    await basePool.query(
      `INSERT INTO trip_budget_lines (id, trip_id, category, description, created_by, price_source, price_ref)
       VALUES ($1, $2, 'tickets', '4-day Ticket', $3, 'disney_ticket_calendar',
               '{"kind":"ticket","discountGroup":"std-gst","numDays":4,"ageGroup":"adult","optionCode":"base","startDate":"2026-10-02"}'::jsonb)`,
      [ticketLineId, data.tripId, data.organizerId],
    );
    await basePool.query(
      `INSERT INTO trip_budget_allocations (id, line_id, member_id, amount_cents)
       VALUES ($1, $2, $3, 40000)`,
      [randomUUID(), ticketLineId, data.memberId],
    );

    const llLineId = randomUUID();
    await basePool.query(
      `INSERT INTO trip_budget_lines (id, trip_id, category, description, created_by, price_source, price_ref)
       VALUES ($1, $2, 'other', 'MK Multi Pass', $3, 'themeparks_ll',
               '{"kind":"ll","passType":"multi_pass","park":"Magic Kingdom","date":"2026-10-03"}'::jsonb)`,
      [llLineId, data.tripId, data.organizerId],
    );
    await basePool.query(
      `INSERT INTO trip_budget_allocations (id, line_id, member_id, amount_cents)
       VALUES ($1, $2, $3, 3500)`,
      [randomUUID(), llLineId, data.memberId],
    );

    // Measure request 1 (2 lines)
    counting.resetCount();
    const res1 = await server.inject({
      method: 'GET',
      url: `/trips/${data.tripId}/budget`,
    });
    expect(res1.statusCode).toBe(200);
    const count1 = counting.getCount();

    // Must be between 13 and BUDGET_READ_MAX_STATEMENTS (14)
    expect(count1).toBeGreaterThanOrEqual(13);
    expect(count1).toBeLessThanOrEqual(BUDGET_READ_MAX_STATEMENTS);
    expect(count1).toBe(13);

    // -------------------------------------------------------------------------
    // 2. Seed up to 300 lines spread over ticket, LL and dining
    // -------------------------------------------------------------------------
    for (let i = 3; i <= 300; i++) {
      const lid = randomUUID();
      const isTicket = i % 3 === 0;
      const isLL = i % 3 === 1;

      const pSource = isTicket
        ? 'disney_ticket_calendar'
        : isLL
          ? 'themeparks_ll'
          : 'user_entered';

      const pRef = isTicket
        ? '{"kind":"ticket","discountGroup":"std-gst","numDays":4,"ageGroup":"adult","optionCode":"base","startDate":"2026-10-02"}'
        : isLL
          ? '{"kind":"ll","passType":"multi_pass","park":"Magic Kingdom","date":"2026-10-03"}'
          : null;

      await basePool.query(
        `INSERT INTO trip_budget_lines (id, trip_id, category, description, created_by, price_source, price_ref)
         VALUES ($1, $2, 'other', 'Item ${i}', $3, $4, $5::jsonb)`,
        [lid, data.tripId, data.organizerId, pSource, pRef],
      );
      await basePool.query(
        `INSERT INTO trip_budget_allocations (id, line_id, member_id, amount_cents)
         VALUES ($1, $2, $3, 1000)`,
        [randomUUID(), lid, data.memberId],
      );
    }

    // Measure request 2 (300 lines)
    counting.resetCount();
    const res300 = await server.inject({
      method: 'GET',
      url: `/trips/${data.tripId}/budget`,
    });
    expect(res300.statusCode).toBe(200);
    const count300 = counting.getCount();

    // The two statement counts must be EQUAL!
    expect(count300).toBe(count1);
    expect(count300).toBe(13);

    // -------------------------------------------------------------------------
    // 3. Interim Organizer case (trip with no active organizer)
    // -------------------------------------------------------------------------
    // Mark the organizer as pending_deletion
    await basePool.query(
      `UPDATE users
       SET deletion_state = 'pending_deletion',
           deletion_requested_at = now(),
           scheduled_purge_at = now() + interval '30 days',
           placeholder_id = gen_random_uuid()
       WHERE id = $1`,
      [data.organizerId],
    );

    // Caller is data.memberId (who becomes interim organizer)
    activeCallerId = data.memberId;

    counting.resetCount();
    const resInterim = await server.inject({
      method: 'GET',
      url: `/trips/${data.tripId}/budget`,
    });
    expect(resInterim.statusCode).toBe(200);
    const countInterim = counting.getCount();

    // Interim organizer costs exactly 1 more statement for roster check
    expect(countInterim).toBe(count1 + 1);
    expect(countInterim).toBe(14);
    expect(countInterim).toBeLessThanOrEqual(BUDGET_READ_MAX_STATEMENTS);

    await server.close();
  });
});

