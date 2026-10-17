/**
 * Integration tests for TripBookingRepo Part A: settings, done marks, mutes, and timeline inputs.
 *
 * Validates: Requirements 2.4, 2.5, 2.7, 3.8, 3.11, 5.1, 5.2, 5.6, 9.8, 14.1, 14.4, 14.6
 */

import { randomUUID } from 'node:crypto';
import fc from 'fast-check';
import type { Pool } from 'pg';
import { beforeEach, describe, expect, it } from 'vitest';
import type { WindowKind } from '@dwt/shared';

import { AppError } from '../../../errors/AppError.js';
import { createTripBookingRepo, type TripBookingRepo } from '../repo.js';
import { setupTestDb } from './testDb.js';

describe('TripBookingRepo Part A — Settings, Done, Mutes, Inputs', () => {
  let pool: Pool;
  let repo: TripBookingRepo;
  let tripId: string;
  let userId1: string;
  let userId2: string;

  beforeEach(async () => {
    const testDb = setupTestDb();
    pool = testDb.pool;
    repo = createTripBookingRepo(pool as any);

    userId1 = randomUUID();
    userId2 = randomUUID();
    tripId = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'alice@example.com', 'hash1'),
              ($2, 'bob@example.com', 'hash2')`,
      [userId1, userId2],
    );
    await pool.query(
      `INSERT INTO profiles (user_id, display_name)
       VALUES ($1, 'Alice'),
              ($2, 'Bob')`,
      [userId1, userId2],
    );
    await pool.query(
      `INSERT INTO trips (id, creator_id, name, start_date, end_date)
       VALUES ($1, $2, 'Disney Fun', '2026-10-01', '2026-10-10')`,
      [tripId, userId1],
    );
    await pool.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role)
       VALUES ($1, $2, 'organizer'),
              ($1, $3, 'member')`,
      [tripId, userId1, userId2],
    );
  });

  // Feature: trip-booking-timeline, Property 11: Done and mute writes are idempotent, one row per key
  describe('Property 11: Done and mute writes are idempotent, one row per key', () => {
    it('done=true on an existing mark preserves original marked_by and marked_at; done=false deletes it', async () => {
      // First mark
      await repo.setWindowDone(tripId, 'dining', '2026-08-02', true, userId1);

      const firstRead = await pool.query<{ marked_by: string; marked_at: Date | string }>(
        `SELECT marked_by, marked_at FROM trip_booking_window_done WHERE trip_id = $1 AND window_kind = 'dining' AND drop_on = '2026-08-02'`,
        [tripId],
      );
      expect(firstRead.rows).toHaveLength(1);
      const originalMarkedBy = firstRead.rows[0]!.marked_by;
      const originalMarkedAt = new Date(firstRead.rows[0]!.marked_at).toISOString();
      expect(originalMarkedBy).toBe(userId1);

      // Second mark with different user
      await repo.setWindowDone(tripId, 'dining', '2026-08-02', true, userId2);

      const secondRead = await pool.query<{ marked_by: string; marked_at: Date | string }>(
        `SELECT marked_by, marked_at FROM trip_booking_window_done WHERE trip_id = $1 AND window_kind = 'dining' AND drop_on = '2026-08-02'`,
        [tripId],
      );
      expect(secondRead.rows).toHaveLength(1);
      expect(secondRead.rows[0]!.marked_by).toBe(originalMarkedBy);
      expect(new Date(secondRead.rows[0]!.marked_at).toISOString()).toBe(originalMarkedAt);

      // done=false removes the mark
      await repo.setWindowDone(tripId, 'dining', '2026-08-02', false, userId1);

      const thirdRead = await pool.query(
        `SELECT * FROM trip_booking_window_done WHERE trip_id = $1 AND window_kind = 'dining' AND drop_on = '2026-08-02'`,
        [tripId],
      );
      expect(thirdRead.rows).toHaveLength(0);
    });

    it('Property 11: property-based random operation sequences leave at most one row per key', async () => {
      type Op =
        | { type: 'done'; kind: WindowKind; dropOn: string; done: boolean; user: string }
        | { type: 'mute'; user: string; muted: boolean }
        | { type: 'settings'; stayType: 'resort' | 'offsite' | null };

      const opArb: fc.Arbitrary<Op> = fc.oneof(
        fc.record({
          type: fc.constant('done' as const),
          kind: fc.constantFrom('dining' as const, 'lightning_lane' as const),
          dropOn: fc.constantFrom('2026-08-02', '2026-09-24'),
          done: fc.boolean(),
          user: fc.constantFrom(userId1, userId2),
        }),
        fc.record({
          type: fc.constant('mute' as const),
          user: fc.constantFrom(userId1, userId2),
          muted: fc.boolean(),
        }),
        fc.record({
          type: fc.constant('settings' as const),
          stayType: fc.constantFrom('resort' as const, 'offsite' as const, null),
        }),
      );

      await fc.assert(
        fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 8 }), async (ops) => {
          for (const op of ops) {
            if (op.type === 'done') {
              await repo.setWindowDone(tripId, op.kind, op.dropOn, op.done, op.user);
            } else if (op.type === 'mute') {
              await repo.setReminderMute(tripId, op.user, op.muted);
            } else if (op.type === 'settings') {
              await repo.patchBookingSettings(tripId, { stayType: op.stayType });
            }
          }

          // Assert at most one row per (trip, kind, dropOn)
          const doneRows = await pool.query<{ count: string; window_kind: string; drop_on: string }>(
            `SELECT count(*)::text as count, window_kind, drop_on
               FROM trip_booking_window_done
              WHERE trip_id = $1
              GROUP BY window_kind, drop_on`,
            [tripId],
          );
          for (const r of doneRows.rows) {
            expect(parseInt(r.count, 10)).toBe(1);
          }

          // Assert at most one row per (trip, user)
          const muteRows = await pool.query<{ count: string; user_id: string }>(
            `SELECT count(*)::text as count, user_id
               FROM trip_booking_reminder_mutes
              WHERE trip_id = $1
              GROUP BY user_id`,
            [tripId],
          );
          for (const r of muteRows.rows) {
            expect(parseInt(r.count, 10)).toBe(1);
          }

          // Assert at most one settings row per trip
          const settingsRows = await pool.query<{ count: string }>(
            `SELECT count(*)::text as count FROM trip_booking_settings WHERE trip_id = $1`,
            [tripId],
          );
          expect(parseInt(settingsRows.rows[0]?.count ?? '0', 10)).toBeLessThanOrEqual(1);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Raw SQL read-back regression tests for patchBookingSettings', () => {
    it('after patchBookingSettings({ stayType: "resort" }) the row has stay_type="resort" and others null', async () => {
      const res = await repo.patchBookingSettings(tripId, { stayType: 'resort' });
      expect(res.stayType).toBe('resort');
      expect(res.lightningLaneTiming).toBeNull();
      expect(res.checkInOverride).toBeNull();

      // Read back with raw SQL
      const raw = await pool.query<{ stay_type: string; lightning_lane_timing: string | null; check_in_override: string | null }>(
        `SELECT stay_type, lightning_lane_timing, check_in_override FROM trip_booking_settings WHERE trip_id = $1`,
        [tripId],
      );
      expect(raw.rows).toHaveLength(1);
      expect(raw.rows[0]!.stay_type).toBe('resort');
      expect(raw.rows[0]!.lightning_lane_timing).toBeNull();
      expect(raw.rows[0]!.check_in_override).toBeNull();
    });

    it('after { lightningLaneTiming: null } that column is NULL while sibling stayType is untouched', async () => {
      // Set both fields first
      await repo.patchBookingSettings(tripId, { stayType: 'resort', lightningLaneTiming: 'seven_day' });

      // Update with lightningLaneTiming: null explicitly
      const res = await repo.patchBookingSettings(tripId, { lightningLaneTiming: null });
      expect(res.stayType).toBe('resort');
      expect(res.lightningLaneTiming).toBeNull();

      // Read back with raw SQL
      const raw = await pool.query<{ stay_type: string; lightning_lane_timing: string | null }>(
        `SELECT stay_type, lightning_lane_timing FROM trip_booking_settings WHERE trip_id = $1`,
        [tripId],
      );
      expect(raw.rows).toHaveLength(1);
      expect(raw.rows[0]!.stay_type).toBe('resort');
      expect(raw.rows[0]!.lightning_lane_timing).toBeNull();
    });

    it('an out-of-range override throws trip_validation_failed and row is untouched, including valid sibling field', async () => {
      // Seed initial state
      await repo.patchBookingSettings(tripId, { stayType: 'resort' });

      // Attempt patch with out-of-range override (> 30 days before trip start 2026-10-01) and sibling field
      await expect(
        repo.patchBookingSettings(tripId, {
          stayType: 'offsite',
          checkInOverride: '2026-08-01',
        }),
      ).rejects.toThrow(AppError);

      // Raw SQL check: stay_type is still 'resort', check_in_override is still NULL
      const raw = await pool.query<{ stay_type: string; check_in_override: string | null }>(
        `SELECT stay_type, check_in_override FROM trip_booking_settings WHERE trip_id = $1`,
        [tripId],
      );
      expect(raw.rows).toHaveLength(1);
      expect(raw.rows[0]!.stay_type).toBe('resort');
      expect(raw.rows[0]!.check_in_override).toBeNull();
    });

    it('an override that becomes invalid after trip start moves is retained in the row and returned by getTimelineInputs', async () => {
      // Store valid override (10 days before 2026-10-01)
      await repo.patchBookingSettings(tripId, { checkInOverride: '2026-09-20' });

      // Trip start date moves to 2026-11-01 (now 2026-09-20 is > 30 days before start)
      await pool.query(`UPDATE trips SET start_date = '2026-11-01', end_date = '2026-11-10' WHERE id = $1`, [tripId]);

      // Row still holds stored value
      const raw = await pool.query<{ check_in_override: Date | string }>(
        `SELECT check_in_override FROM trip_booking_settings WHERE trip_id = $1`,
        [tripId],
      );
      expect(raw.rows).toHaveLength(1);
      const val = raw.rows[0]!.check_in_override;
      const formatted = typeof val === 'string' ? val.slice(0, 10) : val.toISOString().slice(0, 10);
      expect(formatted).toBe('2026-09-20');

      // getTimelineInputs still returns it
      const inputs = await repo.getTimelineInputs(tripId, userId1);
      expect(inputs?.settings?.checkInOverride).toBe('2026-09-20');
    });
  });

  describe('getTimelineInputs behavior', () => {
    it('performs no writes (row counts of all five tables identical before and after)', async () => {
      // Populate rows
      await repo.patchBookingSettings(tripId, { stayType: 'resort' });
      await repo.setWindowDone(tripId, 'dining', '2026-08-02', true, userId1);
      await repo.setReminderMute(tripId, userId1, true);

      const countTable = async (table: string): Promise<number> => {
        const res = await pool.query<{ count: string }>(`SELECT count(*)::text as count FROM ${table}`);
        return parseInt(res.rows[0]?.count ?? '0', 10);
      };

      const beforeCounts = {
        settings: await countTable('trip_booking_settings'),
        done: await countTable('trip_booking_window_done'),
        mutes: await countTable('trip_booking_reminder_mutes'),
        log: await countTable('trip_booking_reminder_log'),
        packing: await countTable('trip_packing_items'),
      };

      const result = await repo.getTimelineInputs(tripId, userId1);
      expect(result).not.toBeNull();

      const afterCounts = {
        settings: await countTable('trip_booking_settings'),
        done: await countTable('trip_booking_window_done'),
        mutes: await countTable('trip_booking_reminder_mutes'),
        log: await countTable('trip_booking_reminder_log'),
        packing: await countTable('trip_packing_items'),
      };

      expect(afterCounts).toEqual(beforeCounts);
    });

    it('returns null for an unknown Trip', async () => {
      const result = await repo.getTimelineInputs(randomUUID(), userId1);
      expect(result).toBeNull();
    });

    it('viewerMuted is true only for the caller who muted', async () => {
      await repo.setReminderMute(tripId, userId1, true);

      const inputs1 = await repo.getTimelineInputs(tripId, userId1);
      expect(inputs1?.viewerMuted).toBe(true);

      const inputs2 = await repo.getTimelineInputs(tripId, userId2);
      expect(inputs2?.viewerMuted).toBe(false);
    });

    it('cascade delete of the Trip removes all rows across booking tables', async () => {
      await repo.patchBookingSettings(tripId, { stayType: 'resort' });
      await repo.setWindowDone(tripId, 'dining', '2026-08-02', true, userId1);
      await repo.setReminderMute(tripId, userId1, true);

      // Delete trip
      await pool.query(`DELETE FROM trips WHERE id = $1`, [tripId]);

      const inputs = await repo.getTimelineInputs(tripId, userId1);
      expect(inputs).toBeNull();

      const s = await pool.query(`SELECT * FROM trip_booking_settings WHERE trip_id = $1`, [tripId]);
      const d = await pool.query(`SELECT * FROM trip_booking_window_done WHERE trip_id = $1`, [tripId]);
      const m = await pool.query(`SELECT * FROM trip_booking_reminder_mutes WHERE trip_id = $1`, [tripId]);
      expect(s.rows).toHaveLength(0);
      expect(d.rows).toHaveLength(0);
      expect(m.rows).toHaveLength(0);
    });
  });
});
