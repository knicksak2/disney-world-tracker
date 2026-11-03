/**
 * Tests for Trip Budget repository — Lines and Allocations.
 *
 * // Feature: trip-budget, Property 32: Budget line CRUD invariants
 * // Feature: trip-budget, Property 34: Menu selections are verified without the network
 * // Feature: trip-budget, Property 41: Deleted parties are handled safely and the guards hold
 * Validates: Requirements 2.1-2.9, 3.1-3.7, 5.10, 9.6, 9.9, 9.10, 14.9, 17.3, 17.5, 18.5, 18.8
 */

import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  normalizeMenuName,
  normalizeTierName,
  priceLabelText,
} from '@dwt/shared';
import type { DbPool } from '../../../db/pool.js';
import { createTripBudgetRepo, type TripBudgetRepo } from '../repo.js';
import { dateToInstant, wdwDateOf } from '../../ticketPrices/dates.js';
import { setupTestDb, seedTestData, type SeedTestData } from './testDb.js';

describe('TripBudgetRepo — Lines and Allocations', () => {
  let pool: DbPool;
  let repo: TripBudgetRepo;
  let seed: SeedTestData;
  let diningExpId: string;
  let longItemTitle: string;
  let longOfferLabel: string;
  let expenseId: string;
  let otherTripExpenseId: string;

  beforeEach(async () => {
    const testDb = setupTestDb();
    pool = testDb.pool;
    repo = createTripBudgetRepo(pool);
    seed = await seedTestData(pool);

    diningExpId = randomUUID();
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category, active)
       VALUES ($1, $1, 'Be Our Guest', 'Magic Kingdom', 'Restaurant', true)`,
      [diningExpId],
    );

    // 120-character item title (round 4 L9)
    longItemTitle = 'Extra Special Magical Royal Roasted Chicken With Enchanted Herb Infused Reduction And Golden Potatoes'.padEnd(120, 'Z');
    // 60-character offer banner title (round 5 L8)
    longOfferLabel = 'Prix Fixe Feast With Special Royal Dessert And Wonderful Magic'.slice(0, 60);

    const cachedMenus = [
      {
        menuType: 'Dinner',
        groups: [
          {
            name: 'Entrees',
            items: [
              {
                name: longItemTitle,
                prices: [{ cents: 3500, label: 'Per Person' }],
                priceCents: 3500,
              },
              {
                name: 'Steak Selection',
                price: '$12 / $18', // Shape 1 price display string
              },
              {
                name: 'Burger',
                priceCents: 1500,
                prices: [{ cents: 1500, label: 'Single' }],
              },
            ],
          },
          {
            name: `${longOfferLabel} ($65 per adult)`, // Generates fixed_menu offer
            items: [
              {
                name: 'Adult Royal Dinner',
                priceCents: 6500,
              },
            ],
          },
        ],
      },
    ];

    await pool.query(
      `INSERT INTO experience_menus (experience_id, menus, shape_version)
       VALUES ($1, $2, 2)`,
      [diningExpId, JSON.stringify(cachedMenus)],
    );

    expenseId = randomUUID();
    await pool.query(
      `INSERT INTO expenses (id, trip_id, payer_id, created_by, amount_cents, description, expense_date, split_mode)
       VALUES ($1, $2, $3, $3, 10000, 'Existing expense', '2026-10-02', 'even')`,
      [expenseId, seed.tripId, seed.organizerId],
    );

    otherTripExpenseId = randomUUID();
    await pool.query(
      `INSERT INTO expenses (id, trip_id, payer_id, created_by, amount_cents, description, expense_date, split_mode)
       VALUES ($1, $2, $3, $3, 5000, 'Other trip expense', '2026-11-02', 'even')`,
      [otherTripExpenseId, seed.otherTripId, seed.organizerId],
    );
  });

  describe('Creation and validation invariants (Property 32)', () => {
    it('creates a user_entered line with valid allocations', async () => {
      const line = await repo.createLine(seed.tripId, seed.memberId, {
        category: 'shopping',
        description: 'Souvenirs',
        priceSource: 'user_entered',
        allocations: [
          { memberId: seed.memberId, amountCents: 4500 },
          { guestId: seed.guestId, amountCents: 2500 },
        ],
      });

      expect(line.category).toBe('shopping');
      expect(line.description).toBe('Souvenirs');
      expect(line.priceSource).toBe('user_entered');
      expect(line.effectivePriceSource).toBe('user_entered');
      expect(line.priceLabelKind).toBe('your_price');
      expect(line.subtotalCents).toBe(7000);
      expect(line.totalCents).toBe(7455); // with 6.5% default tax on shopping: bpsOf(7000, 650) = 455
      expect(line.allocations).toHaveLength(2);
    });

    it('rejects applyTip: true on lodging or non-dining line', async () => {
      await expect(
        repo.createLine(seed.tripId, seed.memberId, {
          category: 'lodging',
          description: 'Hotel room',
          priceSource: 'user_entered',
          applyTip: true,
          allocations: [{ memberId: seed.memberId, amountCents: 20000 }],
        }),
      ).rejects.toThrowError(/applyTip is only allowed when category is dining/i);
    });

    it('rejects zero allocations, duplicate persons, and wrong-trip persons', async () => {
      // Zero allocations
      await expect(
        repo.createLine(seed.tripId, seed.memberId, {
          category: 'other',
          description: 'Empty',
          priceSource: 'user_entered',
          allocations: [],
        }),
      ).rejects.toThrowError(/at least one allocation/i);

      // Duplicate person
      await expect(
        repo.createLine(seed.tripId, seed.memberId, {
          category: 'other',
          description: 'Duplicate',
          priceSource: 'user_entered',
          allocations: [
            { memberId: seed.memberId, amountCents: 1000 },
            { memberId: seed.memberId, amountCents: 2000 },
          ],
        }),
      ).rejects.toThrowError(/Duplicate allocation/i);

      // Person not on this trip
      await expect(
        repo.createLine(seed.tripId, seed.memberId, {
          category: 'other',
          description: 'Outside user',
          priceSource: 'user_entered',
          allocations: [{ memberId: seed.outsideUserId, amountCents: 1000 }],
        }),
      ).rejects.toThrowError(/Member is not on this trip/i);

      // Guest from another trip
      await expect(
        repo.createLine(seed.tripId, seed.memberId, {
          category: 'other',
          description: 'Outside guest',
          priceSource: 'user_entered',
          allocations: [{ guestId: seed.otherTripGuestId, amountCents: 1000 }],
        }),
      ).rejects.toThrowError(/Guest does not belong to this trip/i);
    });

    it('rejects linked_expense_id from another Trip', async () => {
      await expect(
        repo.createLine(seed.tripId, seed.memberId, {
          category: 'other',
          description: 'Wrong expense',
          priceSource: 'user_entered',
          linkedExpenseId: otherTripExpenseId,
          allocations: [{ memberId: seed.memberId, amountCents: 1000 }],
        }),
      ).rejects.toThrowError(/Linked expense does not belong to this trip/i);
    });

    it('enforces BUDGET_LINE_LIMIT (500 lines): 500th accepted, 501st rejected', async () => {
      // Pre-insert 499 lines directly
      for (let i = 0; i < 499; i++) {
        await pool.query(
          `INSERT INTO trip_budget_lines (
             trip_id, created_by, category, description, price_source
           ) VALUES ($1, $2, 'other', $3, 'user_entered')`,
          [seed.tripId, seed.memberId, `Line ${i}`],
        );
      }

      // 500th line is accepted
      const line500 = await repo.createLine(seed.tripId, seed.memberId, {
        category: 'other',
        description: 'Line 500',
        priceSource: 'user_entered',
        allocations: [{ memberId: seed.memberId, amountCents: 100 }],
      });
      expect(line500.id).toBeDefined();

      // 501st line is rejected
      await expect(
        repo.createLine(seed.tripId, seed.memberId, {
          category: 'other',
          description: 'Line 501',
          priceSource: 'user_entered',
          allocations: [{ memberId: seed.memberId, amountCents: 100 }],
        }),
      ).rejects.toThrowError(/Budget line limit reached/i);
    });

    it('enforces unique suggestionKey per trip', async () => {
      await repo.createLine(seed.tripId, seed.memberId, {
        category: 'other',
        description: 'First',
        priceSource: 'user_entered',
        suggestionKey: 'sug:unique:1',
        allocations: [{ memberId: seed.memberId, amountCents: 500 }],
      });

      await expect(
        repo.createLine(seed.tripId, seed.memberId, {
          category: 'other',
          description: 'Second',
          priceSource: 'user_entered',
          suggestionKey: 'sug:unique:1',
          allocations: [{ memberId: seed.memberId, amountCents: 500 }],
        }),
      ).rejects.toThrowError(/Duplicate suggestion key/i);
    });
  });

  describe('Menu verification (Property 34, Requirements 9.6, 9.9, 9.10)', () => {
    it('round 4 L9: 120-char cached title accepted with normalizeMenuName(title) (100 chars) and rejected when differing within 100 chars', async () => {
      const normalizedTitle = normalizeMenuName(longItemTitle);
      expect(normalizedTitle).toHaveLength(100);

      // Accepted with normalizeMenuName
      const line = await repo.createLine(seed.tripId, seed.memberId, {
        category: 'dining',
        description: 'Dinner feast',
        experienceId: diningExpId,
        priceSource: 'disney_menu',
        allocations: [
          {
            memberId: seed.memberId,
            priceRef: {
              kind: 'menu',
              items: [{ name: normalizedTitle, priceCents: 3500, priceLabel: 'Per Person', quantity: 1 }],
            },
          },
        ],
      });
      expect(line.subtotalCents).toBe(3500);

      // Differing in the first 100 characters is rejected
      const differingTitle = `Diff_${normalizedTitle.slice(5)}`;
      await expect(
        repo.createLine(seed.tripId, seed.memberId, {
          category: 'dining',
          description: 'Dinner feast',
          experienceId: diningExpId,
          priceSource: 'disney_menu',
          allocations: [
            {
              memberId: seed.memberId,
              priceRef: {
                kind: 'menu',
                items: [{ name: differingTitle, priceCents: 3500, priceLabel: 'Per Person', quantity: 1 }],
              },
            },
          ],
        }),
      ).rejects.toThrowError(/Menu item .* price not found in cache/i);
    });

    it('Property 34: shape_version 1 row ("$12 / $18") accepts 1200 or 1800 and rejects 1500', async () => {
      // 1200 is accepted
      const line1 = await repo.createLine(seed.tripId, seed.memberId, {
        category: 'dining',
        description: 'Steak 1',
        experienceId: diningExpId,
        priceSource: 'disney_menu',
        allocations: [
          {
            memberId: seed.memberId,
            priceRef: {
              kind: 'menu',
              items: [{ name: 'Steak Selection', priceCents: 1200, priceLabel: null, quantity: 1 }],
            },
          },
        ],
      });
      expect(line1.subtotalCents).toBe(1200);

      // 1800 is accepted
      const line2 = await repo.createLine(seed.tripId, seed.memberId, {
        category: 'dining',
        description: 'Steak 2',
        experienceId: diningExpId,
        priceSource: 'disney_menu',
        allocations: [
          {
            memberId: seed.memberId,
            priceRef: {
              kind: 'menu',
              items: [{ name: 'Steak Selection', priceCents: 1800, priceLabel: null, quantity: 1 }],
            },
          },
        ],
      });
      expect(line2.subtotalCents).toBe(1800);

      // 1500 is not in "$12 / $18" and is rejected
      await expect(
        repo.createLine(seed.tripId, seed.memberId, {
          category: 'dining',
          description: 'Steak 3',
          experienceId: diningExpId,
          priceSource: 'disney_menu',
          allocations: [
            {
              memberId: seed.memberId,
              priceRef: {
                kind: 'menu',
                items: [{ name: 'Steak Selection', priceCents: 1500, priceLabel: null, quantity: 1 }],
              },
            },
          ],
        }),
      ).rejects.toThrowError(/not found in cache/i);
    });

    it('round 5 L8: tier offer with 60-character label accepted when tier.name == normalizeTierName(label) (40 chars)', async () => {
      const normalizedTier = normalizeTierName(longOfferLabel);
      expect(normalizedTier).toHaveLength(40);

      const line = await repo.createLine(seed.tripId, seed.memberId, {
        category: 'dining',
        description: 'Royal Prix Fixe',
        experienceId: diningExpId,
        priceSource: 'disney_menu',
        allocations: [
          {
            memberId: seed.memberId,
            priceRef: {
              kind: 'menu',
              tier: { name: normalizedTier, priceCents: 6500 },
            },
          },
        ],
      });
      expect(line.subtotalCents).toBe(6500);

      // Raw 60-char label is rejected
      await expect(
        repo.createLine(seed.tripId, seed.memberId, {
          category: 'dining',
          description: 'Royal Prix Fixe Raw',
          experienceId: diningExpId,
          priceSource: 'disney_menu',
          allocations: [
            {
              memberId: seed.memberId,
              priceRef: {
                kind: 'menu',
                tier: { name: longOfferLabel, priceCents: 6500 },
              },
            },
          ],
        }),
      ).rejects.toThrowError();
    });

    it('review F3: disney_menu rejections for mismatching amountCents, missing experienceId, non-dining, and quantity 5 with 1-unit amount', async () => {
      // Non-dining category
      await expect(
        repo.createLine(seed.tripId, seed.memberId, {
          category: 'shopping',
          description: 'Wrong cat',
          experienceId: diningExpId,
          priceSource: 'disney_menu',
          allocations: [
            {
              memberId: seed.memberId,
              priceRef: { kind: 'menu', items: [{ name: 'Burger', priceCents: 1500, priceLabel: null, quantity: 1 }] },
            },
          ],
        }),
      ).rejects.toThrowError(/disney_menu requires category dining/i);

      // Missing experienceId
      await expect(
        repo.createLine(seed.tripId, seed.memberId, {
          category: 'dining',
          description: 'No exp',
          priceSource: 'disney_menu',
          allocations: [
            {
              memberId: seed.memberId,
              priceRef: { kind: 'menu', items: [{ name: 'Burger', priceCents: 1500, priceLabel: null, quantity: 1 }] },
            },
          ],
        }),
      ).rejects.toThrowError(/disney_menu requires non-null experienceId/i);

      // Quantity 5 with amountCents left at one-unit price (1500 instead of 7500)
      await expect(
        repo.createLine(seed.tripId, seed.memberId, {
          category: 'dining',
          description: 'Quantity mismatch',
          experienceId: diningExpId,
          priceSource: 'disney_menu',
          allocations: [
            {
              memberId: seed.memberId,
              amountCents: 1500, // submitted 1-unit price
              priceRef: { kind: 'menu', items: [{ name: 'Burger', priceCents: 1500, priceLabel: null, quantity: 5 }] },
            },
          ],
        }),
      ).rejects.toThrowError(/Submitted amountCents does not match computed menu amount/i);

      // Accepted selection computes 7500
      const okLine = await repo.createLine(seed.tripId, seed.memberId, {
        category: 'dining',
        description: 'Quantity 5',
        experienceId: diningExpId,
        priceSource: 'disney_menu',
        allocations: [
          {
            memberId: seed.memberId,
            priceRef: { kind: 'menu', items: [{ name: 'Burger', priceCents: 1500, priceLabel: null, quantity: 5 }] },
          },
        ],
      });
      expect(okLine.subtotalCents).toBe(7500);
      expect(okLine.allocations[0]!.storedCents).toBe(7500);
    });
  });

  describe('Tickets and Lightning Lane Provenance (Requirements 5.10, 14.9, review F2)', () => {
    it('Requirement 14.9: 1-day base ticket with no priceRef.park on a line with park = "Animal Kingdom" stores park = "ak"', async () => {
      const line = await repo.createLine(
        seed.tripId,
        seed.memberId,
        {
          category: 'tickets',
          description: '1-day base ticket',
          park: 'Animal Kingdom',
          priceSource: 'disney_ticket_calendar',
          priceRef: {
            kind: 'ticket',
            discountGroup: 'std-gst',
            numDays: 1,
            ageGroup: 'adult',
            optionCode: 'base',
            startDate: '2026-10-05',
          },
          allocations: [
            {
              memberId: seed.memberId,
              priceRef: {
                kind: 'ticket',
                discountGroup: 'std-gst',
                numDays: 1,
                ageGroup: 'adult',
                optionCode: 'base',
                startDate: '2026-10-05',
              },
            },
          ],
        },
        {
          amounts: [18400],
        },
      );

      expect(line.allocations[0]!.storedCents).toBe(18400);
      const allocRef = line.allocations[0]!.priceRef as { park?: string };
      expect(allocRef.park).toBe('ak');
    });

    it('review F2 & Round 5 L5: LL line created with typical estimate stores price_source = "themeparks_ll" and dateToInstant(newestSampleDate)', async () => {
      const sampleDate = '2026-09-15';
      const expectedInstant = dateToInstant(sampleDate);

      const line = await repo.createLine(
        seed.tripId,
        seed.memberId,
        {
          category: 'lightning_lane',
          description: 'LL Multi Pass',
          park: 'Magic Kingdom',
          priceSource: 'themeparks_ll',
          priceRef: {
            kind: 'll',
            passType: 'multi',
            park: 'Magic Kingdom',
            date: '2026-11-20',
          },
          allocations: [{ memberId: seed.memberId }],
        },
        {
          amounts: [3200],
          newestSampleDate: sampleDate,
          effectivePriceSource: 'typical_estimate',
          labelKind: 'estimate',
        },
      );

      expect(line.priceSource).toBe('themeparks_ll');
      expect(line.effectivePriceSource).toBe('typical_estimate');
      expect(line.priceLabelKind).toBe('estimate');

      // Check DB stored row: price_source is 'themeparks_ll' (never 'typical_estimate')
      const rowRes = await pool.query<{ price_source: string; price_as_of: Date }>(
        'SELECT price_source, price_as_of FROM trip_budget_lines WHERE id = $1',
        [line.id],
      );
      expect(rowRes.rows[0]!.price_source).toBe('themeparks_ll');
      expect(new Date(rowRes.rows[0]!.price_as_of).toISOString()).toBe(expectedInstant.toISOString());

      // Rendered label with wdwDateOf matches sample date
      const label = priceLabelText(line.priceLabelKind, line.effectivePriceSource, wdwDateOf(rowRes.rows[0]!.price_as_of));
      expect(label).toBe('Estimate, as of Sep 15, 2026');
    });
  });

  describe('Edit and Delete Line (Requirements 2.5, 2.9, review F15)', () => {
    it('edit replaces allocations atomically and failing edit leaves old ones', async () => {
      const line = await repo.createLine(seed.tripId, seed.memberId, {
        category: 'other',
        description: 'Original line',
        priceSource: 'user_entered',
        allocations: [{ memberId: seed.memberId, amountCents: 1000 }],
      });

      // Successful edit replaces allocations
      const edited = await repo.editLine(seed.tripId, line.id, seed.memberId, 'member', {
        category: 'other',
        description: 'Edited line',
        priceSource: 'user_entered',
        allocations: [
          { memberId: seed.memberId, amountCents: 1500 },
          { memberId: seed.otherMemberId, amountCents: 1500 },
        ],
      });
      expect(edited.description).toBe('Edited line');
      expect(edited.allocations).toHaveLength(2);
      expect(edited.subtotalCents).toBe(3000);

      // Failing edit (e.g. wrong-trip member added) leaves existing allocations intact
      await expect(
        repo.editLine(seed.tripId, line.id, seed.memberId, 'member', {
          category: 'other',
          description: 'Failing edit',
          priceSource: 'user_entered',
          allocations: [{ memberId: seed.outsideUserId, amountCents: 5000 }],
        }),
      ).rejects.toThrowError(/Member is not on this trip/i);

      // Verify DB still holds 2 allocations
      const allocs = await pool.query(
        'SELECT id, amount_cents FROM trip_budget_allocations WHERE line_id = $1',
        [line.id],
      );
      expect(allocs.rows).toHaveLength(2);
    });

    it('enforces creator or organizer permissions on edit and remove', async () => {
      const line = await repo.createLine(seed.tripId, seed.memberId, {
        category: 'other',
        description: 'Bob line',
        priceSource: 'user_entered',
        allocations: [{ memberId: seed.memberId, amountCents: 1000 }],
      });

      // Carol cannot edit Bob's line
      await expect(
        repo.editLine(seed.tripId, line.id, seed.otherMemberId, 'member', {
          category: 'other',
          description: 'Carol edit',
          priceSource: 'user_entered',
          allocations: [{ memberId: seed.otherMemberId, amountCents: 2000 }],
        }),
      ).rejects.toThrowError(/Only creator or organizer may edit/i);

      // Carol cannot remove Bob's line
      await expect(
        repo.removeLine(seed.tripId, line.id, seed.otherMemberId, 'member'),
      ).rejects.toThrowError(/Only creator or organizer may remove/i);

      // Organizer Alice CAN remove Bob's line
      await expect(
        repo.removeLine(seed.tripId, line.id, seed.organizerId, 'organizer'),
      ).resolves.toBeUndefined();
    });

    it('review F15: editing a line keeping a departed member succeeds, while adding a new non-trip person fails', async () => {
      // 1. Create line with Bob and Carol
      const line = await repo.createLine(seed.tripId, seed.memberId, {
        category: 'other',
        description: 'Shared line',
        priceSource: 'user_entered',
        allocations: [
          { memberId: seed.memberId, amountCents: 1000 },
          { memberId: seed.otherMemberId, amountCents: 1000 },
        ],
      });

      // 2. Simulate Carol departing the trip (membership removed)
      await pool.query(
        'DELETE FROM trip_memberships WHERE trip_id = $1 AND user_id = $2',
        [seed.tripId, seed.otherMemberId],
      );

      // 3. Edit line keeping Carol's existing allocation succeeds (review F15 exemption)
      const edited = await repo.editLine(seed.tripId, line.id, seed.memberId, 'member', {
        category: 'other',
        description: 'Shared line after departure',
        priceSource: 'user_entered',
        allocations: [
          { memberId: seed.memberId, amountCents: 2000 },
          { memberId: seed.otherMemberId, amountCents: 1000 },
        ],
      });
      expect(edited.subtotalCents).toBe(3000);

      // 4. Edit trying to ADD a NEW person not on the trip fails
      await expect(
        repo.editLine(seed.tripId, line.id, seed.memberId, 'member', {
          category: 'other',
          description: 'Adding outside person',
          priceSource: 'user_entered',
          allocations: [
            { memberId: seed.memberId, amountCents: 1000 },
            { memberId: seed.outsideUserId, amountCents: 1000 },
          ],
        }),
      ).rejects.toThrowError(/Member is not on this trip/i);
    });

    it('Requirement 2.9: deleting the linked Experience leaves the line and every amount_cents unchanged', async () => {
      const line = await repo.createLine(seed.tripId, seed.memberId, {
        category: 'dining',
        description: 'Dinner at Be Our Guest',
        experienceId: diningExpId,
        priceSource: 'disney_menu',
        allocations: [
          {
            memberId: seed.memberId,
            priceRef: { kind: 'menu', items: [{ name: 'Burger', priceCents: 1500, priceLabel: null, quantity: 2 }] },
          },
        ],
      });

      expect(line.experienceId).toBe(diningExpId);
      expect(line.subtotalCents).toBe(3000);

      // Delete the experience
      await pool.query('DELETE FROM experiences WHERE id = $1', [diningExpId]);

      // Line survives with experience_id NULL and amount_cents intact
      const checkRes = await pool.query<{ experience_id: string | null }>(
        'SELECT experience_id FROM trip_budget_lines WHERE id = $1',
        [line.id],
      );
      expect(checkRes.rows[0]!.experience_id).toBeNull();

      const allocRes = await pool.query<{ amount_cents: number }>(
        'SELECT amount_cents FROM trip_budget_allocations WHERE line_id = $1',
        [line.id],
      );
      expect(allocRes.rows[0]!.amount_cents).toBe(3000);
    });
  });
});
