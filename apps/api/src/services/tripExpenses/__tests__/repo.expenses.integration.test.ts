import { describe, it, expect, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTripExpenseRepo } from '../repo.js';
import { setupTestDb, seedTestData, type SeedTestData } from './testDb.js';
import { AppError } from '../../../errors/AppError.js';
import { EXPENSE_LIMIT } from '@dwt/shared';

describe('TripExpenseRepo - Expenses', () => {
  let pool: Pool;
  let repo: ReturnType<typeof createTripExpenseRepo>;
  let seed: SeedTestData;

  beforeEach(async () => {
    const testDb = setupTestDb();
    pool = testDb.pool;
    repo = createTripExpenseRepo(pool);
    seed = await seedTestData(pool);
  });

  describe('createExpense - split modes', () => {
    it('creates an exact mode expense and reads back shares', async () => {
      const created = await repo.createExpense(seed.tripId, seed.user1Id, {
        payerId: seed.user1Id,
        amountCents: 5000,
        description: 'Snacks',
        date: '2026-10-02',
        splitMode: 'exact',
        shares: [
          { memberId: seed.user2Id, amountCents: 2000 },
          { memberId: seed.user3Id, amountCents: 3000 },
        ],
      });

      expect(created.amountCents).toBe(5000);
      expect(created.splitMode).toBe('exact');
      expect(created.shares).toHaveLength(2);

      // Payer's share is never stored
      const readBack = await repo.getExpense(seed.tripId, created.id);
      expect(readBack).not.toBeNull();
      expect(readBack?.shares).toHaveLength(2);
      expect(readBack?.shares.some((s) => s.memberId === seed.user1Id)).toBe(false);

      const sharesSum = readBack?.shares.reduce((acc, s) => acc + s.amountCents, 0);
      expect(sharesSum).toBe(5000);
    });

    it('creates an even mode expense with payer included (payer absorbs remainder)', async () => {
      // 1000 cents split 3 ways: Alice (payer), Bob, Carol
      // 1000 / 3 = 333 each for Bob & Carol, Alice absorbs remainder (1000 - 666 = 334)
      const created = await repo.createExpense(seed.tripId, seed.user1Id, {
        payerId: seed.user1Id,
        amountCents: 1000,
        description: 'Uber ride',
        date: '2026-10-03',
        splitMode: 'even',
        participantIds: [seed.user1Id, seed.user2Id, seed.user3Id],
      });

      expect(created.amountCents).toBe(1000);
      // Non-payer shares: Bob and Carol each get 333 cents
      expect(created.shares).toHaveLength(2);
      expect(created.shares[0]!.amountCents).toBe(333);
      expect(created.shares[1]!.amountCents).toBe(333);
      // Payer row is not stored
      expect(created.shares.some((s) => s.memberId === seed.user1Id)).toBe(false);
    });

    it('creates an even mode expense with payer excluded', async () => {
      // 1000 cents split 2 ways: Bob & Carol (payer Alice not participating)
      const created = await repo.createExpense(seed.tripId, seed.user1Id, {
        payerId: seed.user1Id,
        amountCents: 1000,
        description: 'Souvenir gift for friends',
        date: '2026-10-03',
        splitMode: 'even',
        participantIds: [seed.user2Id, seed.user3Id],
      });

      expect(created.amountCents).toBe(1000);
      expect(created.shares).toHaveLength(2);
      expect(created.shares[0]!.amountCents).toBe(500);
      expect(created.shares[1]!.amountCents).toBe(500);
    });

    it('creates a tiered mode expense and reads back tiers and tier counts', async () => {
      const created = await repo.createExpense(seed.tripId, seed.user1Id, {
        payerId: seed.user1Id,
        amountCents: 35000, // (2 * 10000) + (3 * 5000) = 20000 + 15000 = 35000
        description: 'Park tickets',
        date: '2026-10-04',
        splitMode: 'tiered',
        tiers: [
          { name: 'Adult', priceCents: 10000 },
          { name: 'Child', priceCents: 5000 },
        ],
        tierCounts: [
          { tierId: 'Adult', memberId: seed.user1Id, count: 1 },
          { tierId: 'Adult', memberId: seed.user2Id, count: 1 },
          { tierId: 'Child', memberId: seed.user2Id, count: 1 },
          { tierId: 'Child', guestId: seed.guestId, count: 2 },
        ],
      });

      expect(created.amountCents).toBe(35000);
      expect(created.tiers).toHaveLength(2);
      const tierCountsRes = await pool.query(
        `SELECT count(*)::int AS c FROM expense_tier_counts WHERE tier_id IN (SELECT id FROM expense_tiers WHERE expense_id = $1)`,
        [created.id],
      );
      expect(tierCountsRes.rows[0].c).toBe(4);

      // Bob share: 10000 + 5000 = 15000
      // Little Timmy (guest) share: 10000
      // Payer Alice share: 10000 (not stored in shares table)
      expect(created.shares).toHaveLength(2);
      const bobShare = created.shares.find((s) => s.memberId === seed.user2Id);
      const guestShare = created.shares.find((s) => s.guestId === seed.guestId);
      expect(bobShare?.amountCents).toBe(15000);
      expect(guestShare?.amountCents).toBe(10000);
    });

    it('creates an itemized mode expense with derived amount and charge lines', async () => {
      // Items:
      // Item 1: $20 (2000) -> Bob + Alice
      // Item 2: $30 (3000) -> Carol
      // Charge lines:
      // Tax: $5 (500)
      // Gratuity: $10 (1000)
      const created = await repo.createExpense(seed.tripId, seed.user1Id, {
        payerId: seed.user1Id,
        description: 'Table dinner',
        date: '2026-10-05',
        splitMode: 'itemized',
        items: [
          { name: 'Entree 1', priceCents: 2000, assigneeIds: [seed.user1Id, seed.user2Id] },
          { name: 'Entree 2', priceCents: 3000, assigneeIds: [seed.user3Id] },
        ],
        chargeLines: [
          { kind: 'tax', amountCents: 500 },
          { kind: 'gratuity', amountCents: 1000 },
        ],
      });

      // Total derived amount = 2000 + 3000 + 500 + 1000 = 6500
      expect(created.amountCents).toBe(6500);
      expect(created.items).toHaveLength(2);
      expect(created.chargeLines).toHaveLength(2);
      // Payer Alice is not stored in shares
      expect(created.shares.some((s) => s.memberId === seed.user1Id)).toBe(false);
      // Bob and Carol shares exist
      expect(created.shares).toHaveLength(2);
      const totalShares = created.shares.reduce((sum, s) => sum + s.amountCents, 0);
      // Total amount is 6500. Bob and Carol shares sum to 6500 - Alice portion.
      expect(totalShares).toBeGreaterThan(0);
    });
  });

  describe('EXPENSE_LIMIT cap', () => {
    it('enforces EXPENSE_LIMIT row cap', async () => {
      // Batch insert 1000 expenses into the trip
      const values: string[] = [];
      for (let i = 0; i < EXPENSE_LIMIT; i++) {
        values.push(`('${seed.tripId}', '${seed.user1Id}', '${seed.user1Id}', 100, 'Batch expense', '2026-10-01', 'exact')`);
      }
      await pool.query(
        `INSERT INTO expenses (trip_id, payer_id, created_by, amount_cents, description, expense_date, split_mode)
         VALUES ${values.join(', ')}`,
      );

      await expect(
        repo.createExpense(seed.tripId, seed.user1Id, {
          payerId: seed.user1Id,
          amountCents: 100,
          description: '1001th expense',
          date: '2026-10-02',
          splitMode: 'exact',
          shares: [{ memberId: seed.user2Id, amountCents: 100 }],
        }),
      ).rejects.toThrowError(AppError);
    });
  });

  describe('editExpense and Split_Mode-change reset', () => {
    it('clears previous child rows when switching Split_Mode from itemized to even', async () => {
      // 1. Create itemized expense
      const itemized = await repo.createExpense(seed.tripId, seed.user1Id, {
        payerId: seed.user1Id,
        description: 'Dinner to switch',
        date: '2026-10-02',
        splitMode: 'itemized',
        items: [
          { name: 'Burger', priceCents: 1500, assigneeIds: [seed.user2Id] },
        ],
        chargeLines: [{ kind: 'tax', amountCents: 150 }],
      });

      // Confirm child rows exist in DB
      const itemsBefore = await pool.query(`SELECT count(*)::int AS c FROM expense_items WHERE expense_id = $1`, [itemized.id]);
      const chargesBefore = await pool.query(`SELECT count(*)::int AS c FROM charge_lines WHERE expense_id = $1`, [itemized.id]);
      expect(itemsBefore.rows[0].c).toBe(1);
      expect(chargesBefore.rows[0].c).toBe(1);

      // 2. Edit to even mode
      const edited = await repo.editExpense(seed.tripId, itemized.id, seed.user1Id, 'organizer', {
        payerId: seed.user1Id,
        amountCents: 2000,
        description: 'Now an even split',
        date: '2026-10-02',
        splitMode: 'even',
        participantIds: [seed.user1Id, seed.user2Id],
      });

      expect(edited.splitMode).toBe('even');
      expect(edited.amountCents).toBe(2000);
      expect(edited.items).toEqual([]);
      expect(edited.chargeLines).toEqual([]);
      expect(edited.tiers).toEqual([]);

      // 3. Confirm items and chargeLines rows were deleted from database
      const itemsAfter = await pool.query(`SELECT count(*)::int AS c FROM expense_items WHERE expense_id = $1`, [itemized.id]);
      const chargesAfter = await pool.query(`SELECT count(*)::int AS c FROM charge_lines WHERE expense_id = $1`, [itemized.id]);
      expect(itemsAfter.rows[0].c).toBe(0);
      expect(chargesAfter.rows[0].c).toBe(0);
    });

    it('rejects edit by unauthorized user (not adder and not organizer)', async () => {
      // Alice (organizer) created
      const exp = await repo.createExpense(seed.tripId, seed.user1Id, {
        payerId: seed.user1Id,
        amountCents: 1000,
        description: 'Alice expense',
        date: '2026-10-02',
        splitMode: 'even',
        participantIds: [seed.user1Id, seed.user2Id],
      });

      // Bob is a member (not organizer, not creator)
      await expect(
        repo.editExpense(seed.tripId, exp.id, seed.user2Id, 'member', {
          payerId: seed.user1Id,
          amountCents: 1200,
          description: 'Hacked',
          date: '2026-10-02',
          splitMode: 'even',
          participantIds: [seed.user1Id, seed.user2Id],
        }),
      ).rejects.toThrowError(AppError);
    });
  });

  describe('removeExpense', () => {
    it('deletes expense and cascades child rows', async () => {
      const exp = await repo.createExpense(seed.tripId, seed.user1Id, {
        payerId: seed.user1Id,
        amountCents: 1000,
        description: 'To delete',
        date: '2026-10-02',
        splitMode: 'exact',
        shares: [{ memberId: seed.user2Id, amountCents: 1000 }],
      });

      await repo.removeExpense(seed.tripId, exp.id, seed.user1Id, 'organizer');

      const readBack = await repo.getExpense(seed.tripId, exp.id);
      expect(readBack).toBeNull();

      const sharesCount = await pool.query(`SELECT count(*)::int AS c FROM expense_shares WHERE expense_id = $1`, [exp.id]);
      expect(sharesCount.rows[0].c).toBe(0);
    });
  });

  describe('Catalog restaurant and resort link validation', () => {
    it('accepts valid restaurant experience', async () => {
      const exp = await repo.createExpense(seed.tripId, seed.user1Id, {
        payerId: seed.user1Id,
        amountCents: 2000,
        description: 'Be Our Guest dinner',
        date: '2026-10-02',
        splitMode: 'even',
        participantIds: [seed.user1Id, seed.user2Id],
        experienceId: seed.restaurantExperienceId,
      });

      expect(exp.experienceId).toBe(seed.restaurantExperienceId);
    });

    it('rejects non-restaurant experience (e.g. Ride)', async () => {
      await expect(
        repo.createExpense(seed.tripId, seed.user1Id, {
          payerId: seed.user1Id,
          amountCents: 2000,
          description: 'Space Mountain dinner?',
          date: '2026-10-02',
          splitMode: 'even',
          participantIds: [seed.user1Id, seed.user2Id],
          experienceId: seed.rideExperienceId,
        }),
      ).rejects.toThrowError(/restaurant/i);
    });

    it('rejects nonexistent experience', async () => {
      await expect(
        repo.createExpense(seed.tripId, seed.user1Id, {
          payerId: seed.user1Id,
          amountCents: 2000,
          description: 'Ghost restaurant',
          date: '2026-10-02',
          splitMode: 'even',
          participantIds: [seed.user1Id, seed.user2Id],
          experienceId: '00000000-0000-0000-0000-000000000000',
        }),
      ).rejects.toThrowError(/restaurant/i);
    });

    it('accepts valid resort', async () => {
      const exp = await repo.createExpense(seed.tripId, seed.user1Id, {
        payerId: seed.user1Id,
        amountCents: 2000,
        description: 'Contemporary Resort room service',
        date: '2026-10-02',
        splitMode: 'even',
        participantIds: [seed.user1Id, seed.user2Id],
        resortId: seed.resortId,
      });

      expect(exp.resortId).toBe(seed.resortId);
    });

    it('rejects nonexistent resort', async () => {
      await expect(
        repo.createExpense(seed.tripId, seed.user1Id, {
          payerId: seed.user1Id,
          amountCents: 2000,
          description: 'Mars Resort',
          date: '2026-10-02',
          splitMode: 'even',
          participantIds: [seed.user1Id, seed.user2Id],
          resortId: '00000000-0000-0000-0000-000000000000',
        }),
      ).rejects.toThrowError(/resort/i);
    });
  });
});
