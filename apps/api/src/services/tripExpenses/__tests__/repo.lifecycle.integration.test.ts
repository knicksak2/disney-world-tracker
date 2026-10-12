import { describe, it, expect, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTripExpenseRepo } from '../repo.js';
import { setupTestDb, seedTestData, type SeedTestData } from './testDb.js';

describe('TripExpenseRepo - Lifecycle & Export', () => {
  let pool: Pool;
  let repo: ReturnType<typeof createTripExpenseRepo>;
  let seed: SeedTestData;

  beforeEach(async () => {
    const testDb = setupTestDb();
    pool = testDb.pool;
    repo = createTripExpenseRepo(pool);
    seed = await seedTestData(pool);
  });

  describe('Requirement 8.5: Member departure preserves ledger records', () => {
    it('preserves expenses, shares, and settlements when a member departs trip_memberships', async () => {
      // 1. Bob (user2) creates an expense
      const exp = await repo.createExpense(seed.tripId, seed.user2Id, {
        payerId: seed.user2Id,
        amountCents: 6000,
        description: 'Bob snacks',
        date: '2026-10-02',
        splitMode: 'exact',
        shares: [
          { memberId: seed.user1Id, amountCents: 2000 },
          { memberId: seed.user3Id, amountCents: 4000 },
        ],
      });

      // 2. Bob creates a settlement to Alice
      const set = await repo.createSettlement(seed.tripId, seed.user2Id, {
        payerId: seed.user2Id,
        recipientId: seed.user1Id,
        amountCents: 1500,
        date: '2026-10-03',
      });

      // 3. Bob leaves the trip (deleted from trip_memberships)
      await pool.query(
        `DELETE FROM trip_memberships WHERE trip_id = $1 AND user_id = $2`,
        [seed.tripId, seed.user2Id],
      );

      // Verify trip_membership is gone
      const memRes = await pool.query(
        `SELECT 1 FROM trip_memberships WHERE trip_id = $1 AND user_id = $2`,
        [seed.tripId, seed.user2Id],
      );
      expect(memRes.rowCount).toBe(0);

      // Verify the expense is STILL present
      const expRes = await pool.query(
        `SELECT id, payer_id, amount_cents FROM expenses WHERE id = $1`,
        [exp.id],
      );
      expect(expRes.rowCount).toBe(1);
      expect(expRes.rows[0].payer_id).toBe(seed.user2Id);

      // Verify the shares are STILL present
      const sharesRes = await pool.query(
        `SELECT id FROM expense_shares WHERE expense_id = $1`,
        [exp.id],
      );
      expect(sharesRes.rowCount).toBe(2);

      // Verify the settlement is STILL present
      const setRes = await pool.query(
        `SELECT id, payer_id FROM settlements WHERE id = $1`,
        [set.id],
      );
      expect(setRes.rowCount).toBe(1);
      expect(setRes.rows[0].payer_id).toBe(seed.user2Id);
    });
  });

  describe('Requirement 8.6: Trip deletion cascades to all expense entities', () => {
    it('cascades deletion of a trip across all 11 trip expense tables', async () => {
      // Create guest
      const guest = await repo.addTripGuest(seed.tripId, seed.user1Id, { name: 'Cascade Guest' });

      // Create itemized expense with items, charge lines, and guest assignee
      const exp = await repo.createExpense(seed.tripId, seed.user1Id, {
        payerId: seed.user1Id,
        description: 'Big Banquet',
        date: '2026-10-02',
        splitMode: 'itemized',
        items: [
          { name: 'Feast', priceCents: 10000, assigneeIds: [seed.user1Id, guest.id] },
        ],
        chargeLines: [{ kind: 'tax', amountCents: 1000 }],
      });

      // Create tiered expense
      await repo.createExpense(seed.tripId, seed.user1Id, {
        payerId: seed.user1Id,
        amountCents: 5000,
        description: 'Tiered Activity',
        date: '2026-10-02',
        splitMode: 'tiered',
        tiers: [{ name: 'Pass', priceCents: 5000 }],
        tierCounts: [{ tierId: 'Pass', guestId: guest.id, count: 1 }],
      });

      // Create refund
      await repo.createRefund(seed.tripId, exp.id, seed.user1Id, 'organizer', {
        amountCents: 2000,
        date: '2026-10-03',
      });

      // Create settlement
      await repo.createSettlement(seed.tripId, seed.user2Id, {
        payerId: seed.user2Id,
        recipientId: seed.user1Id,
        amountCents: 1000,
        date: '2026-10-03',
      });

      // Verify rows exist before delete
      const tables = [
        'trip_guests',
        'expenses',
        'expense_shares',
        'expense_tiers',
        'expense_tier_counts',
        'expense_items',
        'expense_item_assignees',
        'charge_lines',
        'expense_refunds',
        'settlements',
      ];

      for (const t of tables) {
        const countBefore = await pool.query<{ c: number }>(`SELECT count(*)::int AS c FROM ${t}`);
        expect(countBefore.rows[0]!.c).toBeGreaterThan(0);
      }

      // DELETE the trip
      await pool.query(`DELETE FROM trips WHERE id = $1`, [seed.tripId]);

      // Verify all 11 tables now have 0 rows for this trip
      for (const t of tables) {
        const countAfter = await pool.query<{ c: number }>(`SELECT count(*)::int AS c FROM ${t}`);
        expect(countAfter.rows[0]!.c).toBe(0);
      }
    });
  });

  describe('Requirement 13.3: CSV export', () => {
    it('exports CSV with header and resolves guest attributions to Sponsor — Guest_Name', async () => {
      // Alice creates an expense with share for Little Timmy (guest sponsored by Alice)
      await repo.createExpense(seed.tripId, seed.user1Id, {
        payerId: seed.user1Id,
        amountCents: 4000,
        description: 'Minnie ears gift',
        date: '2026-10-02',
        category: 'shopping',
        splitMode: 'exact',
        shares: [
          { guestId: seed.guestId, amountCents: 4000 },
        ],
      });

      // Bob creates a settlement
      await repo.createSettlement(seed.tripId, seed.user2Id, {
        payerId: seed.user2Id,
        recipientId: seed.user1Id,
        amountCents: 1000,
        date: '2026-10-03',
      });

      const csv = await repo.exportLedgerCsv(seed.tripId);
      expect(csv).toContain('Type,Date,Description,Payer,Amount,Category,Details');

      // Check Expense line
      expect(csv).toContain('Expense,2026-10-02,"Minnie ears gift",Alice,40.00,shopping,"Alice — Little Timmy: $40.00"');
      // Check Guest resolved to "Alice — Little Timmy"
      expect(csv).toContain('Alice — Little Timmy: $40.00');

      // Check Settlement line
      expect(csv).toContain('Settlement,2026-10-03,"Payment to Alice",Bob,10.00,,Settlement');
    });
  });
});
