import { describe, it, expect, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTripExpenseRepo } from '../repo.js';
import { setupTestDb, seedTestData, type SeedTestData } from './testDb.js';
import { AppError } from '../../../errors/AppError.js';

describe('TripExpenseRepo - Settlements & Refunds', () => {
  let pool: Pool;
  let repo: ReturnType<typeof createTripExpenseRepo>;
  let seed: SeedTestData;

  beforeEach(async () => {
    const testDb = setupTestDb();
    pool = testDb.pool;
    repo = createTripExpenseRepo(pool);
    seed = await seedTestData(pool);
  });

  describe('Settlement operations', () => {
    it('creates a settlement between two distinct members and reads it back', async () => {
      const settlement = await repo.createSettlement(seed.tripId, seed.user2Id, {
        payerId: seed.user2Id,
        recipientId: seed.user1Id,
        amountCents: 5000,
        date: '2026-10-03',
      });

      expect(settlement.amountCents).toBe(5000);
      expect(settlement.payerId).toBe(seed.user2Id);
      expect(settlement.recipientId).toBe(seed.user1Id);

      const list = await repo.listExpensesAndSettlements(seed.tripId);
      expect(list.some((item) => item.id === settlement.id)).toBe(true);
    });

    it('rejects settlement between same user (payer == recipient)', async () => {
      await expect(
        repo.createSettlement(seed.tripId, seed.user1Id, {
          payerId: seed.user1Id,
          recipientId: seed.user1Id,
          amountCents: 1000,
          date: '2026-10-03',
        }),
      ).rejects.toThrowError(AppError);
    });

    it('rejects settlement with non-trip-member', async () => {
      await expect(
        repo.createSettlement(seed.tripId, seed.user1Id, {
          payerId: seed.user1Id,
          recipientId: '00000000-0000-0000-0000-000000000000',
          amountCents: 1000,
          date: '2026-10-03',
        }),
      ).rejects.toThrowError(AppError);
    });

    it('allows editing settlement by creator or organizer, rejects others', async () => {
      // Bob creates settlement
      const settlement = await repo.createSettlement(seed.tripId, seed.user2Id, {
        payerId: seed.user2Id,
        recipientId: seed.user1Id,
        amountCents: 3000,
        date: '2026-10-03',
      });

      // Carol (member, not creator, not organizer) tries to edit -> rejected
      await expect(
        repo.editSettlement(seed.tripId, settlement.id, seed.user3Id, 'member', {
          payerId: seed.user2Id,
          recipientId: seed.user1Id,
          amountCents: 4000,
          date: '2026-10-03',
        }),
      ).rejects.toThrowError(AppError);

      // Alice (organizer) edits -> allowed
      const edited = await repo.editSettlement(seed.tripId, settlement.id, seed.user1Id, 'organizer', {
        payerId: seed.user2Id,
        recipientId: seed.user1Id,
        amountCents: 4500,
        date: '2026-10-03',
      });
      expect(edited.amountCents).toBe(4500);

      // Bob (creator) edits -> allowed
      const editedByCreator = await repo.editSettlement(seed.tripId, settlement.id, seed.user2Id, 'member', {
        payerId: seed.user2Id,
        recipientId: seed.user1Id,
        amountCents: 4000,
        date: '2026-10-03',
      });
      expect(editedByCreator.amountCents).toBe(4000);
    });

    it('removes settlement with creator or organizer check', async () => {
      const settlement = await repo.createSettlement(seed.tripId, seed.user2Id, {
        payerId: seed.user2Id,
        recipientId: seed.user1Id,
        amountCents: 2000,
        date: '2026-10-03',
      });

      // Non-creator, non-organizer cannot remove
      await expect(
        repo.removeSettlement(seed.tripId, settlement.id, seed.user3Id, 'member'),
      ).rejects.toThrowError(AppError);

      // Creator can remove
      await repo.removeSettlement(seed.tripId, settlement.id, seed.user2Id, 'member');
      const listAfter = await repo.listExpensesAndSettlements(seed.tripId);
      expect(listAfter.some((item) => item.id === settlement.id)).toBe(false);
    });
  });

  describe('Refund operations', () => {
    it('creates a refund and preserves target expense amount and description', async () => {
      // Alice creates a $300 (30000 cents) hotel expense
      const expense = await repo.createExpense(seed.tripId, seed.user1Id, {
        payerId: seed.user1Id,
        amountCents: 30000,
        description: 'Hotel deposit',
        date: '2026-10-01',
        splitMode: 'even',
        participantIds: [seed.user1Id, seed.user2Id, seed.user3Id],
      });

      // Record a $50 refund (5000 cents)
      const refund = await repo.createRefund(seed.tripId, expense.id, seed.user1Id, 'organizer', {
        amountCents: 5000,
        date: '2026-10-02',
      });

      expect(refund.amountCents).toBe(5000);
      expect(refund.expenseId).toBe(expense.id);

      // Target expense's own amount and description are NOT mutated (Req 12.6)
      const readExpense = await repo.getExpense(seed.tripId, expense.id);
      expect(readExpense?.amountCents).toBe(30000);
      expect(readExpense?.description).toBe('Hotel deposit');
      expect(readExpense?.refunds).toHaveLength(1);
      expect(readExpense?.refunds[0]!.amountCents).toBe(5000);
    });

    it('rejects refund exceeding expense total amount', async () => {
      const expense = await repo.createExpense(seed.tripId, seed.user1Id, {
        payerId: seed.user1Id,
        amountCents: 10000,
        description: 'Deposit',
        date: '2026-10-01',
        splitMode: 'even',
        participantIds: [seed.user1Id, seed.user2Id],
      });

      // Refund 10001 cents -> rejected
      await expect(
        repo.createRefund(seed.tripId, expense.id, seed.user1Id, 'organizer', {
          amountCents: 10001,
          date: '2026-10-02',
        }),
      ).rejects.toThrowError(AppError);

      // Refund 6000 cents -> succeeds
      await repo.createRefund(seed.tripId, expense.id, seed.user1Id, 'organizer', {
        amountCents: 6000,
        date: '2026-10-02',
      });

      // Second refund of 5000 cents -> 6000 + 5000 = 11000 > 10000 -> rejected
      await expect(
        repo.createRefund(seed.tripId, expense.id, seed.user1Id, 'organizer', {
          amountCents: 5000,
          date: '2026-10-02',
        }),
      ).rejects.toThrowError(AppError);
    });

    it('rejects refund creation by non-creator non-organizer member', async () => {
      const expense = await repo.createExpense(seed.tripId, seed.user1Id, {
        payerId: seed.user1Id,
        amountCents: 5000,
        description: 'Alice expense',
        date: '2026-10-01',
        splitMode: 'even',
        participantIds: [seed.user1Id, seed.user2Id],
      });

      // Bob is member, not creator
      await expect(
        repo.createRefund(seed.tripId, expense.id, seed.user2Id, 'member', {
          amountCents: 1000,
          date: '2026-10-02',
        }),
      ).rejects.toThrowError(AppError);
    });

    it('edits and removes refund with bounds check and cascade', async () => {
      const expense = await repo.createExpense(seed.tripId, seed.user1Id, {
        payerId: seed.user1Id,
        amountCents: 10000,
        description: 'Deposit',
        date: '2026-10-01',
        splitMode: 'even',
        participantIds: [seed.user1Id, seed.user2Id],
      });

      const refund = await repo.createRefund(seed.tripId, expense.id, seed.user1Id, 'organizer', {
        amountCents: 4000,
        date: '2026-10-02',
      });

      // Edit to 8000 -> ok
      const edited = await repo.editRefund(seed.tripId, expense.id, refund.id, seed.user1Id, 'organizer', {
        amountCents: 8000,
        date: '2026-10-02',
      });
      expect(edited.amountCents).toBe(8000);

      // Edit to 12000 -> exceeds 10000 -> rejected
      await expect(
        repo.editRefund(seed.tripId, expense.id, refund.id, seed.user1Id, 'organizer', {
          amountCents: 12000,
          date: '2026-10-02',
        }),
      ).rejects.toThrowError(AppError);

      // Remove refund
      await repo.removeRefund(seed.tripId, expense.id, refund.id, seed.user1Id, 'organizer');
      const readExpense = await repo.getExpense(seed.tripId, expense.id);
      expect(readExpense?.refunds).toHaveLength(0);
    });
  });

  describe('Balances and Drill-down', () => {
    it('computes net and pairwise balances accurately with expenses, refunds, and settlements', async () => {
      // Alice pays $300 even split among Alice, Bob, Carol (100 each)
      // Net: Alice +200, Bob -100, Carol -100
      const exp = await repo.createExpense(seed.tripId, seed.user1Id, {
        payerId: seed.user1Id,
        amountCents: 30000,
        description: 'Hotel room',
        date: '2026-10-01',
        splitMode: 'even',
        participantIds: [seed.user1Id, seed.user2Id, seed.user3Id],
      });

      // Hotel issues $60 refund:
      // Effective amount = $240 ($80 each)
      // Net: Alice +160, Bob -80, Carol -80
      await repo.createRefund(seed.tripId, exp.id, seed.user1Id, 'organizer', {
        amountCents: 6000,
        date: '2026-10-02',
      });

      // Bob settles $50 to Alice:
      // Net: Alice +110, Bob -30, Carol -80
      await repo.createSettlement(seed.tripId, seed.user2Id, {
        payerId: seed.user2Id,
        recipientId: seed.user1Id,
        amountCents: 5000,
        date: '2026-10-03',
      });

      const netBalances = await repo.getNetBalances(seed.tripId);
      const aliceNet = netBalances.find((b) => b.memberId === seed.user1Id);
      const bobNet = netBalances.find((b) => b.memberId === seed.user2Id);
      const carolNet = netBalances.find((b) => b.memberId === seed.user3Id);

      expect(aliceNet?.netCents).toBe(11000);
      expect(bobNet?.netCents).toBe(-3000);
      expect(carolNet?.netCents).toBe(-8000);

      // Sum of all net balances must equal 0
      const totalNet = netBalances.reduce((acc, b) => acc + b.netCents, 0);
      expect(totalNet).toBe(0);

      const pairwise = await repo.getPairwiseBalances(seed.tripId);
      expect(pairwise.length).toBeGreaterThan(0);
      const aliceBobPair = pairwise.find(
        (p) => (p.memberIdA === seed.user1Id && p.memberIdB === seed.user2Id) ||
               (p.memberIdA === seed.user2Id && p.memberIdB === seed.user1Id),
      );
      expect(aliceBobPair).toBeDefined();
      expect(Math.abs(aliceBobPair!.aOwesBCents)).toBe(3000);

      const aliceCarolPair = pairwise.find(
        (p) => (p.memberIdA === seed.user1Id && p.memberIdB === seed.user3Id) ||
               (p.memberIdA === seed.user3Id && p.memberIdB === seed.user1Id),
      );
      expect(aliceCarolPair).toBeDefined();
      expect(Math.abs(aliceCarolPair!.aOwesBCents)).toBe(8000);

      // Drill down for Bob (single-member net balance perspective)
      const bobDrillDown = await repo.getBalanceDrillDown(seed.tripId, seed.user2Id);
      expect(bobDrillDown).toHaveLength(2); // The expense and the settlement
      expect(bobDrillDown.find((it) => it.kind === 'expense')?.contributionCents).toBe(-8000);
      expect(bobDrillDown.find((it) => it.kind === 'settlement')?.contributionCents).toBe(5000);
      expect(bobDrillDown.reduce((sum, it) => sum + it.contributionCents, 0)).toBe(-3000);

      // Drill down for Alice (single-member net balance perspective)
      const aliceDrillDown = await repo.getBalanceDrillDown(seed.tripId, seed.user1Id);
      expect(aliceDrillDown).toHaveLength(2);
      expect(aliceDrillDown.find((it) => it.kind === 'expense')?.contributionCents).toBe(16000);
      expect(aliceDrillDown.find((it) => it.kind === 'settlement')?.contributionCents).toBe(-5000);
      expect(aliceDrillDown.reduce((sum, it) => sum + it.contributionCents, 0)).toBe(11000);

      // Drill down for Bob with Alice as counterparty (Req 6.7, Property 13)
      const bobAliceDrillDown = await repo.getBalanceDrillDown(seed.tripId, seed.user2Id, seed.user1Id);
      expect(bobAliceDrillDown).toHaveLength(2);
      const mutualSum = bobAliceDrillDown.reduce((sum, item) => sum + item.contributionCents, 0);
      expect(mutualSum).toBe(3000); // Matches Bob's net pairwise debt to Alice ($30.00: $80 share - $50 paid)
      const settlementEntry = bobAliceDrillDown.find((it) => it.kind === 'settlement');
      expect(settlementEntry?.payerId).toBe(seed.user2Id);
      expect(settlementEntry?.recipientId).toBe(seed.user1Id);
      expect(settlementEntry?.contributionCents).toBe(-5000); // Paid down $50.00


      // Drill down for Bob with Carol as counterparty (no mutual transactions)
      const bobCarolDrillDown = await repo.getBalanceDrillDown(seed.tripId, seed.user2Id, seed.user3Id);
      expect(bobCarolDrillDown).toHaveLength(0);
    });
  });
});
