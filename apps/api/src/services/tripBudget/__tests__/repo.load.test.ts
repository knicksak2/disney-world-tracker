import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DbPool } from '../../../db/pool.js';
import { createLightningLaneRepo } from '../../lightningLane/repo.js';
import { createTicketPricesRepo } from '../../ticketPrices/repo.js';
import { createTripBudgetRepo } from '../repo.js';
import { seedTestData, setupTestDb } from './testDb.js';

function createCountingPool(basePool: DbPool): { pool: DbPool; getCount: () => number; resetCount: () => number; queries: string[] } {
  let count = 0;
  const queries: string[] = [];

  const pool = {
    async query(text: string, params?: ReadonlyArray<unknown>) {
      count++;
      queries.push(text.trim());
      return basePool.query(text, params as unknown[]);
    },
    async connect() {
      const client = await basePool.connect();
      return {
        async query(text: string, params?: ReadonlyArray<unknown>) {
          count++;
          queries.push(text.trim());
          return client.query(text, params as unknown[]);
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

describe('TripBudgetRepo.loadBudget (pg-mem)', () => {
  it('loadBudget statement count is constant (exactly 7) for 1 line and for 300 lines', async () => {
    const { pool: basePool } = setupTestDb();
    const data = await seedTestData(basePool);
    const counting = createCountingPool(basePool);
    const repo = createTripBudgetRepo(counting.pool);

    // Seed 1 line with 1 allocation
    const lineId1 = randomUUID();
    await basePool.query(
      `INSERT INTO trip_budget_lines (id, trip_id, category, description, created_by, price_source)
       VALUES ($1, $2, 'lodging', 'Hotel 1', $3, 'user_entered')`,
      [lineId1, data.tripId, data.organizerId],
    );
    await basePool.query(
      `INSERT INTO trip_budget_allocations (id, line_id, member_id, amount_cents)
       VALUES ($1, $2, $3, 10000)`,
      [randomUUID(), lineId1, data.memberId],
    );

    counting.resetCount();
    const bundle1 = await repo.loadBudget(data.tripId);
    const countFor1 = counting.getCount();
    expect(countFor1).toBe(7);
    expect(bundle1.storedLines.length).toBe(1);

    // Seed up to 300 lines with allocations
    for (let i = 2; i <= 300; i++) {
      const lId = randomUUID();
      await basePool.query(
        `INSERT INTO trip_budget_lines (id, trip_id, category, description, created_by, price_source)
         VALUES ($1, $2, 'dining', 'Meal ${i}', $3, 'user_entered')`,
        [lId, data.tripId, data.organizerId],
      );
      await basePool.query(
        `INSERT INTO trip_budget_allocations (id, line_id, member_id, amount_cents)
         VALUES ($1, $2, $3, 500)`,
        [randomUUID(), lId, data.memberId],
      );
    }

    counting.resetCount();
    const bundle300 = await repo.loadBudget(data.tripId);
    const countFor300 = counting.getCount();
    expect(countFor300).toBe(7);
    expect(countFor300).toBe(countFor1);
    expect(bundle300.storedLines.length).toBe(300);
  });

  it('REAL ticketPrices repo readBook issues exactly 3 statements for 1 key and for 300 keys', async () => {
    const { pool: basePool } = setupTestDb();
    // Update control and seed set row so queries return real structures
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
    const ticketRepo = createTicketPricesRepo(counting.pool as any);

    // 1 key
    counting.resetCount();
    await ticketRepo.readBook(
      [{ discountGroup: 'std-gst', numDays: 4, ageGroup: 'adult', optionCode: 'base', park: 'mk' }],
      '2026-10-01',
    );
    const count1 = counting.getCount();
    expect(count1).toBe(3);

    // 300 keys spread over multiple groups, days, ages, options, and parks
    const keys300 = [];
    const groups = ['std-gst', 'fl-resident'] as const;
    const ages = ['adult', 'child'] as const;
    const options = ['base', 'park_hopper', 'park_hopper_plus', 'water_parks_sports'] as const;
    const parks = ['mk', 'ep', 'hs', 'ak', 'any'] as const;

    for (let i = 0; i < 300; i++) {
      keys300.push({
        discountGroup: groups[i % groups.length]!,
        numDays: (i % 10) + 1,
        ageGroup: ages[i % ages.length]!,
        optionCode: options[i % options.length]!,
        park: parks[i % parks.length]!,
      });
    }

    counting.resetCount();
    await ticketRepo.readBook(keys300, '2026-10-01');
    const count300 = counting.getCount();
    expect(count300).toBe(3);
    expect(count300).toBe(count1);
  });

  it('REAL lightningLane repo readBook issues exactly 2 statements for 1 key and for 300 keys', async () => {
    const { pool: basePool } = setupTestDb();
    const counting = createCountingPool(basePool);
    const llRepo = createLightningLaneRepo(counting.pool);

    // 1 key
    counting.resetCount();
    await llRepo.readBook(
      [{ kind: 'll', park: 'Magic Kingdom', date: '2026-10-05', passType: 'multi' }],
      '2026-10-01',
    );
    const count1 = counting.getCount();
    expect(count1).toBe(2);

    // 300 keys spread across parks, dates, pass types
    const parks = ['Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom'] as const;
    const passTypes = ['multi', 'premier', 'single'] as const;
    const keys300 = [];

    for (let i = 0; i < 300; i++) {
      const day = String((i % 28) + 1).padStart(2, '0');
      keys300.push({
        kind: 'll' as const,
        park: parks[i % parks.length]!,
        date: `2026-10-${day}`,
        passType: passTypes[i % passTypes.length]!,
        experienceId: passTypes[i % passTypes.length] === 'single' ? randomUUID() : undefined,
      });
    }

    counting.resetCount();
    await llRepo.readBook(keys300, '2026-10-01');
    const count300 = counting.getCount();
    expect(count300).toBe(2);
    expect(count300).toBe(count1);
  });

  it('actuals are net of refunds and calculated numerically from driver strings', async () => {
    const { pool: basePool } = setupTestDb();
    const data = await seedTestData(basePool);
    const repo = createTripBudgetRepo(basePool);

    // Seed an expense of $100 (10000 cents) and a refund of $20 (2000 cents)
    const expenseId = randomUUID();
    await basePool.query(
      `INSERT INTO expenses (id, trip_id, payer_id, created_by, category, description, expense_date, amount_cents, split_mode)
       VALUES ($1, $2, $3, $3, 'dining', 'Chef Mickey', '2026-10-02', 10000, 'even')`,
      [expenseId, data.tripId, data.memberId],
    );
    await basePool.query(
      `INSERT INTO expense_refunds (id, expense_id, created_by, refund_date, amount_cents)
       VALUES ($1, $2, $3, '2026-10-03', 2000)`,
      [randomUUID(), expenseId, data.memberId],
    );

    const bundle = await repo.loadBudget(data.tripId);
    expect(typeof bundle.vsActualByExpenseCategory.dining).toBe('number');
    expect(bundle.vsActualByExpenseCategory.dining).toBe(8000); // 10000 - 2000

    // Test with a recording fake pool that returns vsActual rows as strings ({ category: 'dining', actual_cents: '12345' })
    const fakePool = {
      async query(text: string, params?: ReadonlyArray<unknown>) {
        if (text.includes('FROM trips WHERE id = $1')) {
          return { rows: [{ start_date: '2026-10-01', end_date: '2026-10-10', day_touring_hours: null }] };
        }
        if (text.includes('FROM trip_budget_lines')) {
          return { rows: [] };
        }
        if (text.includes('FROM trip_budget_allocations')) {
          return { rows: [] };
        }
        if (text.includes('FROM trip_traveler_profiles')) {
          return { rows: [] };
        }
        if (text.includes('FROM trip_budget_settings')) {
          return { rows: [] };
        }
        if (text.includes('FROM profile_identity')) {
          return { rows: [] };
        }
        if (text.includes('FROM trip_guests')) {
          return { rows: [] };
        }
        if (text.includes('FROM (') && text.includes('expenses')) {
          // Return string-typed numeric from PostgreSQL driver
          return {
            rows: [
              { category: 'dining', actual_cents: '12345' },
              { category: 'hotel', actual_cents: '50000' },
            ],
          };
        }
        return basePool.query(text, params as unknown[]);
      },
    } as unknown as DbPool;

    const fakeRepo = createTripBudgetRepo(fakePool);
    const fakeBundle = await fakeRepo.loadBudget(data.tripId);
    expect(typeof fakeBundle.vsActualByExpenseCategory.dining).toBe('number');
    expect(fakeBundle.vsActualByExpenseCategory.dining).toBe(12345);
    expect(typeof fakeBundle.vsActualByExpenseCategory.hotel).toBe('number');
    expect(fakeBundle.vsActualByExpenseCategory.hotel).toBe(50000);
  });

  it('budget tables are untouched by loadBudget (Property 17 and 26 database half)', async () => {
    const { pool: basePool } = setupTestDb();
    const data = await seedTestData(basePool);
    const counting = createCountingPool(basePool);
    const repo = createTripBudgetRepo(counting.pool);

    await repo.loadBudget(data.tripId);

    const mutatingQueries = counting.queries.filter((q) =>
      /^(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i.test(q),
    );
    expect(mutatingQueries).toEqual([]);
  });

  it('seeded pending_deletion member produces "Deleted user" in person labels while traveler profile is omitted (review F4, Property 41)', async () => {
    const { pool: basePool } = setupTestDb();
    const data = await seedTestData(basePool);
    const repo = createTripBudgetRepo(basePool);

    // Mark member as pending_deletion
    await basePool.query(
      `UPDATE users
       SET deletion_state = 'pending_deletion',
           deletion_requested_at = now(),
           scheduled_purge_at = now() + interval '30 days',
           placeholder_id = gen_random_uuid()
       WHERE id = $1`,
      [data.memberId],
    );

    // Insert traveler profile for pending_deletion member
    await basePool.query(
      `INSERT INTO trip_traveler_profiles (id, trip_id, member_id, age_bracket, ticket_days, discount_group, pass_type)
       VALUES ($1, $2, $3, 'adult', 4, 'std-gst', 'none')`,
      [randomUUID(), data.tripId, data.memberId],
    );

    // Insert a line and allocation for this member
    const lineId = randomUUID();
    await basePool.query(
      `INSERT INTO trip_budget_lines (id, trip_id, category, description, created_by, price_source)
       VALUES ($1, $2, 'tickets', 'Park Tickets', $3, 'user_entered')`,
      [lineId, data.tripId, data.organizerId],
    );
    await basePool.query(
      `INSERT INTO trip_budget_allocations (id, line_id, member_id, amount_cents)
       VALUES ($1, $2, $3, 20000)`,
      [randomUUID(), lineId, data.memberId],
    );

    const bundle = await repo.loadBudget(data.tripId);

    // 1. Travelers profile is omitted (review F4)
    const foundProfile = bundle.travelers.find((t) => t.memberId === data.memberId);
    expect(foundProfile).toBeUndefined();

    // 2. Person label is "Deleted user" with deleted: true
    const person = bundle.people.get(`m:${data.memberId}`);
    expect(person).toBeDefined();
    expect(person?.label).toBe('Deleted user');
    expect(person?.deleted).toBe(true);
  });
});
