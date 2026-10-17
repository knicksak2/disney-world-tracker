/**
 * Integration tests for TripBookingRepo Part C: packing list.
 *
 * Validates: Requirements 11.1–11.11, 11.13, 14.5
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { beforeEach, describe, expect, it } from 'vitest';
import { STARTER_PACKING_LIST } from '@dwt/shared';

import { AppError } from '../../../errors/AppError.js';
import { createTripBookingRepo, type TripBookingRepo } from '../repo.js';
import { setupTestDb } from './testDb.js';

describe('TripBookingRepo Part C — Packing List', () => {
  let pool: Pool;
  let repo: TripBookingRepo;
  let recordedQueries: string[];
  let tripId: string;
  let otherTripId: string;
  let organizerId: string;
  let memberId: string;
  let nonMemberId: string;

  beforeEach(async () => {
    const testDb = setupTestDb();
    pool = testDb.pool;
    recordedQueries = testDb.recordedQueries;
    repo = createTripBookingRepo(pool as any);

    organizerId = randomUUID();
    memberId = randomUUID();
    nonMemberId = randomUUID();
    tripId = randomUUID();
    otherTripId = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'alice@example.com', 'hash1'),
              ($2, 'bob@example.com', 'hash2'),
              ($3, 'charlie@example.com', 'hash3')`,
      [organizerId, memberId, nonMemberId],
    );
    await pool.query(
      `INSERT INTO profiles (user_id, display_name)
       VALUES ($1, 'Alice'),
              ($2, 'Bob'),
              ($3, 'Charlie')`,
      [organizerId, memberId, nonMemberId],
    );
    await pool.query(
      `INSERT INTO trips (id, creator_id, name, start_date, end_date)
       VALUES ($1, $2, 'Disney Vacation', '2026-10-01', '2026-10-10'),
              ($3, $4, 'Other Trip', '2026-11-01', '2026-11-10')`,
      [tripId, organizerId, otherTripId, organizerId],
    );
    await pool.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role)
       VALUES ($1, $2, 'organizer'),
              ($1, $3, 'member'),
              ($4, $5, 'organizer')`,
      [tripId, organizerId, memberId, otherTripId, organizerId],
    );
  });

  // Feature: trip-booking-timeline, Property 30 (repo half): The list never exceeds 300; batch adds are all-or-nothing
  describe('Property 30 (repo half): Packing list cap of 300 and all-or-nothing batch adds', () => {
    it('bulk inserts 299 items, adds 1 to reach 300, and rejects the 301st item with trip_validation_failed', async () => {
      // Bulk insert 299 items
      const params: unknown[] = [tripId, organizerId];
      const valueClauses: string[] = [];
      for (let i = 1; i <= 299; i++) {
        const pName = params.push(`Item ${i}`);
        valueClauses.push(`($1, $${pName}, 'other', 1, $2, false)`);
      }
      await pool.query(
        `INSERT INTO trip_packing_items (trip_id, name, category, quantity, added_by, packed)
         VALUES ${valueClauses.join(', ')}`,
        params,
      );

      const countCheck1 = await pool.query<{ count: string }>(
        `SELECT count(*)::text as count FROM trip_packing_items WHERE trip_id = $1`,
        [tripId],
      );
      expect(parseInt(countCheck1.rows[0]?.count ?? '0', 10)).toBe(299);

      // Add 1 more item (should succeed, count becomes 300)
      const item300 = await repo.addPackingItem(tripId, organizerId, {
        name: 'Item 300',
        category: 'park_gear',
      });
      expect(item300.name).toBe('Item 300');

      const countCheck2 = await pool.query<{ count: string }>(
        `SELECT count(*)::text as count FROM trip_packing_items WHERE trip_id = $1`,
        [tripId],
      );
      expect(parseInt(countCheck2.rows[0]?.count ?? '0', 10)).toBe(300);

      // Attempt to add 301st item -> must reject with trip_validation_failed
      await expect(
        repo.addPackingItem(tripId, organizerId, {
          name: 'Item 301',
          category: 'park_gear',
        }),
      ).rejects.toThrow(AppError);

      // Verify count is still 300
      const countCheck3 = await pool.query<{ count: string }>(
        `SELECT count(*)::text as count FROM trip_packing_items WHERE trip_id = $1`,
        [tripId],
      );
      expect(parseInt(countCheck3.rows[0]?.count ?? '0', 10)).toBe(300);
    });

    it('with 295 items a starter run needing 21 throws trip_validation_failed and adds nothing (atomicity)', async () => {
      // Bulk insert 295 items
      const params: unknown[] = [tripId, organizerId];
      const valueClauses: string[] = [];
      for (let i = 1; i <= 295; i++) {
        const pName = params.push(`Item ${i}`);
        valueClauses.push(`($1, $${pName}, 'other', 1, $2, false)`);
      }
      await pool.query(
        `INSERT INTO trip_packing_items (trip_id, name, category, quantity, added_by, packed)
         VALUES ${valueClauses.join(', ')}`,
        params,
      );

      // Starter list has 21 entries. 295 + 21 = 316 > 300 -> must throw and add nothing
      await expect(repo.addStarterItems(tripId, organizerId)).rejects.toThrow(AppError);

      const countCheck = await pool.query<{ count: string }>(
        `SELECT count(*)::text as count FROM trip_packing_items WHERE trip_id = $1`,
        [tripId],
      );
      expect(parseInt(countCheck.rows[0]?.count ?? '0', 10)).toBe(295);
    });

    it('issues SELECT id FROM trips WHERE id = $1 FOR UPDATE before reading the count', async () => {
      recordedQueries.length = 0;
      await repo.addPackingItem(tripId, organizerId, { name: 'Locked Item', category: 'tech' });

      // Find indices of the lock query and the count query
      const lockQueryIdx = recordedQueries.findIndex((q) =>
        q.includes('SELECT id FROM trips WHERE id = $1 FOR UPDATE'),
      );
      const countQueryIdx = recordedQueries.findIndex((q) =>
        q.includes('SELECT count(*)::text AS count FROM trip_packing_items WHERE trip_id = $1'),
      );

      expect(lockQueryIdx).toBeGreaterThanOrEqual(0);
      expect(countQueryIdx).toBeGreaterThanOrEqual(0);
      expect(lockQueryIdx).toBeLessThan(countQueryIdx);
    });
  });

  // Feature: trip-booking-timeline, Property 31 (repo half): Starter is idempotent
  describe('Property 31 (repo half): Starter is idempotent', () => {
    it('running addStarterItems twice returns STARTER_PACKING_LIST.length then 0', async () => {
      const addedFirst = await repo.addStarterItems(tripId, organizerId);
      expect(addedFirst).toBe(STARTER_PACKING_LIST.length);

      const addedSecond = await repo.addStarterItems(tripId, organizerId);
      expect(addedSecond).toBe(0);

      // Raw SQL check on stored rows
      const rows = await pool.query<{ name: string; category: string; quantity: number; added_by: string }>(
        `SELECT name, category, quantity, added_by FROM trip_packing_items WHERE trip_id = $1`,
        [tripId],
      );
      expect(rows.rows).toHaveLength(STARTER_PACKING_LIST.length);

      for (const entry of STARTER_PACKING_LIST) {
        const stored = rows.rows.find((r) => r.name.toLowerCase() === entry.name.toLowerCase());
        expect(stored).toBeDefined();
        expect(stored!.category).toBe(entry.category);
        expect(stored!.quantity).toBe(entry.quantity);
        expect(stored!.added_by).toBe(organizerId);
      }
    });

    it('pre-existing item " sunscreen " suppresses the Sunscreen entry from starter list', async () => {
      // Pre-insert " sunscreen " with extra whitespace
      await pool.query(
        `INSERT INTO trip_packing_items (trip_id, name, category, quantity, added_by)
         VALUES ($1, ' sunscreen ', 'toiletries', 1, $2)`,
        [tripId, organizerId],
      );

      const added = await repo.addStarterItems(tripId, organizerId);
      // STARTER_PACKING_LIST has Sunscreen, so exactly STARTER_PACKING_LIST.length - 1 items should be added
      expect(added).toBe(STARTER_PACKING_LIST.length - 1);

      // Check how many items are named sunscreen
      const sunscreenRows = await pool.query(
        `SELECT * FROM trip_packing_items WHERE trip_id = $1 AND lower(trim(name)) = 'sunscreen'`,
        [tripId],
      );
      expect(sunscreenRows.rows).toHaveLength(1);
    });
  });

  // Feature: trip-booking-timeline, Property 33 (repo half): Packed transitions persist
  describe('Property 33 (repo half): Packed transitions persist', () => {
    it('setPacked(true) stores packed_by and packed_at; repeating it leaves packed_at unchanged; setPacked(false) clears both', async () => {
      const item = await repo.addPackingItem(tripId, organizerId, {
        name: 'Passport',
        category: 'documents',
      });
      expect(item.packed).toBe(false);
      expect(item.packedAt).toBeNull();
      expect(item.packedByDisplayName).toBeNull();

      // Set to packed
      const packedItem = await repo.setPacked(tripId, item.id, memberId, true);
      expect(packedItem.packed).toBe(true);
      expect(packedItem.packedAt).not.toBeNull();
      expect(packedItem.packedByDisplayName).toBe('Bob');

      const initialPackedAt = packedItem.packedAt;

      // Repeat setPacked(true)
      const repeatPacked = await repo.setPacked(tripId, item.id, memberId, true);
      expect(repeatPacked.packed).toBe(true);
      expect(repeatPacked.packedAt).toBe(initialPackedAt);

      // Raw SQL check
      const raw1 = await pool.query<{ packed: boolean; packed_by: string; packed_at: Date | string }>(
        `SELECT packed, packed_by, packed_at FROM trip_packing_items WHERE id = $1`,
        [item.id],
      );
      expect(raw1.rows[0]!.packed).toBe(true);
      expect(raw1.rows[0]!.packed_by).toBe(memberId);
      expect(new Date(raw1.rows[0]!.packed_at).toISOString()).toBe(initialPackedAt);

      // Set to unpacked
      const unpackedItem = await repo.setPacked(tripId, item.id, memberId, false);
      expect(unpackedItem.packed).toBe(false);
      expect(unpackedItem.packedAt).toBeNull();
      expect(unpackedItem.packedByDisplayName).toBeNull();

      // Raw SQL check: both are NULL
      const raw2 = await pool.query<{ packed: boolean; packed_by: string | null; packed_at: string | null }>(
        `SELECT packed, packed_by, packed_at FROM trip_packing_items WHERE id = $1`,
        [item.id],
      );
      expect(raw2.rows[0]!.packed).toBe(false);
      expect(raw2.rows[0]!.packed_by).toBeNull();
      expect(raw2.rows[0]!.packed_at).toBeNull();
    });
  });

  // Feature: trip-booking-timeline, Property 34 (repo half): Assignee projection
  describe('Property 34 (repo half): Assignee projection and membership validation', () => {
    it('adding with a non-member assigneeId throws trip_validation_failed and writes no row', async () => {
      await expect(
        repo.addPackingItem(tripId, organizerId, {
          name: 'Invalid Item',
          category: 'tech',
          assigneeId: nonMemberId,
        }),
      ).rejects.toThrow(AppError);

      const check = await pool.query(`SELECT * FROM trip_packing_items WHERE trip_id = $1`, [tripId]);
      expect(check.rows).toHaveLength(0);
    });

    it('after assignee leaves trip, listPacking projects assignee as unassigned while stored assignee_id is preserved', async () => {
      const item = await repo.addPackingItem(tripId, organizerId, {
        name: 'Camera',
        category: 'tech',
        assigneeId: memberId,
      });
      expect(item.assigneeId).toBe(memberId);
      expect(item.assigneeDisplayName).toBe('Bob');

      // Member leaves the trip (delete membership)
      await pool.query(`DELETE FROM trip_memberships WHERE trip_id = $1 AND user_id = $2`, [tripId, memberId]);

      // listPacking should project unassigned
      const list = await repo.listPacking(tripId);
      expect(list.items).toHaveLength(1);
      expect(list.items[0]!.assigneeId).toBeNull();
      expect(list.items[0]!.assigneeDisplayName).toBeNull();

      // Raw SQL check: stored assignee_id is unchanged
      const raw = await pool.query<{ assignee_id: string }>(
        `SELECT assignee_id FROM trip_packing_items WHERE id = $1`,
        [item.id],
      );
      expect(raw.rows[0]!.assignee_id).toBe(memberId);
    });
  });

  describe('CRUD read-back regression tests', () => {
    it('addPackingItem trims name, defaults quantity to 1, sets packed=false', async () => {
      const item = await repo.addPackingItem(tripId, organizerId, {
        name: '   Rain Poncho   ',
        category: 'park_gear',
      });
      expect(item.name).toBe('Rain Poncho');
      expect(item.quantity).toBe(1);

      // Raw SQL check
      const raw = await pool.query<{
        name: string;
        category: string;
        quantity: number;
        added_by: string;
        packed: boolean;
        packed_by: string | null;
        packed_at: string | null;
      }>(`SELECT name, category, quantity, added_by, packed, packed_by, packed_at FROM trip_packing_items WHERE id = $1`, [
        item.id,
      ]);
      expect(raw.rows[0]!.name).toBe('Rain Poncho');
      expect(raw.rows[0]!.category).toBe('park_gear');
      expect(raw.rows[0]!.quantity).toBe(1);
      expect(raw.rows[0]!.added_by).toBe(organizerId);
      expect(raw.rows[0]!.packed).toBe(false);
      expect(raw.rows[0]!.packed_by).toBeNull();
      expect(raw.rows[0]!.packed_at).toBeNull();
    });

    it('getPackingItemOwner returns null for an item belonging to another trip', async () => {
      const item = await repo.addPackingItem(tripId, organizerId, {
        name: 'Goggles',
        category: 'park_gear',
      });

      const owner = await repo.getPackingItemOwner(otherTripId, item.id);
      expect(owner).toBeNull();

      const realOwner = await repo.getPackingItemOwner(tripId, item.id);
      expect(realOwner?.addedBy).toBe(organizerId);
    });

    it('updatePackingItem updates supplied fields, leaves omitted fields and packed state unchanged, sets null assignee', async () => {
      const item = await repo.addPackingItem(tripId, organizerId, {
        name: 'Batteries',
        category: 'tech',
        quantity: 4,
        assigneeId: memberId,
      });

      // Update name and clear assignee
      const updated = await repo.updatePackingItem(tripId, item.id, {
        name: 'AA Batteries',
        assigneeId: null,
      });
      expect(updated.name).toBe('AA Batteries');
      expect(updated.category).toBe('tech');
      expect(updated.quantity).toBe(4);
      expect(updated.assigneeId).toBeNull();
      expect(updated.assigneeDisplayName).toBeNull();

      // Raw SQL check
      const raw = await pool.query<{ name: string; category: string; quantity: number; assignee_id: string | null }>(
        `SELECT name, category, quantity, assignee_id FROM trip_packing_items WHERE id = $1`,
        [item.id],
      );
      expect(raw.rows[0]!.name).toBe('AA Batteries');
      expect(raw.rows[0]!.category).toBe('tech');
      expect(raw.rows[0]!.quantity).toBe(4);
      expect(raw.rows[0]!.assignee_id).toBeNull();
    });

    it('removePackingItem removes row and listPacking counts drop', async () => {
      const item1 = await repo.addPackingItem(tripId, organizerId, { name: 'Item 1', category: 'other' });
      await repo.addPackingItem(tripId, organizerId, { name: 'Item 2', category: 'other' });

      let list = await repo.listPacking(tripId);
      expect(list.totalCount).toBe(2);

      await repo.removePackingItem(tripId, item1.id);

      list = await repo.listPacking(tripId);
      expect(list.totalCount).toBe(1);
      expect(list.items[0]!.id).not.toBe(item1.id);

      const raw = await pool.query(`SELECT * FROM trip_packing_items WHERE id = $1`, [item1.id]);
      expect(raw.rows).toHaveLength(0);
    });
  });
});
