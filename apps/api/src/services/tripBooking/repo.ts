/**
 * Trip Booking Timeline — Postgres persistence and transactional operations.
 *
 * Implements:
 *   - Part A: Timeline inputs, settings, done marks, reminder mutes (Task 5.4)
 *   - Part B: Reminder runner port (candidates, done keys, claims, recipients, prune) (Task 5.5)
 *   - Part C: Packing list with Trip row lock capacity checks (Task 5.6)
 *
 * Validates: Requirements 2.4, 2.5, 2.7, 3.8, 3.11, 4.3, 5.1, 5.2, 5.6,
 *            7.7, 9.1, 9.2, 9.4, 9.8, 11.1–11.11, 11.13, 14.1–14.6
 */

import type { PoolClient } from 'pg';
import type { z } from 'zod';
import type {
  BookingSettingsDTO,
  PackingItemDTO,
  PackingListDTO,
  StayType,
  LightningLaneTiming,
  WindowKind,
  packingItemCreateSchema,
  packingItemUpdateSchema,
} from '@dwt/shared';
import { STARTER_PACKING_LIST } from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { formatCalendarDate } from '../trips/repo.js';
import {
  nextPackedState,
  normalizeName,
  projectAssignee,
  selectStarterToAdd,
  sortPackingItems,
  summarizePacking,
  wouldExceedCap,
} from './packing.js';
import { ledgerKey, type DueReminder } from './reminders.js';
import type { CandidateTrip, ReminderRunnerRepo } from './runner.js';
import { applySettingsUpdate, type BookingSettingsUpdate } from './settings.js';
import type { StoredBookingSettings } from './timeline.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface TimelineReadModel {
  readonly trip: { startDate: string; endDate: string };
  readonly hasResortStay: boolean;
  readonly settings: StoredBookingSettings | null;
  readonly doneMarks: ReadonlyMap<string, { markedAt: string; markedByDisplayName: string }>;
  readonly reservations: readonly { kind: string; plannedDate: string }[];
  readonly viewerMuted: boolean;
}

export interface BookingTimelineRepo {
  getTimelineInputs(tripId: string, viewerId: string): Promise<TimelineReadModel | null>;
  patchBookingSettings(tripId: string, update: BookingSettingsUpdate): Promise<BookingSettingsDTO>;
  setWindowDone(tripId: string, kind: WindowKind, dropOn: string, done: boolean, userId: string): Promise<void>;
  setReminderMute(tripId: string, userId: string, muted: boolean): Promise<boolean>;
}

export interface PackingRepo {
  listPacking(tripId: string): Promise<PackingListDTO>;
  getPackingItemOwner(tripId: string, itemId: string): Promise<{ addedBy: string } | null>;
  addPackingItem(tripId: string, adderId: string, input: z.infer<typeof packingItemCreateSchema>): Promise<PackingItemDTO>;
  updatePackingItem(tripId: string, itemId: string, patch: z.infer<typeof packingItemUpdateSchema>): Promise<PackingItemDTO>;
  removePackingItem(tripId: string, itemId: string): Promise<void>;
  setPacked(tripId: string, itemId: string, userId: string, packed: boolean): Promise<PackingItemDTO>;
  addStarterItems(tripId: string, adderId: string): Promise<number>;
}

export type TripBookingRepo = BookingTimelineRepo & PackingRepo & ReminderRunnerRepo;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function withTx<T>(pool: DbPool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createTripBookingRepo(pool: DbPool): TripBookingRepo {
  return {
    // =========================================================================
    // Part A: Timeline Inputs, Settings, Done Marks, Mutes
    // =========================================================================

    async getTimelineInputs(tripId: string, viewerId: string): Promise<TimelineReadModel | null> {
      // 1. Trip + settings + resort flag + viewer mute (R3.8: read-only)
      const tripRes = await pool.query<{
        start_date: Date | string;
        end_date: Date | string;
        has_resort_stay: boolean;
        stay_type: StayType | null;
        lightning_lane_timing: LightningLaneTiming | null;
        check_in_override: Date | string | null;
        viewer_muted: boolean;
      }>(
        `SELECT t.start_date, t.end_date,
                EXISTS (SELECT 1 FROM trip_resorts r WHERE r.trip_id = $1) AS has_resort_stay,
                s.stay_type, s.lightning_lane_timing, s.check_in_override,
                EXISTS (SELECT 1 FROM trip_booking_reminder_mutes m WHERE m.trip_id = $1 AND m.user_id = $2) AS viewer_muted
           FROM trips t
           LEFT JOIN trip_booking_settings s ON s.trip_id = t.id
          WHERE t.id = $1`,
        [tripId, viewerId],
      );

      const tripRow = tripRes.rows[0];
      if (!tripRow) {
        return null;
      }

      const startDate = formatCalendarDate(tripRow.start_date);
      const endDate = formatCalendarDate(tripRow.end_date);
      if (!startDate || !endDate) {
        return null;
      }

      const settings: StoredBookingSettings | null =
        tripRow.stay_type !== null || tripRow.lightning_lane_timing !== null || tripRow.check_in_override !== null
          ? {
              stayType: tripRow.stay_type ?? null,
              lightningLaneTiming: tripRow.lightning_lane_timing ?? null,
              checkInOverride: formatCalendarDate(tripRow.check_in_override),
            }
          : null;

      // 2. Done marks
      const doneRes = await pool.query<{
        window_kind: WindowKind;
        drop_on: Date | string;
        marked_at: Date | string;
        name: string;
      }>(
        `SELECT d.window_kind, d.drop_on, d.marked_at, COALESCE(p.display_name, 'Someone') AS name
           FROM trip_booking_window_done d
           LEFT JOIN profile_identity p ON p.user_id = d.marked_by
          WHERE d.trip_id = $1`,
        [tripId],
      );

      const doneMarks = new Map<string, { markedAt: string; markedByDisplayName: string }>();
      for (const d of doneRes.rows) {
        const dropOn = formatCalendarDate(d.drop_on);
        if (dropOn) {
          doneMarks.set(`${d.window_kind}:${dropOn}`, {
            markedAt: new Date(d.marked_at).toISOString(),
            markedByDisplayName: d.name,
          });
        }
      }

      // 3. Planned reservations for bookedCount
      const resRes = await pool.query<{
        reservation_kind: string;
        planned_date: Date | string;
      }>(
        `SELECT reservation_kind, planned_date
           FROM planned_items
          WHERE trip_id = $1
            AND reservation_kind IN ('dining', 'lightning_lane')
            AND planned_date IS NOT NULL`,
        [tripId],
      );

      const reservations: { kind: string; plannedDate: string }[] = [];
      for (const r of resRes.rows) {
        const d = formatCalendarDate(r.planned_date);
        if (d) {
          reservations.push({ kind: r.reservation_kind, plannedDate: d });
        }
      }

      return {
        trip: { startDate, endDate },
        hasResortStay: Boolean(tripRow.has_resort_stay),
        settings,
        doneMarks,
        reservations,
        viewerMuted: Boolean(tripRow.viewer_muted),
      };
    },

    async patchBookingSettings(tripId: string, update: BookingSettingsUpdate): Promise<BookingSettingsDTO> {
      return withTx(pool, async (client) => {
        // 1. Lock trip row and read trip start date (R2.5, R2.10)
        const tripRes = await client.query<{ start_date: Date | string }>(
          `SELECT start_date FROM trips WHERE id = $1 FOR UPDATE`,
          [tripId],
        );
        const tripRow = tripRes.rows[0];
        if (!tripRow) {
          throw new AppError('trip_forbidden', 'Trip not found or inaccessible');
        }
        const tripStart = formatCalendarDate(tripRow.start_date);
        if (!tripStart) {
          throw new AppError('trip_forbidden', 'Trip start date is missing');
        }

        // 2. Read current settings row
        const curRes = await client.query<{
          stay_type: StayType | null;
          lightning_lane_timing: LightningLaneTiming | null;
          check_in_override: Date | string | null;
        }>(
          `SELECT stay_type, lightning_lane_timing, check_in_override
             FROM trip_booking_settings
            WHERE trip_id = $1`,
          [tripId],
        );
        const curRow = curRes.rows[0];
        const current: StoredBookingSettings = {
          stayType: curRow?.stay_type ?? null,
          lightningLaneTiming: curRow?.lightning_lane_timing ?? null,
          checkInOverride: curRow ? formatCalendarDate(curRow.check_in_override) : null,
        };

        // 3. Null-aware merge & validation (throws AppError('trip_validation_failed') on invalid override)
        const next = applySettingsUpdate(current, update, tripStart);

        // 4. Full-row upsert
        const upsertRes = await client.query<{
          trip_id: string;
          stay_type: StayType | null;
          lightning_lane_timing: LightningLaneTiming | null;
          check_in_override: Date | string | null;
        }>(
          `INSERT INTO trip_booking_settings (trip_id, stay_type, lightning_lane_timing, check_in_override, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (trip_id) DO UPDATE SET
             stay_type = EXCLUDED.stay_type,
             lightning_lane_timing = EXCLUDED.lightning_lane_timing,
             check_in_override = EXCLUDED.check_in_override,
             updated_at = now()
           RETURNING trip_id, stay_type, lightning_lane_timing, check_in_override`,
          [tripId, next.stayType, next.lightningLaneTiming, next.checkInOverride],
        );

        const saved = upsertRes.rows[0]!;
        return {
          tripId: saved.trip_id,
          stayType: saved.stay_type ?? null,
          lightningLaneTiming: saved.lightning_lane_timing ?? null,
          checkInOverride: formatCalendarDate(saved.check_in_override),
        };
      });
    },

    async setWindowDone(tripId: string, kind: WindowKind, dropOn: string, done: boolean, userId: string): Promise<void> {
      if (done) {
        // ON CONFLICT DO NOTHING preserves the original marked_by and marked_at (Property 11, R5.6)
        await pool.query(
          `INSERT INTO trip_booking_window_done (trip_id, window_kind, drop_on, marked_by, marked_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (trip_id, window_kind, drop_on) DO NOTHING`,
          [tripId, kind, dropOn, userId],
        );
      } else {
        await pool.query(
          `DELETE FROM trip_booking_window_done
            WHERE trip_id = $1 AND window_kind = $2 AND drop_on = $3`,
          [tripId, kind, dropOn],
        );
      }
    },

    async setReminderMute(tripId: string, userId: string, muted: boolean): Promise<boolean> {
      if (muted) {
        await pool.query(
          `INSERT INTO trip_booking_reminder_mutes (trip_id, user_id, created_at)
           VALUES ($1, $2, now())
           ON CONFLICT (trip_id, user_id) DO NOTHING`,
          [tripId, userId],
        );
        return true;
      } else {
        await pool.query(
          `DELETE FROM trip_booking_reminder_mutes
            WHERE trip_id = $1 AND user_id = $2`,
          [tripId, userId],
        );
        return false;
      }
    },

    // =========================================================================
    // Part B: Reminder Runner Port
    // =========================================================================

    async listCandidateTrips(args: { today: string; horizon: string; limit: number }): Promise<CandidateTrip[]> {
      const res = await pool.query<{
        id: string;
        name: string;
        start_date: Date | string;
        end_date: Date | string;
        has_resort_stay: boolean;
        stay_type: StayType | null;
        lightning_lane_timing: LightningLaneTiming | null;
        check_in_override: Date | string | null;
      }>(
        `SELECT t.id, t.name, t.start_date, t.end_date,
                (tr.trip_id IS NOT NULL) AS has_resort_stay,
                s.stay_type, s.lightning_lane_timing, s.check_in_override
           FROM trips t
           LEFT JOIN (SELECT DISTINCT trip_id FROM trip_resorts) tr ON tr.trip_id = t.id
           LEFT JOIN trip_booking_settings s ON s.trip_id = t.id
          WHERE t.end_date >= $1::date
            AND (t.start_date <= $2::date OR s.check_in_override <= $2::date)
          ORDER BY t.start_date ASC, t.id ASC
          LIMIT $3`,
        [args.today, args.horizon, args.limit],
      );

      return res.rows.map((row) => ({
        id: row.id,
        name: row.name,
        startDate: formatCalendarDate(row.start_date)!,
        endDate: formatCalendarDate(row.end_date)!,
        hasResortStay: Boolean(row.has_resort_stay),
        settings:
          row.stay_type !== null || row.lightning_lane_timing !== null || row.check_in_override !== null
            ? {
                stayType: row.stay_type ?? null,
                lightningLaneTiming: row.lightning_lane_timing ?? null,
                checkInOverride: formatCalendarDate(row.check_in_override),
              }
            : null,
      }));
    },

    async listDoneKeys(tripIds: readonly string[]): Promise<Map<string, Set<string>>> {
      const result = new Map<string, Set<string>>();
      for (const id of tripIds) {
        result.set(id, new Set<string>());
      }
      if (tripIds.length === 0) {
        return result;
      }

      const res = await pool.query<{
        trip_id: string;
        window_kind: WindowKind;
        drop_on: Date | string;
      }>(
        `SELECT trip_id, window_kind, drop_on
           FROM trip_booking_window_done
          WHERE trip_id = ANY($1)`,
        [tripIds as string[]],
      );

      for (const row of res.rows) {
        const dropOn = formatCalendarDate(row.drop_on);
        if (dropOn) {
          result.get(row.trip_id)?.add(`${row.window_kind}:${dropOn}`);
        }
      }

      return result;
    },

    async listClaimedKeys(tripIds: readonly string[], sinceIso: string): Promise<Map<string, Set<string>>> {
      const result = new Map<string, Set<string>>();
      for (const id of tripIds) {
        result.set(id, new Set<string>());
      }
      if (tripIds.length === 0) {
        return result;
      }

      const res = await pool.query<{
        trip_id: string;
        window_kind: WindowKind;
        drop_at: Date | string;
        reminder_lead: string;
      }>(
        `SELECT trip_id, window_kind, drop_at, reminder_lead
           FROM trip_booking_reminder_log
          WHERE trip_id = ANY($1)
            AND drop_at >= $2`,
        [tripIds as string[], sinceIso],
      );

      for (const row of res.rows) {
        const dropAtIso = new Date(row.drop_at).toISOString();
        const key = ledgerKey(row.window_kind, dropAtIso, row.reminder_lead as any);
        result.get(row.trip_id)?.add(key);
      }

      return result;
    },

    async claimReminder(tripId: string, r: DueReminder): Promise<boolean> {
      // Conflict-ignoring claim: true iff THIS call inserted the row (R9.1)
      const res = await pool.query(
        `INSERT INTO trip_booking_reminder_log (trip_id, window_kind, drop_at, reminder_lead)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING
         RETURNING trip_id`,
        [tripId, r.kind, r.dropAt, r.lead],
      );
      return res.rows.length === 1;
    },

    async listReminderRecipients(tripId: string): Promise<string[]> {
      const res = await pool.query<{ user_id: string }>(
        `SELECT m.user_id
           FROM active_trip_memberships m
           LEFT JOIN trip_booking_reminder_mutes x ON x.trip_id = m.trip_id AND x.user_id = m.user_id
          WHERE m.trip_id = $1
            AND x.user_id IS NULL
          ORDER BY m.user_id ASC`,
        [tripId],
      );
      return res.rows.map((r) => r.user_id);
    },

    async pruneLedger(cutoffIso: string): Promise<number> {
      // Strictly older than cutoff; row at cutoff is retained (R14.2)
      const res = await pool.query(
        `DELETE FROM trip_booking_reminder_log WHERE drop_at < $1`,
        [cutoffIso],
      );
      return res.rowCount ?? 0;
    },

    // =========================================================================
    // Part C: Packing List
    // =========================================================================

    async listPacking(tripId: string): Promise<PackingListDTO> {
      const res = await pool.query<{
        id: string;
        trip_id: string;
        name: string;
        category: string;
        quantity: number;
        assignee_id: string | null;
        assignee_name: string | null;
        assignee_is_member: boolean;
        added_by: string;
        added_by_name: string | null;
        packed: boolean;
        packed_by: string | null;
        packed_by_name: string | null;
        packed_at: Date | string | null;
        created_at: Date | string;
      }>(
        `SELECT p.id, p.trip_id, p.name, p.category, p.quantity,
                p.assignee_id, pa.display_name AS assignee_name,
                (tm.user_id IS NOT NULL) AS assignee_is_member,
                COALESCE(pu.public_id, p.added_by) AS added_by, pu.display_name AS added_by_name,
                p.packed, p.packed_by, pp.display_name AS packed_by_name, p.packed_at,
                p.created_at
           FROM trip_packing_items p
           LEFT JOIN active_trip_memberships tm ON tm.trip_id = p.trip_id AND tm.user_id = p.assignee_id
           LEFT JOIN profile_identity pu ON pu.user_id = p.added_by
           LEFT JOIN profile_identity pa ON pa.user_id = p.assignee_id
           LEFT JOIN profile_identity pp ON pp.user_id = p.packed_by
          WHERE p.trip_id = $1
          ORDER BY p.created_at ASC`,
        [tripId],
      );

      const rawItems: PackingItemDTO[] = res.rows.map((row) => {
        const { assigneeId, assigneeDisplayName } = projectAssignee({
          assigneeId: row.assignee_id,
          assigneeName: row.assignee_name,
          assigneeIsMember: Boolean(row.assignee_is_member),
        });

        return {
          id: row.id,
          tripId: row.trip_id,
          name: row.name,
          category: row.category as any,
          quantity: row.quantity,
          packed: Boolean(row.packed),
          packedAt: row.packed_at ? new Date(row.packed_at).toISOString() : null,
          packedByDisplayName: row.packed_by_name ?? null,
          addedById: row.added_by,
          addedByDisplayName: row.added_by_name ?? 'Someone',
          assigneeId,
          assigneeDisplayName,
          createdAt: new Date(row.created_at).toISOString(),
        };
      });

      const items = sortPackingItems(rawItems);
      const { totalCount, packedCount } = summarizePacking(items);

      return {
        items,
        totalCount,
        packedCount,
      };
    },

    async getPackingItemOwner(tripId: string, itemId: string): Promise<{ addedBy: string } | null> {
      const res = await pool.query<{ added_by: string }>(
        `SELECT added_by FROM trip_packing_items WHERE trip_id = $1 AND id = $2`,
        [tripId, itemId],
      );
      const row = res.rows[0];
      return row ? { addedBy: row.added_by } : null;
    },

    async addPackingItem(
      tripId: string,
      adderId: string,
      input: z.infer<typeof packingItemCreateSchema>,
    ): Promise<PackingItemDTO> {
      return withTx(pool, async (client) => {
        // 1. Lock trip row
        const tripCheck = await client.query<{ id: string }>(
          `SELECT id FROM trips WHERE id = $1 FOR UPDATE`,
          [tripId],
        );
        if (!tripCheck.rows[0]) {
          throw new AppError('trip_forbidden', 'Trip not found or inaccessible');
        }

        // 2. Count existing items and check 300 cap
        const countRes = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM trip_packing_items WHERE trip_id = $1`,
          [tripId],
        );
        const currentCount = parseInt(countRes.rows[0]?.count ?? '0', 10);
        if (wouldExceedCap(currentCount, 1)) {
          throw new AppError('trip_validation_failed', 'Packing list limit of 300 items reached');
        }

        // 3. Validate assignee membership if provided (R11.4)
        if (input.assigneeId) {
          const memCheck = await client.query(
            `SELECT 1 FROM active_trip_memberships WHERE trip_id = $1 AND user_id = $2`,
            [tripId, input.assigneeId],
          );
          if (memCheck.rowCount === 0) {
            throw new AppError('trip_validation_failed', 'Assignee must be a member of the trip');
          }
        }

        // 4. Insert item
        const trimmedName = normalizeName(input.name);
        const quantity = input.quantity ?? 1;
        const insertRes = await client.query<{
          id: string;
          trip_id: string;
          name: string;
          category: string;
          quantity: number;
          assignee_id: string | null;
          added_by: string;
          packed: boolean;
          packed_by: string | null;
          packed_at: Date | string | null;
          created_at: Date | string;
        }>(
          `INSERT INTO trip_packing_items (trip_id, name, category, quantity, assignee_id, added_by, packed)
           VALUES ($1, $2, $3, $4, $5, $6, false)
           RETURNING id, trip_id, name, category, quantity, assignee_id, added_by, packed, packed_by, packed_at, created_at`,
          [tripId, trimmedName, input.category, quantity, input.assigneeId ?? null, adderId],
        );
        const row = insertRes.rows[0]!;

        // 5. Look up display names
        const namesRes = await client.query<{
          adder_name: string | null;
          assignee_name: string | null;
        }>(
          `SELECT pa.display_name AS adder_name, ps.display_name AS assignee_name
             FROM trips t
             LEFT JOIN profile_identity pa ON pa.user_id = $2
             LEFT JOIN profile_identity ps ON ps.user_id = $3
            WHERE t.id = $1`,
          [tripId, adderId, input.assigneeId ?? null],
        );
        const namesRow = namesRes.rows[0];

        return {
          id: row.id,
          tripId: row.trip_id,
          name: row.name,
          category: row.category as any,
          quantity: row.quantity,
          packed: false,
          packedAt: null,
          packedByDisplayName: null,
          addedById: row.added_by,
          addedByDisplayName: namesRow?.adder_name ?? 'Someone',
          assigneeId: input.assigneeId ?? null,
          assigneeDisplayName: input.assigneeId ? (namesRow?.assignee_name ?? null) : null,
          createdAt: new Date(row.created_at).toISOString(),
        };
      });
    },

    async updatePackingItem(
      tripId: string,
      itemId: string,
      patch: z.infer<typeof packingItemUpdateSchema>,
    ): Promise<PackingItemDTO> {
      return withTx(pool, async (client) => {
        // 1. Lock item row
        const curRes = await client.query<{
          id: string;
          trip_id: string;
          name: string;
          category: string;
          quantity: number;
          assignee_id: string | null;
          added_by: string;
          packed: boolean;
          packed_by: string | null;
          packed_at: Date | string | null;
          created_at: Date | string;
        }>(
          `SELECT id, trip_id, name, category, quantity, assignee_id, added_by, packed, packed_by, packed_at, created_at
             FROM trip_packing_items
            WHERE trip_id = $1 AND id = $2
              FOR UPDATE`,
          [tripId, itemId],
        );
        const current = curRes.rows[0];
        if (!current) {
          throw new AppError('trip_not_found', 'Packing item not found');
        }

        // 2. Validate assignee membership if provided (R11.4)
        if (patch.assigneeId !== undefined && patch.assigneeId !== null) {
          const memCheck = await client.query(
            `SELECT 1 FROM active_trip_memberships WHERE trip_id = $1 AND user_id = $2`,
            [tripId, patch.assigneeId],
          );
          if (memCheck.rowCount === 0) {
            throw new AppError('trip_validation_failed', 'Assignee must be a member of the trip');
          }
        }

        // 3. Compute updated values
        const nextName = patch.name !== undefined ? normalizeName(patch.name) : current.name;
        const nextCategory = patch.category !== undefined ? patch.category : current.category;
        const nextQuantity = patch.quantity !== undefined ? patch.quantity : current.quantity;
        const nextAssigneeId = patch.assigneeId !== undefined ? patch.assigneeId : current.assignee_id;

        const updateRes = await client.query<{
          id: string;
          trip_id: string;
          name: string;
          category: string;
          quantity: number;
          assignee_id: string | null;
          added_by: string;
          packed: boolean;
          packed_by: string | null;
          packed_at: Date | string | null;
          created_at: Date | string;
        }>(
          `UPDATE trip_packing_items
              SET name = $3,
                  category = $4,
                  quantity = $5,
                  assignee_id = $6
            WHERE trip_id = $1 AND id = $2
           RETURNING id, trip_id, name, category, quantity, assignee_id, added_by, packed, packed_by, packed_at, created_at`,
          [tripId, itemId, nextName, nextCategory, nextQuantity, nextAssigneeId],
        );
        const row = updateRes.rows[0]!;

        // 4. Fetch display names
        const namesRes = await client.query<{
          added_by_name: string | null;
          added_by_public_id: string | null;
          assignee_name: string | null;
          assignee_is_member: boolean;
          packed_by_name: string | null;
        }>(
          `SELECT pu.display_name AS added_by_name,
                  pu.public_id AS added_by_public_id,
                  pa.display_name AS assignee_name,
                  EXISTS (SELECT 1 FROM active_trip_memberships tm WHERE tm.trip_id = $1 AND tm.user_id = $3) AS assignee_is_member,
                  pp.display_name AS packed_by_name
             FROM trips t
             LEFT JOIN profile_identity pu ON pu.user_id = $2
             LEFT JOIN profile_identity pa ON pa.user_id = $3
             LEFT JOIN profile_identity pp ON pp.user_id = $4
            WHERE t.id = $1`,
          [tripId, row.added_by, row.assignee_id, row.packed_by],
        );
        const namesRow = namesRes.rows[0];

        const { assigneeId, assigneeDisplayName } = projectAssignee({
          assigneeId: row.assignee_id,
          assigneeName: namesRow?.assignee_name ?? null,
          assigneeIsMember: Boolean(namesRow?.assignee_is_member),
        });

        return {
          id: row.id,
          tripId: row.trip_id,
          name: row.name,
          category: row.category as any,
          quantity: row.quantity,
          packed: Boolean(row.packed),
          packedAt: row.packed_at ? new Date(row.packed_at).toISOString() : null,
          packedByDisplayName: namesRow?.packed_by_name ?? null,
          addedById: namesRow?.added_by_public_id ?? row.added_by,
          addedByDisplayName: namesRow?.added_by_name ?? 'Someone',
          assigneeId,
          assigneeDisplayName,
          createdAt: new Date(row.created_at).toISOString(),
        };
      });
    },

    async removePackingItem(tripId: string, itemId: string): Promise<void> {
      await pool.query(
        `DELETE FROM trip_packing_items WHERE trip_id = $1 AND id = $2`,
        [tripId, itemId],
      );
    },

    async setPacked(tripId: string, itemId: string, userId: string, packed: boolean): Promise<PackingItemDTO> {
      return withTx(pool, async (client) => {
        // Lock item row (R11.11: serializes concurrent toggles, last write wins)
        const curRes = await client.query<{
          id: string;
          trip_id: string;
          name: string;
          category: string;
          quantity: number;
          assignee_id: string | null;
          added_by: string;
          packed: boolean;
          packed_by: string | null;
          packed_at: Date | string | null;
          created_at: Date | string;
        }>(
          `SELECT id, trip_id, name, category, quantity, assignee_id, added_by, packed, packed_by, packed_at, created_at
             FROM trip_packing_items
            WHERE trip_id = $1 AND id = $2
              FOR UPDATE`,
          [tripId, itemId],
        );
        const current = curRes.rows[0];
        if (!current) {
          throw new AppError('trip_not_found', 'Packing item not found');
        }

        const nowIso = new Date().toISOString();
        const next = nextPackedState(
          {
            packed: current.packed,
            packedBy: current.packed_by,
            packedAt: current.packed_at ? new Date(current.packed_at).toISOString() : null,
          },
          packed,
          userId,
          nowIso,
        );

        const updateRes = await client.query<{
          id: string;
          trip_id: string;
          name: string;
          category: string;
          quantity: number;
          assignee_id: string | null;
          added_by: string;
          packed: boolean;
          packed_by: string | null;
          packed_at: Date | string | null;
          created_at: Date | string;
        }>(
          `UPDATE trip_packing_items
              SET packed = $3,
                  packed_by = $4,
                  packed_at = $5
            WHERE trip_id = $1 AND id = $2
           RETURNING id, trip_id, name, category, quantity, assignee_id, added_by, packed, packed_by, packed_at, created_at`,
          [tripId, itemId, next.packed, next.packedBy, next.packedAt],
        );
        const row = updateRes.rows[0]!;

        const namesRes = await client.query<{
          added_by_name: string | null;
          added_by_public_id: string | null;
          assignee_name: string | null;
          assignee_is_member: boolean;
          packed_by_name: string | null;
        }>(
          `SELECT pu.display_name AS added_by_name,
                  pu.public_id AS added_by_public_id,
                  pa.display_name AS assignee_name,
                  EXISTS (SELECT 1 FROM active_trip_memberships tm WHERE tm.trip_id = $1 AND tm.user_id = $3) AS assignee_is_member,
                  pp.display_name AS packed_by_name
             FROM trips t
             LEFT JOIN profile_identity pu ON pu.user_id = $2
             LEFT JOIN profile_identity pa ON pa.user_id = $3
             LEFT JOIN profile_identity pp ON pp.user_id = $4
            WHERE t.id = $1`,
          [tripId, row.added_by, row.assignee_id, row.packed_by],
        );
        const namesRow = namesRes.rows[0];

        const { assigneeId, assigneeDisplayName } = projectAssignee({
          assigneeId: row.assignee_id,
          assigneeName: namesRow?.assignee_name ?? null,
          assigneeIsMember: Boolean(namesRow?.assignee_is_member),
        });

        return {
          id: row.id,
          tripId: row.trip_id,
          name: row.name,
          category: row.category as any,
          quantity: row.quantity,
          packed: Boolean(row.packed),
          packedAt: row.packed_at ? new Date(row.packed_at).toISOString() : null,
          packedByDisplayName: namesRow?.packed_by_name ?? null,
          addedById: namesRow?.added_by_public_id ?? row.added_by,
          addedByDisplayName: namesRow?.added_by_name ?? 'Someone',
          assigneeId,
          assigneeDisplayName,
          createdAt: new Date(row.created_at).toISOString(),
        };
      });
    },

    async addStarterItems(tripId: string, adderId: string): Promise<number> {
      return withTx(pool, async (client) => {
        // 1. Lock trip row
        const tripCheck = await client.query<{ id: string }>(
          `SELECT id FROM trips WHERE id = $1 FOR UPDATE`,
          [tripId],
        );
        if (!tripCheck.rows[0]) {
          throw new AppError('trip_forbidden', 'Trip not found or inaccessible');
        }

        // 2. Read existing names and count
        const existingRes = await client.query<{ name: string }>(
          `SELECT name FROM trip_packing_items WHERE trip_id = $1`,
          [tripId],
        );
        const existingNames = existingRes.rows.map((r) => r.name);
        const existingCount = existingRes.rows.length;

        // 3. Deduplicate against starter list
        const toAdd = selectStarterToAdd(existingNames, STARTER_PACKING_LIST);
        if (toAdd.length === 0) {
          return 0;
        }

        // 4. Check 300 cap (all-or-nothing: R11.10)
        if (wouldExceedCap(existingCount, toAdd.length)) {
          throw new AppError('trip_validation_failed', 'Packing list limit of 300 items reached');
        }

        // 5. Multi-row VALUES insert
        const params: unknown[] = [tripId, adderId];
        const valuePlaceholders: string[] = [];
        for (const item of toAdd) {
          const nameIdx = params.push(item.name);
          const catIdx = params.push(item.category);
          const qtyIdx = params.push(item.quantity);
          valuePlaceholders.push(`($1, $${nameIdx}, $${catIdx}, $${qtyIdx}, $2, false)`);
        }

        await client.query(
          `INSERT INTO trip_packing_items (trip_id, name, category, quantity, added_by, packed)
           VALUES ${valuePlaceholders.join(', ')}`,
          params,
        );

        return toAdd.length;
      });
    },
  };
}
