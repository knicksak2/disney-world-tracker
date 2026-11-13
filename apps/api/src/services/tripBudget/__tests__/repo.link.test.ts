/**
 * Tests for TripBudgetRepo.linkExpense (trip-budget task 22.1).
 *
 * // Feature: trip-budget, Property 51: Logging a Budget_Line as an Expense pre-fills faithfully and links softly
 * // Feature: trip-budget, Property 31: Budget and Expenses stay separate
 * Validates: Requirements 17.3, 17.4, 17.5, 23.5, 23.6, 23.7, 23.8
 *
 * Runs the real SQL against pg-mem and reads `linked_expense_id` back, so a bug in the
 * UPDATE (wrong WHERE, dropped column) fails here and not just in a mocked-repo test.
 */

import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { createTripBudgetRepo, type TripBudgetRepo } from '../repo.js';
import { seedTestData, setupTestDb, type SeedTestData } from './testDb.js';

const EXPENSE_TABLES = [
  'expenses',
  'expense_shares',
  'expense_tiers',
  'expense_items',
  'charge_lines',
  'settlements',
  'expense_refunds',
];

async function linkedIdOf(pool: DbPool, lineId: string): Promise<string | null> {
  const res = await pool.query<{ linked_expense_id: string | null }>(
    'SELECT linked_expense_id FROM trip_budget_lines WHERE id = $1',
    [lineId],
  );
  return res.rows[0]?.linked_expense_id ?? null;
}

async function expectAppError(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
    return;
  }
  throw new Error(`expected AppError(${code}) but the call resolved`);
}

describe('TripBudgetRepo.linkExpense (Requirement 23)', () => {
  let pool: DbPool;
  let repo: TripBudgetRepo;
  let seed: SeedTestData;
  let lineId: string;
  let expenseA: string;
  let expenseB: string;
  let otherTripExpense: string;

  async function insertExpense(tripId: string, description: string): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO expenses (id, trip_id, payer_id, created_by, amount_cents, description, expense_date, split_mode)
       VALUES ($1, $2, $3, $3, 10000, $4, '2026-10-02', 'even')`,
      [id, tripId, seed.organizerId, description],
    );
    return id;
  }

  beforeEach(async () => {
    const testDb = setupTestDb();
    pool = testDb.pool;
    repo = createTripBudgetRepo(pool);
    seed = await seedTestData(pool);

    const line = await repo.createLine(seed.tripId, seed.organizerId, {
      category: 'dining',
      description: 'Dinner at Be Our Guest',
      priceSource: 'user_entered',
      allocations: [
        { memberId: seed.organizerId, amountCents: 5000 },
        { memberId: seed.memberId, amountCents: 5000 },
      ],
    });
    lineId = line.id;
    expenseA = await insertExpense(seed.tripId, 'Dinner A');
    expenseB = await insertExpense(seed.tripId, 'Dinner B');
    otherTripExpense = await insertExpense(seed.otherTripId, 'Other trip dinner');
  });

  it('stores the Expense id on the line and the Budget read-back returns it', async () => {
    expect(await linkedIdOf(pool, lineId)).toBeNull();

    await repo.linkExpense(seed.tripId, lineId, expenseA);

    expect(await linkedIdOf(pool, lineId)).toBe(expenseA);
    const bundle = await repo.loadBudget(seed.tripId);
    expect(bundle.storedLines.find((l) => l.id === lineId)?.linkedExpenseId).toBe(expenseA);
  });

  it('is a no-op when the same Expense is linked twice', async () => {
    await repo.linkExpense(seed.tripId, lineId, expenseA);
    await expect(repo.linkExpense(seed.tripId, lineId, expenseA)).resolves.toBeUndefined();
    expect(await linkedIdOf(pool, lineId)).toBe(expenseA);
  });

  it('rejects a different Expense on an already linked line and keeps the first link', async () => {
    await repo.linkExpense(seed.tripId, lineId, expenseA);

    await expectAppError(repo.linkExpense(seed.tripId, lineId, expenseB), 'trip_validation_failed');

    expect(await linkedIdOf(pool, lineId)).toBe(expenseA);
  });

  it('rejects an Expense that belongs to another Trip and leaves the line unlinked', async () => {
    await expectAppError(repo.linkExpense(seed.tripId, lineId, otherTripExpense), 'trip_validation_failed');
    expect(await linkedIdOf(pool, lineId)).toBeNull();
  });

  it('rejects an Expense id that does not exist', async () => {
    await expectAppError(repo.linkExpense(seed.tripId, lineId, randomUUID()), 'trip_validation_failed');
    expect(await linkedIdOf(pool, lineId)).toBeNull();
  });

  it('answers trip_not_found for a line that is on another Trip', async () => {
    await expectAppError(repo.linkExpense(seed.otherTripId, lineId, otherTripExpense), 'trip_not_found');
    expect(await linkedIdOf(pool, lineId)).toBeNull();
  });

  it('answers trip_not_found for an unknown line', async () => {
    await expectAppError(repo.linkExpense(seed.tripId, randomUUID(), expenseA), 'trip_not_found');
  });

  it('writes only trip_budget_lines and never an Expense table (Requirement 23.8, Property 31)', async () => {
    const statements: string[] = [];
    const recording = {
      async query(text: string, params?: ReadonlyArray<unknown>) {
        statements.push(text);
        return (pool.query as any)(text, params as unknown[]);
      },
      async connect() {
        const client = await pool.connect();
        return {
          async query(text: string, params?: ReadonlyArray<unknown>) {
            statements.push(text);
            return (client.query as any)(text, params as unknown[]);
          },
          release() {
            client.release();
          },
        };
      },
    } as unknown as DbPool;

    await createTripBudgetRepo(recording).linkExpense(seed.tripId, lineId, expenseA);

    const writes = statements.filter((s) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(s));
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) {
      for (const table of EXPENSE_TABLES) {
        expect(w).not.toMatch(new RegExp(`\\b(INTO|UPDATE|FROM)\\s+${table}\\b`, 'i'));
      }
      expect(w).toMatch(/trip_budget_lines/);
    }
  });

  it('the line becomes unlinked again when the Expense is deleted (Requirement 17.4 / 23.11)', async () => {
    await repo.linkExpense(seed.tripId, lineId, expenseA);
    expect(await linkedIdOf(pool, lineId)).toBe(expenseA);

    await pool.query('DELETE FROM expenses WHERE id = $1', [expenseA]);

    expect(await linkedIdOf(pool, lineId)).toBeNull();
    // and it can be linked again to a new Expense
    await repo.linkExpense(seed.tripId, lineId, expenseB);
    expect(await linkedIdOf(pool, lineId)).toBe(expenseB);
  });
});
