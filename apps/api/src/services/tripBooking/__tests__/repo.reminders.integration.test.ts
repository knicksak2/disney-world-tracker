/**
 * Integration tests for TripBookingRepo Part B: reminder runner port.
 *
 * Validates: Requirements 4.3, 7.7, 9.1, 9.2, 9.4, 14.2, 14.3
 */

import { randomUUID } from 'node:crypto';
import fc from 'fast-check';
import type { Pool } from 'pg';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTripBookingRepo, type TripBookingRepo } from '../repo.js';
import type { DueReminder } from '../reminders.js';
import { setupTestDb } from './testDb.js';

describe('TripBookingRepo Part B — Reminder Runner Port', () => {
  let pool: Pool;
  let repo: TripBookingRepo;
  let tripId1: string;
  let tripId2: string;
  let userId1: string;
  let userId2: string;
  let userId3: string;
  let resortId: string;

  beforeEach(async () => {
    const testDb = setupTestDb();
    pool = testDb.pool;
    repo = createTripBookingRepo(pool as any);

    userId1 = randomUUID();
    userId2 = randomUUID();
    userId3 = randomUUID();
    tripId1 = randomUUID();
    tripId2 = randomUUID();
    resortId = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'alice@example.com', 'hash1'),
              ($2, 'bob@example.com', 'hash2'),
              ($3, 'carol@example.com', 'hash3')`,
      [userId1, userId2, userId3],
    );
    await pool.query(
      `INSERT INTO profiles (user_id, display_name)
       VALUES ($1, 'Alice'),
              ($2, 'Bob'),
              ($3, 'Carol')`,
      [userId1, userId2, userId3],
    );
    await pool.query(
      `INSERT INTO trips (id, creator_id, name, start_date, end_date)
       VALUES ($1, $2, 'Trip One', '2026-10-01', '2026-10-10'),
              ($3, $4, 'Trip Two', '2026-11-01', '2026-11-10')`,
      [tripId1, userId1, tripId2, userId2],
    );
    await pool.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role)
       VALUES ($1, $2, 'organizer'),
              ($1, $3, 'member'),
              ($4, $5, 'organizer')`,
      [tripId1, userId1, userId2, tripId2, userId2],
    );
    await pool.query(
      `INSERT INTO resorts (id, name, active) VALUES ($1, 'Grand Floridian', true)`,
      [resortId],
    );
  });

  // Feature: trip-booking-timeline, Property 27: Pruning deletes exactly rows older than the cutoff
  describe('Property 27: Pruning deletes exactly rows older than the cutoff', () => {
    it('deletes rows with drop_at < cutoff, retains rows with drop_at >= cutoff, including exact cutoff', async () => {
      const cutoff = '2026-09-01T00:00:00.000Z';
      const before1 = '2026-08-31T23:59:59.000Z';
      const before2 = '2026-08-15T12:00:00.000Z';
      const exact = cutoff;
      const after1 = '2026-09-01T00:00:01.000Z';
      const after2 = '2026-09-10T10:00:00.000Z';

      await pool.query(
        `INSERT INTO trip_booking_reminder_log (trip_id, window_kind, drop_at, reminder_lead)
         VALUES ($1, 'dining', $2, 'open'),
                ($1, 'lightning_lane', $3, 'open'),
                ($1, 'dining', $4, 'eve'),
                ($1, 'dining', $5, 'week'),
                ($1, 'lightning_lane', $6, 'eve')`,
        [tripId1, before1, before2, exact, after1, after2],
      );

      const deletedCount = await repo.pruneLedger(cutoff);
      expect(deletedCount).toBe(2);

      // Raw SQL check on survivors
      const remaining = await pool.query<{ drop_at: Date | string }>(
        `SELECT drop_at FROM trip_booking_reminder_log WHERE trip_id = $1 ORDER BY drop_at ASC`,
        [tripId1],
      );
      expect(remaining.rows).toHaveLength(3);
      const remainingIsos = remaining.rows.map((r) => new Date(r.drop_at).toISOString());
      expect(remainingIsos).toContain(exact);
      expect(remainingIsos).toContain(after1);
      expect(remainingIsos).toContain(after2);
    });

    it('Property 27: property test over random drop_at timestamps', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.date({ min: new Date('2026-01-01'), max: new Date('2026-12-31') }),
          fc.array(
            fc.record({
              kind: fc.constantFrom('dining' as const, 'lightning_lane' as const),
              lead: fc.constantFrom('eve' as const, 'open' as const, 'week' as const),
              date: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-12-31') }),
            }),
            { minLength: 5, maxLength: 20 },
          ),
          async (cutoffDate, sampleEntries) => {
            const cutoffIso = cutoffDate.toISOString();
            // Clear table
            await pool.query(`DELETE FROM trip_booking_reminder_log WHERE trip_id = $1`, [tripId1]);

            // Deduplicate items on PK (tripId, kind, dropAt, lead)
            const seen = new Set<string>();
            const uniqueEntries: { kind: string; lead: string; dropAtIso: string }[] = [];
            for (const entry of sampleEntries) {
              const dropAtIso = entry.date.toISOString();
              const key = `${entry.kind}|${dropAtIso}|${entry.lead}`;
              if (!seen.has(key)) {
                seen.add(key);
                uniqueEntries.push({ kind: entry.kind, lead: entry.lead, dropAtIso });
              }
            }

            for (const item of uniqueEntries) {
              await pool.query(
                `INSERT INTO trip_booking_reminder_log (trip_id, window_kind, drop_at, reminder_lead)
                 VALUES ($1, $2, $3, $4)`,
                [tripId1, item.kind, item.dropAtIso, item.lead],
              );
            }

            await repo.pruneLedger(cutoffIso);

            // Read survivors back with raw SQL
            const survivors = await pool.query<{ drop_at: Date | string }>(
              `SELECT drop_at FROM trip_booking_reminder_log WHERE trip_id = $1`,
              [tripId1],
            );

            for (const s of survivors.rows) {
              const survivorMs = new Date(s.drop_at).getTime();
              expect(survivorMs).toBeGreaterThanOrEqual(cutoffDate.getTime());
            }

            const expectedSurvivorsCount = uniqueEntries.filter(
              (e) => new Date(e.dropAtIso).getTime() >= cutoffDate.getTime(),
            ).length;
            expect(survivors.rows).toHaveLength(expectedSurvivorsCount);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('claimReminder', () => {
    it('calling claimReminder twice returns true then false and stores exactly one row', async () => {
      const r: DueReminder = {
        windowKey: 'dining:2026-08-02',
        kind: 'dining',
        dropOn: '2026-08-02',
        dropAt: '2026-08-02T10:00:00.000Z',
        lead: 'open',
        fireAt: '2026-08-02T10:00:00.000Z',
        firstCovered: '2026-10-01',
        lastCovered: '2026-10-10',
      };

      const first = await repo.claimReminder(tripId1, r);
      expect(first).toBe(true);

      const second = await repo.claimReminder(tripId1, r);
      expect(second).toBe(false);

      // Raw SQL check: exactly 1 row
      const raw = await pool.query(
        `SELECT * FROM trip_booking_reminder_log WHERE trip_id = $1 AND window_kind = 'dining'`,
        [tripId1],
      );
      expect(raw.rows).toHaveLength(1);

      // Different lead creates a new row
      const rEve = { ...r, lead: 'eve' as const };
      const third = await repo.claimReminder(tripId1, rEve);
      expect(third).toBe(true);

      const rawAfterLead = await pool.query(
        `SELECT * FROM trip_booking_reminder_log WHERE trip_id = $1 AND window_kind = 'dining'`,
        [tripId1],
      );
      expect(rawAfterLead.rows).toHaveLength(2);

      // Different dropAt creates a new row (supports shifted date change: R4.3)
      const rShifted = { ...r, dropAt: '2026-08-05T10:00:00.000Z' };
      const fourth = await repo.claimReminder(tripId1, rShifted);
      expect(fourth).toBe(true);

      const rawAfterShift = await pool.query(
        `SELECT * FROM trip_booking_reminder_log WHERE trip_id = $1 AND window_kind = 'dining'`,
        [tripId1],
      );
      expect(rawAfterShift.rows).toHaveLength(3);
    });
  });

  describe('listCandidateTrips', () => {
    it('filters by today and horizon, handles checkInOverride, limits and orders correctly', async () => {
      // Add a third trip: end_date is in the past
      const pastTripId = randomUUID();
      await pool.query(
        `INSERT INTO trips (id, creator_id, name, start_date, end_date)
         VALUES ($1, $2, 'Past Trip', '2026-01-01', '2026-01-05')`,
        [pastTripId, userId1],
      );

      // Add a fourth trip: start_date > horizon, but check_in_override <= horizon
      const overrideTripId = randomUUID();
      await pool.query(
        `INSERT INTO trips (id, creator_id, name, start_date, end_date)
         VALUES ($1, $2, 'Override Trip', '2026-12-01', '2026-12-10')`,
        [overrideTripId, userId1],
      );
      await pool.query(
        `INSERT INTO trip_booking_settings (trip_id, stay_type, check_in_override)
         VALUES ($1, 'resort', '2026-10-15')`,
        [overrideTripId],
      );

      // Add resort stay to tripId1
      await pool.query(`INSERT INTO trip_resorts (trip_id, resort_id) VALUES ($1, $2)`, [tripId1, resortId]);

      // Query with today = '2026-09-01', horizon = '2026-10-20'
      // Expected qualifying trips:
      // - tripId1 (start: '2026-10-01' <= '2026-10-20', end: '2026-10-10' >= '2026-09-01')
      // - overrideTripId (start: '2026-12-01' > horizon, but check_in_override: '2026-10-15' <= horizon)
      // Excluded:
      // - pastTripId (end: '2026-01-05' < today)
      // - tripId2 (start: '2026-11-01' > horizon, no override)
      const candidates = await repo.listCandidateTrips({
        today: '2026-09-01',
        horizon: '2026-10-20',
        limit: 10,
      });

      const ids = candidates.map((c) => c.id);
      expect(ids).toContain(tripId1);
      expect(ids).toContain(overrideTripId);
      expect(ids).not.toContain(pastTripId);
      expect(ids).not.toContain(tripId2);

      // hasResortStay is true for tripId1 and false for overrideTripId
      const c1 = candidates.find((c) => c.id === tripId1)!;
      expect(c1.hasResortStay).toBe(true);

      const cOverride = candidates.find((c) => c.id === overrideTripId)!;
      expect(cOverride.hasResortStay).toBe(false);
      expect(cOverride.settings?.stayType).toBe('resort');
      expect(cOverride.settings?.checkInOverride).toBe('2026-10-15');

      // Ordering is start_date asc, id asc
      expect(candidates[0]!.id).toBe(tripId1); // 2026-10-01 comes before 2026-12-01

      // Limit works
      const limited = await repo.listCandidateTrips({
        today: '2026-09-01',
        horizon: '2026-10-20',
        limit: 1,
      });
      expect(limited).toHaveLength(1);
      expect(limited[0]!.id).toBe(tripId1);
    });
  });

  describe('listReminderRecipients', () => {
    it('returns trip members without mutes, excluding muted members and non-members', async () => {
      // Initially, tripId1 has userId1 and userId2 as members
      const initial = await repo.listReminderRecipients(tripId1);
      expect(initial).toEqual([userId1, userId2].sort());

      // userId1 mutes reminders for tripId1
      await repo.setReminderMute(tripId1, userId1, true);

      const afterMute = await repo.listReminderRecipients(tripId1);
      expect(afterMute).toEqual([userId2]);

      // Non-member userId3 does not appear
      expect(afterMute).not.toContain(userId3);
    });
  });

  describe('listDoneKeys and listClaimedKeys', () => {
    it('returns keys only for requested tripIds, and listClaimedKeys honors sinceIso', async () => {
      await repo.setWindowDone(tripId1, 'dining', '2026-08-02', true, userId1);
      await repo.setWindowDone(tripId2, 'lightning_lane', '2026-09-24', true, userId2);

      const doneMap = await repo.listDoneKeys([tripId1]);
      expect(doneMap.get(tripId1)?.has('dining:2026-08-02')).toBe(true);
      expect(doneMap.has(tripId2)).toBe(false);

      // Claimed keys with sinceIso
      const oldDropAt = '2026-07-01T10:00:00.000Z';
      const recentDropAt = '2026-09-15T10:00:00.000Z';

      await pool.query(
        `INSERT INTO trip_booking_reminder_log (trip_id, window_kind, drop_at, reminder_lead)
         VALUES ($1, 'dining', $2, 'open'),
                ($1, 'dining', $3, 'open')`,
        [tripId1, oldDropAt, recentDropAt],
      );

      const claimedMap = await repo.listClaimedKeys([tripId1], '2026-08-01T00:00:00.000Z');
      const keys = claimedMap.get(tripId1)!;
      expect(keys.has(`dining|${recentDropAt}|open`)).toBe(true);
      expect(keys.has(`dining|${oldDropAt}|open`)).toBe(false);
    });
  });
});
