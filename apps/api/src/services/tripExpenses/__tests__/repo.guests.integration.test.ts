import { describe, it, expect, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createTripExpenseRepo } from '../repo.js';
import { setupTestDb, seedTestData, type SeedTestData } from './testDb.js';
import { AppError } from '../../../errors/AppError.js';

describe('TripExpenseRepo - Guests', () => {
  let pool: Pool;
  let repo: ReturnType<typeof createTripExpenseRepo>;
  let seed: SeedTestData;

  beforeEach(async () => {
    const testDb = setupTestDb();
    pool = testDb.pool;
    repo = createTripExpenseRepo(pool);
    seed = await seedTestData(pool);
  });

  describe('addTripGuest & listTripGuests', () => {
    it('adds a guest and returns it with sponsor details', async () => {
      const guest = await repo.addTripGuest(seed.tripId, seed.user2Id, {
        name: '  Cousin Oliver  ',
      });

      expect(guest.name).toBe('Cousin Oliver');
      expect(guest.sponsorMemberId).toBe(seed.user2Id);
      expect(guest.tripId).toBe(seed.tripId);

      const list = await repo.listTripGuests(seed.tripId);
      // Already had Little Timmy from seed, now Oliver as well
      expect(list).toHaveLength(2);
      expect(list.some((g) => g.name === 'Cousin Oliver')).toBe(true);
      expect(list.some((g) => g.name === 'Little Timmy')).toBe(true);
    });

    it('rejects adding a guest when sponsor is not a trip member (Req 2.1)', async () => {
      const nonMemberId = '99999999-9999-4999-8999-999999999999';
      await expect(
        repo.addTripGuest(seed.tripId, seed.user1Id, {
          name: 'Invalid Guest',
          sponsorMemberId: nonMemberId,
        }),
      ).rejects.toThrowError(/sponsor must be a trip member/i);
    });
  });

  describe('renameTripGuest', () => {
    it('allows sponsor to rename a guest', async () => {
      // Alice is sponsor of Little Timmy (seed.guestId)
      const updated = await repo.renameTripGuest(
        seed.tripId,
        seed.guestId,
        seed.user1Id,
        'member',
        { name: 'Timothy' },
      );

      expect(updated.name).toBe('Timothy');
    });

    it('allows organizer to rename a guest even if not sponsor', async () => {
      // Create guest sponsored by Bob (user2)
      const guest = await repo.addTripGuest(seed.tripId, seed.user2Id, { name: 'Bob Guest' });

      // Alice is organizer
      const updated = await repo.renameTripGuest(
        seed.tripId,
        guest.id,
        seed.user1Id,
        'organizer',
        { name: 'Bob Guest Renamed' },
      );

      expect(updated.name).toBe('Bob Guest Renamed');
    });

    it('allows sponsor or organizer to reassign guest to another member (Req 2.11)', async () => {
      // Alice is sponsor of Little Timmy (seed.guestId); reassigns to Bob (user2)
      const updated = await repo.renameTripGuest(
        seed.tripId,
        seed.guestId,
        seed.user1Id,
        'organizer',
        { name: 'Timothy', sponsorMemberId: seed.user2Id },
      );

      expect(updated.name).toBe('Timothy');
      expect(updated.sponsorMemberId).toBe(seed.user2Id);

      const list = await repo.listTripGuests(seed.tripId);
      const found = list.find((g) => g.id === seed.guestId);
      expect(found?.sponsorMemberId).toBe(seed.user2Id);
    });

    it('rejects reassigning guest to a non-member sponsor (Req 2.11)', async () => {
      const nonMemberId = '99999999-9999-4999-8999-999999999999';
      await expect(
        repo.renameTripGuest(
          seed.tripId,
          seed.guestId,
          seed.user1Id,
          'organizer',
          { name: 'Timothy', sponsorMemberId: nonMemberId },
        ),
      ).rejects.toThrowError(/sponsor must be a trip member/i);
    });

    it('rejects non-sponsor non-organizer member renaming a guest', async () => {
      // Carol (user3) is regular member, not sponsor
      await expect(
        repo.renameTripGuest(
          seed.tripId,
          seed.guestId,
          seed.user3Id,
          'member',
          { name: 'Hacked Name' },
        ),
      ).rejects.toThrowError(AppError);
    });
  });

  describe('removeTripGuest and in-use rejection', () => {
    it('removes an unused guest successfully', async () => {
      const guest = await repo.addTripGuest(seed.tripId, seed.user1Id, { name: 'Temporary Guest' });
      await repo.removeTripGuest(seed.tripId, guest.id, seed.user1Id, 'organizer');

      const list = await repo.listTripGuests(seed.tripId);
      expect(list.some((g) => g.id === guest.id)).toBe(false);
    });

    it('rejects removal when guest is referenced in expense_shares', async () => {
      // Little Timmy has a share on an expense
      await repo.createExpense(seed.tripId, seed.user1Id, {
        payerId: seed.user1Id,
        amountCents: 2000,
        description: 'Exact share for guest',
        date: '2026-10-02',
        splitMode: 'exact',
        shares: [{ guestId: seed.guestId, amountCents: 2000 }],
      });

      await expect(
        repo.removeTripGuest(seed.tripId, seed.guestId, seed.user1Id, 'organizer'),
      ).rejects.toThrowError(/recorded expense/i);
    });

    it('rejects removal when guest is referenced in expense_tier_counts', async () => {
      await repo.createExpense(seed.tripId, seed.user1Id, {
        payerId: seed.user1Id,
        amountCents: 10000,
        description: 'Tiered with guest count',
        date: '2026-10-02',
        splitMode: 'tiered',
        tiers: [{ name: 'Ticket', priceCents: 5000 }],
        tierCounts: [
          { tierId: 'Ticket', memberId: seed.user2Id, count: 1 },
          { tierId: 'Ticket', guestId: seed.guestId, count: 1 },
        ],
      });

      await expect(
        repo.removeTripGuest(seed.tripId, seed.guestId, seed.user1Id, 'organizer'),
      ).rejects.toThrowError(/recorded expense/i);
    });

    it('rejects removal when guest is referenced in expense_items', async () => {
      await repo.createExpense(seed.tripId, seed.user1Id, {
        payerId: seed.user1Id,
        description: 'Itemized with guest',
        date: '2026-10-02',
        splitMode: 'itemized',
        items: [
          { name: 'Mickey Ears', priceCents: 3000, assigneeIds: [seed.guestId] },
        ],
      });

      await expect(
        repo.removeTripGuest(seed.tripId, seed.guestId, seed.user1Id, 'organizer'),
      ).rejects.toThrowError(/recorded expense/i);
    });

    it('rejects removal by non-sponsor non-organizer member', async () => {
      const guest = await repo.addTripGuest(seed.tripId, seed.user1Id, { name: 'Alice Guest' });
      // Carol is a member, not sponsor, not organizer
      await expect(
        repo.removeTripGuest(seed.tripId, guest.id, seed.user3Id, 'member'),
      ).rejects.toThrowError(AppError);
    });
  });
});
