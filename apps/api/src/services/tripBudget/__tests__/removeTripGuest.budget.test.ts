/**
 * Feature: trip-budget, Property 25 / trip-expenses Requirement 2.13, Property 17
 *
 * Tests:
 * - removeTripGuest rejects with trip_validation_failed while a budget allocation references the guest
 * - removeTripGuest succeeds when only a traveler profile references the guest (profile cascades with guest)
 * - Sequential form: insert allocation -> removeTripGuest throws -> guest and allocation still exist
 * - tripBudgetRepo inserts that violate guest FK throw trip_validation_failed (never 500 / driver error)
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { createTripExpenseRepo } from '../../tripExpenses/repo.js';
import { createTripBudgetRepo } from '../repo.js';
import { seedTestData, setupTestDb } from './testDb.js';

describe('removeTripGuest budget reference checks (pg-mem)', () => {
  it('rejects with trip_validation_failed while an allocation references the guest (Property 25)', async () => {
    const { pool } = setupTestDb();
    const data = await seedTestData(pool);
    const expensesRepo = createTripExpenseRepo(pool);

    // Create a budget line and an allocation referencing data.guestId
    const lineId = randomUUID();
    const allocId = randomUUID();
    await pool.query(
      `INSERT INTO trip_budget_lines (id, trip_id, category, description, created_by, price_source)
       VALUES ($1, $2, 'dining', 'Lunch', $3, 'user_entered')`,
      [lineId, data.tripId, data.organizerId],
    );
    await pool.query(
      `INSERT INTO trip_budget_allocations (id, line_id, guest_id, amount_cents)
       VALUES ($1, $2, $3, 3000)`,
      [allocId, lineId, data.guestId],
    );

    // Attempt to remove guest
    await expect(
      expensesRepo.removeTripGuest(data.tripId, data.guestId, data.memberId, 'member'),
    ).rejects.toThrow(
      new AppError('trip_validation_failed', 'Cannot remove guest with recorded expense shares or assignments'),
    );

    // Verify guest still exists and allocation still exists
    const guestRes = await pool.query('SELECT id FROM trip_guests WHERE id = $1', [data.guestId]);
    expect(guestRes.rows.length).toBe(1);

    const allocRes = await pool.query('SELECT id FROM trip_budget_allocations WHERE id = $1', [allocId]);
    expect(allocRes.rows.length).toBe(1);
  });

  it('permits guest removal when only a traveler profile references the guest (cascades profile)', async () => {
    const { pool } = setupTestDb();
    const data = await seedTestData(pool);
    const expensesRepo = createTripExpenseRepo(pool);

    // Create a traveler profile referencing data.guestId
    const profileId = randomUUID();
    await pool.query(
      `INSERT INTO trip_traveler_profiles (id, trip_id, guest_id, age_bracket, ticket_days, discount_group, pass_type)
       VALUES ($1, $2, $3, 'child', 3, 'std-gst', 'none')`,
      [profileId, data.tripId, data.guestId],
    );

    // Guest removal should succeed
    await expect(
      expensesRepo.removeTripGuest(data.tripId, data.guestId, data.memberId, 'member'),
    ).resolves.toBeUndefined();

    // Verify guest is deleted
    const guestRes = await pool.query('SELECT id FROM trip_guests WHERE id = $1', [data.guestId]);
    expect(guestRes.rows.length).toBe(0);

    // Verify profile was cascaded
    const profRes = await pool.query('SELECT id FROM trip_traveler_profiles WHERE id = $1', [profileId]);
    expect(profRes.rows.length).toBe(0);
  });

  it('maps FK violation 23503 on deleted guest to trip_validation_failed in tripBudget repo', async () => {
    const { pool } = setupTestDb();
    const data = await seedTestData(pool);
    const budgetRepo = createTripBudgetRepo(pool);
    const ghostGuestId = randomUUID(); // not present in trip_guests

    // 1. upsertProfile with missing guestId
    await expect(
      budgetRepo.upsertProfile(data.tripId, data.organizerId, 'organizer', {
        guestId: ghostGuestId,
        ageBracket: 'adult',
        ticketOption: 'base',
        ticketDays: 3,
        ticketStartDate: null,
        discountGroup: 'std-gst',
        passType: 'none',
      }),
    ).rejects.toMatchObject({
      code: 'trip_validation_failed',
    });

    // 2. createLine with missing guestId
    await expect(
      budgetRepo.createLine(
        data.tripId,
        data.organizerId,
        {
          category: 'other',
          priceSource: 'user_entered',
          description: 'Tour',
          plannedDate: null,
          park: null,
          experienceId: null,
          applyTip: false,
          linkedExpenseId: null,
          priceRef: null,
          allocations: [
            { guestId: ghostGuestId, amountCents: 1000 },
          ],
        },
        { effectivePriceSource: 'user_entered', amounts: [1000] },
      ),
    ).rejects.toMatchObject({
      code: 'trip_validation_failed',
    });

    // 3. Simulated PostgreSQL 23503 on insert
    const fakeClient = {
      async query(text: string, params?: ReadonlyArray<unknown>) {
        if (text.startsWith('INSERT INTO trip_traveler_profiles') || text.startsWith('INSERT INTO trip_budget_lines')) {
          const err = new Error('foreign key violation') as any;
          err.code = '23503';
          throw err;
        }
        return pool.query(text, params as unknown[]);
      },
      release() {},
    };
    const fakePool = {
      query: (t: string, p?: ReadonlyArray<unknown>) => fakeClient.query(t, p as unknown[]),
      connect: async () => fakeClient,
    } as unknown as DbPool;
    const fakeBudgetRepo = createTripBudgetRepo(fakePool);

    await expect(
      fakeBudgetRepo.upsertProfile(data.tripId, data.organizerId, 'organizer', {
        guestId: data.guestId,
        ageBracket: 'adult',
        ticketOption: 'base',
        ticketDays: 3,
        ticketStartDate: null,
        discountGroup: 'std-gst',
        passType: 'none',
      }),
    ).rejects.toThrow(
      new AppError('trip_validation_failed', 'Referenced person does not exist'),
    );
  });
});