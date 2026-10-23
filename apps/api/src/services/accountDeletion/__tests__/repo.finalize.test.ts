/**
 * Repo tests (pg-mem, real SQL) for `finalize` and the ledger.
 *
 * Feature: account-deletion, Property 15: The user row is deleted only after nothing references it outside the cascade
 * Feature: account-deletion, Property 33: The ledger outcome is decided before the row that carries it
 * Feature: account-deletion, Property 26: The finished purge leaves no residue of the person (ledger half)
 *
 * Validates: Requirements 8.12, 9.2, 9.3, 9.5, 9.6, 9.8, 9.11, 12.1, 12.5, 12.9, 17.4, 17.5
 */
import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { DISPOSITIONS } from '../dispositions.js';
import { LEDGER_KEEP_ROWS } from '../repo.js';
import type { ClaimedAccount } from '../ports.js';
import { drivePurge, photoDrivers, stage1Photos, stage2Trips, stage4PersonalData } from './purgeDriver.js';
import { migrationSchema, type Row } from './helpers.js';
import { BOB, CHUNK_ROWS, claimSubject, createWorld, seedEntry, SUBJECT, userRow, type World } from './world.js';

const FINAL = new Date('2026-05-02T09:05:00.000Z');

describe('accountDeletion repo: finalize and ledger (pg-mem)', () => {
  let w: World;
  let c: ClaimedAccount;

  const ledger = async (): Promise<Row[]> => (await w.pool.query(`SELECT * FROM account_deletion_ledger ORDER BY purged_at, id`)).rows as Row[];

  beforeEach(async () => {
    w = await createWorld();
    c = await claimSubject(w);
  });

  describe('purged', () => {
    it('deletes the users row, writes one ledger row from the counters, and the ledger has no identifying column or value', async () => {
      await w.repo.advanceStage(c, 1, { photosDeleted: 4 });
      await w.repo.addCounters(c, { tripsDeleted: 2, tripsTransferred: 3 });

      expect(await w.repo.finalize(c, FINAL)).toBe('purged');

      expect(await userRow(w, SUBJECT.id)).toBeUndefined();
      const rows = await ledger();
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(new Date(row.requested_at as Date).toISOString()).toBe(c.deletionRequestedAt.toISOString());
      expect(new Date(row.purged_at as Date).toISOString()).toBe(FINAL.toISOString());
      expect(row.photos_deleted).toBe(4);
      expect(row.trips_deleted).toBe(2);
      expect(row.trips_transferred).toBe(3);
      expect(row.outcome).toBe('completed');

      // The table has no column that could name a person, and no value does either.
      const columns = [...migrationSchema().tables.get('account_deletion_ledger')!.columns.keys()].sort();
      expect(columns).toEqual(['id', 'outcome', 'photos_deleted', 'purged_at', 'requested_at', 'trips_deleted', 'trips_transferred']);
      const text = JSON.stringify(rows);
      for (const secret of [SUBJECT.id, SUBJECT.email, SUBJECT.displayName, c.placeholderId]) expect(text).not.toContain(secret);
    });

    it('the freed email can register again', async () => {
      await w.repo.finalize(c, FINAL);
      const reborn = await w.seeder.insertRow('users', { email: SUBJECT.email, password_hash: 'new-hash' });
      expect(reborn.id).not.toBe(SUBJECT.id);
      expect(reborn.deletion_state).toBe('active');
    });

    it('leaves every other user\'s row untouched', async () => {
      const bob = JSON.stringify(await userRow(w, BOB.id));
      await w.repo.finalize(c, FINAL);
      expect(JSON.stringify(await userRow(w, BOB.id))).toBe(bob);
    });

    it('a full stage run on a seeded account ends in purged, and a rerun of finalize afterwards is fenced (the row is gone)', async () => {
      for (const e of DISPOSITIONS) await seedEntry(w, e);
      expect(await drivePurge(w, c, photoDrivers(w), CHUNK_ROWS)).toBe('purged');
      expect(await userRow(w, SUBJECT.id)).toBeUndefined();
      expect(await w.repo.finalize(c, FINAL)).toBe('fenced');
      expect(await ledger()).toHaveLength(1);
    });
  });

  describe('refs_remain (Property 15)', () => {
    async function snapshotAll(): Promise<string> {
      const tables = ['users', 'profiles', 'trips', 'expenses', 'trip_comments', 'planned_items', 'account_deletion_ledger'];
      return JSON.stringify(await Promise.all(tables.map(async (t) => (await w.pool.query(`SELECT * FROM ${t} ORDER BY 1`)).rows)));
    }

    it.each([
      ['anonymize', 'expenses', 'payer_id'],
      ['anonymize', 'trip_comments', 'author_id'],
      ['nullify', 'photos', 'owner_id'],
      ['nullify', 'food_items', 'created_by_user_id'],
      ['trip', 'trips', 'creator_id'],
    ])('one %s row (%s.%s) still naming the user: refs_remain, and nothing changes', async (_kind, table, column) => {
      const entry = DISPOSITIONS.find((e) => e.table === table && e.column === column)!;
      await seedEntry(w, entry);
      // A bystander's data hangs off the same trip, so a wrongly deleted user would cascade into it.
      const before = await snapshotAll();

      expect(await w.repo.finalize(c, FINAL)).toBe('refs_remain');

      expect(await snapshotAll()).toBe(before);
      expect(await userRow(w, SUBJECT.id)).toBeDefined();
      expect((await userRow(w, SUBJECT.id))!.deletion_state).toBe('purging');
      expect(await ledger()).toHaveLength(0);
      const remaining = await w.repo.countRemainingReferences(SUBJECT.id);
      expect(remaining.find((r) => r.table === table && r.column === column)?.count).toBeGreaterThanOrEqual(1);
    });

    it('a trip-referenced experience log still naming the user (the cascade hazard) is refs_remain and its trip log entry survives', async () => {
      const retained = await w.seeder.insertRow('experience_logs', { user_id: SUBJECT.id });
      const tripEntry = await w.seeder.insertRow('trip_log_entries', { member_id: SUBJECT.id, log_id: retained.id });

      expect(await w.repo.finalize(c, FINAL)).toBe('refs_remain');
      expect((await w.pool.query(`SELECT id FROM trip_log_entries WHERE id = $1`, [tripEntry.id])).rows).toHaveLength(1);
      expect((await w.pool.query(`SELECT id FROM experience_logs WHERE id = $1`, [retained.id])).rows).toHaveLength(1);
    });

    it('a private experience log (no trip log entry) is not a reference: finalize may proceed and the cascade removes it', async () => {
      await w.seeder.insertRow('experience_logs', { user_id: SUBJECT.id });
      expect(await w.repo.finalize(c, FINAL)).toBe('purged');
    });

    it('the runner-side recovery after refs_remain: rewind to 0, attempts = claim-time + 1 (absolute), claim released, row intact', async () => {
      await seedEntry(w, DISPOSITIONS.find((e) => e.table === 'expenses' && e.column === 'payer_id')!);
      for (let stage = 1; stage <= 4; stage++) await w.repo.advanceStage(c, stage);
      expect(await w.repo.finalize(c, FINAL)).toBe('refs_remain');

      expect(await w.repo.rewindStage(c, 0)).toBe(true);
      expect(await w.repo.recordFailedAttempt(c, FINAL, c.attempts + 1)).toBe(1);

      const row = (await userRow(w, SUBJECT.id))!;
      expect(row.purge_stage).toBe(0);
      expect(row.purge_attempts).toBe(1);
      expect(row.purge_claimed_at).toBeNull();
      expect(row.deletion_state).toBe('purging');
      expect((await w.pool.query(`SELECT 1 FROM expenses WHERE payer_id = $1`, [SUBJECT.id])).rows).toHaveLength(1);
    });
  });

  describe('fenced', () => {
    it('a stale claim finalizes nothing: no user delete, no ledger row', async () => {
      const [fresh] = await w.repo.claimDue(new Date(c.claimedAt.getTime() + 20 * 60_000), 10);
      expect(fresh).toBeDefined();

      expect(await w.repo.finalize(c, FINAL)).toBe('fenced');
      expect(await userRow(w, SUBJECT.id)).toBeDefined();
      expect(await ledger()).toHaveLength(0);

      expect(await w.repo.finalize(fresh!, FINAL)).toBe('purged');
    });

    it('a released claim cannot finalize either', async () => {
      await w.repo.releaseClaim(c);
      expect(await w.repo.finalize(c, FINAL)).toBe('fenced');
      expect(await userRow(w, SUBJECT.id)).toBeDefined();
    });
  });

  describe('ledger outcome (Property 33)', () => {
    it('is completed_with_warnings iff purge_warnings > 0 on the locked row, decided in the finalize transaction, and never updated afterwards', async () => {
      // Account A: the best-effort cleanup failed once (stage 4 recorded a warning).
      expect(await w.repo.recordWarning(c)).toBe(true);
      w.resetStatements();
      expect(await w.repo.finalize(c, FINAL)).toBe('purged');
      const finalizeTexts = w.statements.map((s) => s.text.trim().replace(/\s+/g, ' '));
      expect(finalizeTexts[0]).toBe('BEGIN');
      expect(finalizeTexts.at(-1)).toBe('COMMIT');
      expect(finalizeTexts.some((t) => /^UPDATE account_deletion_ledger/.test(t))).toBe(false);
      expect(finalizeTexts.findIndex((t) => t.startsWith('SELECT deletion_requested_at'))).toBeLessThan(
        finalizeTexts.findIndex((t) => t.startsWith('DELETE FROM users')),
      );

      // Account B: clean.
      const bob = await claimOther(BOB.id);
      expect(await w.repo.finalize(bob, FINAL)).toBe('purged');

      const rows = await ledger();
      expect(rows.map((r) => r.outcome).sort()).toEqual(['completed', 'completed_with_warnings']);
    });

    async function claimOther(id: string): Promise<ClaimedAccount> {
      const { makePending } = await import('./world.js');
      await makePending(w, id);
      const claimed = await w.repo.claimDue(new Date('2026-05-02T09:00:00.000Z'), 10);
      return claimed.find((x) => x.id === id)!;
    }

    it('the outcome is derived from the user row, so a warning recorded under a stale claim does not mark the next account', async () => {
      const stale = c;
      await w.repo.claimDue(new Date(c.claimedAt.getTime() + 20 * 60_000), 10);
      expect(await w.repo.recordWarning(stale)).toBe(false); // fenced: no warning written
      const fresh = (await w.repo.claimDue(new Date(c.claimedAt.getTime() + 40 * 60_000), 10))[0]!;
      expect(await w.repo.finalize(fresh, FINAL)).toBe('purged');
      expect((await ledger())[0]!.outcome).toBe('completed');
    });
  });

  describe('ledger retention', () => {
    async function seedLedger(n: number): Promise<void> {
      const per = 100;
      for (let start = 0; start < n; start += per) {
        const count = Math.min(per, n - start);
        const values: string[] = [];
        const params: unknown[] = [];
        for (let i = 0; i < count; i++) {
          const day = new Date(Date.UTC(2020, 0, 1, 0, 0, start + i));
          params.push(randomUUID(), day, day);
          values.push(`($${params.length - 2}::uuid, $${params.length - 1}, $${params.length})`);
        }
        await w.pool.query(`INSERT INTO account_deletion_ledger (id, requested_at, purged_at) VALUES ${values.join(', ')}`, params);
      }
    }

    it('prunes to the newest LEDGER_KEEP_ROWS: the new row is kept, the oldest surplus goes', async () => {
      await seedLedger(LEDGER_KEEP_ROWS + 2); // + the new row = 3 surplus
      const oldest = ((await w.pool.query(`SELECT id FROM account_deletion_ledger ORDER BY purged_at ASC, id ASC LIMIT 3`)).rows as Row[]).map((r) => String(r.id));

      expect(await w.repo.finalize(c, FINAL)).toBe('purged');

      const rows = await ledger();
      expect(rows).toHaveLength(LEDGER_KEEP_ROWS);
      const ids = rows.map((r) => String(r.id));
      for (const id of oldest) expect(ids).not.toContain(id);
      expect(rows.some((r) => new Date(r.purged_at as Date).toISOString() === FINAL.toISOString())).toBe(true);
    });

    it('removes at most CHUNK_ROWS surplus rows per finalize (bounded), converging over runs', async () => {
      await seedLedger(LEDGER_KEEP_ROWS + CHUNK_ROWS + 20);
      await w.repo.finalize(c, FINAL);
      // KEEP + CHUNK + 20 seeded, plus the new row = a surplus of CHUNK + 21; one finalize removes only CHUNK of it.
      expect(await ledger()).toHaveLength(LEDGER_KEEP_ROWS + 21);
    });

    it('does not prune below the cap', async () => {
      await seedLedger(5);
      await w.repo.finalize(c, FINAL);
      expect(await ledger()).toHaveLength(6);
    });
  });

  describe('photos before the user row (Property 19, regression)', () => {
    it('after stages 1, 2 and 4 the soft-deleted photos survive the user delete with owner_id NULL and are still listed for the sweep', async () => {
      const photo = await w.seeder.insertRow('photos', {
        owner_id: SUBJECT.id,
        status: 'approved',
        harm_verdict: 'pass',
        vision_verdict: 'pass',
        full_etag: 'f',
        thumb_etag: 't',
      });
      const d = photoDrivers(w);
      await stage1Photos(w, c, d, CHUNK_ROWS);
      await stage2Trips(w, c, d);
      await w.repo.advanceStage(c, 3);
      await stage4PersonalData(w, c);

      expect(await w.repo.finalize(c, FINAL)).toBe('purged');

      const after = (await w.pool.query(`SELECT id, status, owner_id FROM photos WHERE id = $1`, [photo.id])).rows as Row[];
      expect(after).toEqual([{ id: photo.id, status: 'deleted', owner_id: null }]);
    });
  });
});
