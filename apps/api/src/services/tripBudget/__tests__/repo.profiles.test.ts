/**
 * Tests for Trip Budget repository — Profiles, settings, and dismissals.
 *
 * // Feature: trip-budget, Property 33: Traveler profile rules
 * // Feature: trip-budget, Property 41: Deleted parties are handled safely and the guards hold
 * Validates: Requirements 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.8, 7.3, 7.5, 7.8, 16.5, 18.5, 18.8, 20.4
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { BUDGET_DEFAULT_DINING_TIP_BPS, BUDGET_DEFAULT_TAX_BPS, BUDGET_DISMISSED_LIMIT } from '@dwt/shared';
import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { createTripBudgetRepo, type TripBudgetRepo } from '../repo.js';
import { setupTestDb, seedTestData, type SeedTestData } from './testDb.js';

describe('TripBudgetRepo — Profiles, Settings, Dismissals', () => {
  let pool: DbPool;
  let repo: TripBudgetRepo;
  let seed: SeedTestData;

  beforeEach(async () => {
    const testDb = setupTestDb();
    pool = testDb.pool;
    repo = createTripBudgetRepo(pool);
    seed = await seedTestData(pool);
  });

  describe('Traveler Profiles (Property 33 & 41)', () => {
    it('creates a profile and upsert replaces existing profile for the same member (one profile per person)', async () => {
      // Bob creates his own profile
      const prof1 = await repo.upsertProfile(seed.tripId, seed.memberId, 'member', {
        memberId: seed.memberId,
        ageBracket: 'adult',
        ticketOption: 'base',
        ticketDays: 4,
        ticketStartDate: '2026-10-02',
        discountGroup: 'std-gst',
        passType: 'none',
      });

      expect(prof1.memberId).toBe(seed.memberId);
      expect(prof1.label).toBe('Bob Member');
      expect(prof1.ticketDays).toBe(4);

      // Upsert replaces with new attributes
      const prof2 = await repo.upsertProfile(seed.tripId, seed.memberId, 'member', {
        memberId: seed.memberId,
        ageBracket: 'adult',
        ticketOption: 'park_hopper',
        ticketDays: 5,
        ticketStartDate: '2026-10-03',
        discountGroup: 'fl-resident',
        passType: 'annual_pass',
      });

      expect(prof2.id).toBe(prof1.id);
      expect(prof2.ticketOption).toBe('park_hopper');
      expect(prof2.ticketDays).toBe(5);
      expect(prof2.passType).toBe('annual_pass');
      expect(prof2.discountGroup).toBe('fl-resident');

      const list = await repo.listTravelerProfiles(seed.tripId);
      expect(list).toHaveLength(1);
      expect(list[0]!.ticketDays).toBe(5);
    });

    it('allows a sponsor to create/edit profile for their sponsored guest', async () => {
      // Bob sponsors Timmy
      const guestProf = await repo.upsertProfile(seed.tripId, seed.memberId, 'member', {
        guestId: seed.guestId,
        ageBracket: 'child',
        ticketOption: 'base',
        ticketDays: 3,
      });

      expect(guestProf.guestId).toBe(seed.guestId);
      expect(guestProf.label).toBe('Timmy (Bob Guest)');
      expect(guestProf.ageBracket).toBe('child');
    });

    it('allows organizer to create and edit any profile (organizer override)', async () => {
      // Organizer Alice edits Bob's profile
      const prof = await repo.upsertProfile(seed.tripId, seed.organizerId, 'organizer', {
        memberId: seed.memberId,
        ageBracket: 'adult',
        ticketDays: 2,
      });
      expect(prof.ticketDays).toBe(2);

      // Organizer Alice edits Timmy's profile (sponsored by Bob)
      const guestProf = await repo.upsertProfile(seed.tripId, seed.organizerId, 'organizer', {
        guestId: seed.guestId,
        ageBracket: 'under3',
      });
      expect(guestProf.ageBracket).toBe('under3');
    });

    it('forbids members from editing other members or unsponsored guests', async () => {
      // Carol tries to edit Bob's profile -> forbidden
      await expect(
        repo.upsertProfile(seed.tripId, seed.otherMemberId, 'member', {
          memberId: seed.memberId,
          ageBracket: 'adult',
        }),
      ).rejects.toThrowError(/You may only edit your own traveler profile/i);

      // Carol tries to edit Timmy (sponsored by Bob) -> forbidden
      await expect(
        repo.upsertProfile(seed.tripId, seed.otherMemberId, 'member', {
          guestId: seed.guestId,
          ageBracket: 'child',
        }),
      ).rejects.toThrowError(/Only the sponsor or an organizer may edit/i);
    });

    it('round 5 L13: rejects upsertProfile for user not on the Trip or guest on another Trip with trip_validation_failed', async () => {
      // User not on trip
      await expect(
        repo.upsertProfile(seed.tripId, seed.organizerId, 'organizer', {
          memberId: seed.outsideUserId,
          ageBracket: 'adult',
        }),
      ).rejects.toThrowError(/User is not a member of this trip/i);

      // Guest from other trip
      await expect(
        repo.upsertProfile(seed.tripId, seed.organizerId, 'organizer', {
          guestId: seed.otherTripGuestId,
          ageBracket: 'child',
        }),
      ).rejects.toThrowError(/Guest does not belong to this trip/i);

      // Confirms nothing stored
      const list = await repo.listTravelerProfiles(seed.tripId);
      expect(list).toHaveLength(0);
    });

    it('handles under3 and passType correctly at repo boundary', async () => {
      const under3Prof = await repo.upsertProfile(seed.tripId, seed.memberId, 'member', {
        memberId: seed.memberId,
        ageBracket: 'under3',
        passType: 'none',
      });
      expect(under3Prof.ageBracket).toBe('under3');
      expect(under3Prof.passType).toBe('none');

      const passProf = await repo.upsertProfile(seed.tripId, seed.memberId, 'member', {
        memberId: seed.memberId,
        ageBracket: 'adult',
        passType: 'dvc',
      });
      expect(passProf.passType).toBe('dvc');
    });

    it('Property 41: pending_deletion account returns trip_party_deleted (409) naming nobody, list read omits it, deleteProfile by id succeeds', async () => {
      // 1. Create a valid profile first
      const prof = await repo.upsertProfile(seed.tripId, seed.memberId, 'member', {
        memberId: seed.memberId,
        ageBracket: 'adult',
        ticketDays: 4,
      });

      // 2. Mark Bob as pending_deletion (satisfying users_deletion_schedule_chk constraint)
      await pool.query(
        `UPDATE users
         SET deletion_state = 'pending_deletion',
             scheduled_purge_at = now(),
             deletion_requested_at = now(),
             placeholder_id = gen_random_uuid()
         WHERE id = $1`,
        [seed.memberId],
      );

      // 3. Upserting profile for pending_deletion account throws trip_party_deleted
      const err = await repo.upsertProfile(seed.tripId, seed.memberId, 'member', {
        memberId: seed.memberId,
        ageBracket: 'adult',
        ticketDays: 5,
      }).catch((e) => e);

      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe('trip_party_deleted');
      expect(err.message).not.toContain('Bob');
      expect(err.message).not.toContain(seed.memberId);

      // 4. listTravelerProfiles OMITS Bob's profile (review F4)
      const list = await repo.listTravelerProfiles(seed.tripId);
      expect(list.some((p) => p.id === prof.id)).toBe(false);

      // 5. deleteProfile by id still succeeds for the omitted profile (Property 41)
      await expect(
        repo.deleteProfile(seed.tripId, prof.id, seed.organizerId, 'organizer'),
      ).resolves.toBeUndefined();

      // Deleting again throws trip_not_found
      await expect(
        repo.deleteProfile(seed.tripId, prof.id, seed.organizerId, 'organizer'),
      ).rejects.toThrowError(/not found/i);
    });

    it('deleteProfile enforces permissions (sponsor or organizer or self)', async () => {
      const prof = await repo.upsertProfile(seed.tripId, seed.memberId, 'member', {
        memberId: seed.memberId,
        ageBracket: 'adult',
      });

      // Carol cannot delete Bob's profile
      await expect(
        repo.deleteProfile(seed.tripId, prof.id, seed.otherMemberId, 'member'),
      ).rejects.toThrowError(/You may only delete your own traveler profile/i);

      // Bob can delete his own profile
      await expect(
        repo.deleteProfile(seed.tripId, prof.id, seed.memberId, 'member'),
      ).resolves.toBeUndefined();
    });
  });

  describe('Budget Settings (Requirements 7.3, 7.5, 7.8)', () => {
    it('returns defaults when no settings have been saved', async () => {
      const settings = await repo.getSettings(seed.tripId);
      expect(settings.diningTipBps).toBe(BUDGET_DEFAULT_DINING_TIP_BPS);
      expect(settings.diningTipBpsIsDefault).toBe(true);
      expect(settings.savedCents).toBe(0);
      expect(settings.savingsTargetCents).toBeNull();

      for (const [cat, bps] of Object.entries(BUDGET_DEFAULT_TAX_BPS)) {
        expect(settings.taxBps[cat as keyof typeof BUDGET_DEFAULT_TAX_BPS]).toBe(bps);
        expect(settings.taxBpsIsDefault[cat as keyof typeof BUDGET_DEFAULT_TAX_BPS]).toBe(true);
      }
    });

    it('patches settings, merges taxBps, and tracks default flags', async () => {
      const patched = await repo.patchSettings(seed.tripId, {
        taxBps: { dining: 700 },
        diningTipBps: 2000,
        savedCents: 50000,
        savingsTargetCents: 200000,
      });

      expect(patched.taxBps.dining).toBe(700);
      expect(patched.taxBpsIsDefault.dining).toBe(false);
      expect(patched.taxBps.tickets).toBe(BUDGET_DEFAULT_TAX_BPS.tickets);
      expect(patched.taxBpsIsDefault.tickets).toBe(true);
      expect(patched.diningTipBps).toBe(2000);
      expect(patched.diningTipBpsIsDefault).toBe(false);
      expect(patched.savedCents).toBe(50000);
      expect(patched.savingsTargetCents).toBe(200000);

      // Second patch merges taxBps without clearing dining
      const patched2 = await repo.patchSettings(seed.tripId, {
        taxBps: { tickets: 750 },
      });
      expect(patched2.taxBps.dining).toBe(700);
      expect(patched2.taxBpsIsDefault.dining).toBe(false);
      expect(patched2.taxBps.tickets).toBe(750);
      expect(patched2.taxBpsIsDefault.tickets).toBe(false);
    });

    it('rejects invalid taxBps rates, bounds, and unknown categories', async () => {
      await expect(
        repo.patchSettings(seed.tripId, {
          taxBps: { dining: -1 },
        }),
      ).rejects.toThrowError(/Invalid tax rate/i);

      await expect(
        repo.patchSettings(seed.tripId, {
          taxBps: { dining: 2501 },
        }),
      ).rejects.toThrowError(/Invalid tax rate/i);

      await expect(
        repo.patchSettings(seed.tripId, {
          // @ts-expect-error testing invalid category
          taxBps: { non_existent_cat: 500 },
        }),
      ).rejects.toThrowError(/Invalid category in taxBps/i);

      await expect(
        repo.patchSettings(seed.tripId, {
          diningTipBps: 5001,
        }),
      ).rejects.toThrowError(/Invalid diningTipBps/i);

      await expect(
        repo.patchSettings(seed.tripId, {
          savedCents: -5,
        }),
      ).rejects.toThrowError(/Invalid savedCents/i);
    });
  });

  describe('Dismissed Suggestions (Requirements 16.5, 20.4)', () => {
    it('records dismissed suggestions idempotently', async () => {
      await repo.dismissSuggestion(seed.tripId, 'planned:item-1');
      await repo.dismissSuggestion(seed.tripId, 'planned:item-1'); // Duplicate no-op

      const dismissed = await repo.listDismissedSuggestions(seed.tripId);
      expect(dismissed.has('planned:item-1')).toBe(true);
      expect(dismissed.size).toBe(1);
    });

    it('enforces BUDGET_DISMISSED_LIMIT (200) cap and rejects 201st distinct key', async () => {
      for (let i = 0; i < BUDGET_DISMISSED_LIMIT; i++) {
        await repo.dismissSuggestion(seed.tripId, `suggestion:${i}`);
      }

      const dismissed = await repo.listDismissedSuggestions(seed.tripId);
      expect(dismissed.size).toBe(200);

      // Re-dismissing an existing key is idempotent and succeeds
      await expect(repo.dismissSuggestion(seed.tripId, 'suggestion:0')).resolves.toBeUndefined();

      // 201st distinct key rejects with trip_validation_failed
      await expect(
        repo.dismissSuggestion(seed.tripId, 'suggestion:overflow'),
      ).rejects.toThrowError(/Dismissed suggestions limit reached/i);
    });
  });
});
