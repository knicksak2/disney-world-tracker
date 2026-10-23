/**
 * Repo tests (pg-mem, real SQL): one test per disposition-registry row, plus the photo stage, the share
 * scrub and the recompute-queue drain. The per-row tests iterate `DISPOSITIONS`, so a new registry row
 * without a working fixture and a working purge path fails here.
 *
 * Feature: account-deletion, Property 14: Every purge stage is idempotent and resumable
 * Feature: account-deletion, Property 19: A pending account's photos are not served and nothing about them changes (purge half)
 * Feature: account-deletion, Property 20: JSONB residue is scrubbed, nothing else is changed (stage half)
 * Feature: account-deletion, Property 21: Retained content survives with only its attribution changed
 * Feature: account-deletion, Property 28: No delete statement destroys a row a survivor depends on
 *
 * Validates: Requirements 6.3, 8.4, 9.1, 9.2, 9.3, 9.4, 9.5, 9.8, 9.10, 11.1, 11.3, 11.9, 12.1, 12.3, 12.4, 12.8, 12.9, 17.4, 17.10
 */
import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { DISPOSITIONS, type DispositionEntry } from '../dispositions.js';
import type { ClaimedAccount } from '../ports.js';
import { photoDrivers, stage1Photos, stage2Trips, stage3Anonymize, stage4PersonalData } from './purgeDriver.js';
import type { Row } from './helpers.js';
import {
  BOB,
  CHUNK_ROWS,
  claimSubject,
  createWorld,
  findByPk,
  rowsOf,
  seedEntry,
  SUBJECT,
  userRow,
  type World,
} from './world.js';

const loops = async (step: () => Promise<number>): Promise<number[]> => {
  const sizes: number[] = [];
  for (let i = 0; i < 1000; i++) {
    const n = await step();
    if (n === 0) return sizes;
    sizes.push(n);
  }
  throw new Error('chunk loop did not terminate');
};

const key = (e: DispositionEntry): string => `${e.table}.${e.column}`;

describe('accountDeletion repo: registry rows, one test each (pg-mem)', () => {
  let w: World;
  let c: ClaimedAccount;

  beforeEach(async () => {
    w = await createWorld();
  });

  const byDisposition = (d: DispositionEntry['disposition']): DispositionEntry[] =>
    DISPOSITIONS.filter((e) => e.disposition === d);

  describe.each(byDisposition('delete').concat(byDisposition('session')).map((e) => [key(e), e] as const))('delete: %s', (_name, entry) => {
    it('removes the subject row in chunks of at most CHUNK_ROWS and leaves the bystander\'s row', async () => {
      const { subject, control } = await seedEntry(w, entry);
      c = await claimSubject(w);
      expect(await findByPk(w, entry.table, subject)).toBeDefined();

      const sizes = await loops(() => w.repo.applyDeleteOrNullChunk(c, entry));

      expect(sizes.length).toBeGreaterThan(0);
      for (const n of sizes) expect(n).toBeLessThanOrEqual(CHUNK_ROWS);
      expect(await findByPk(w, entry.table, subject)).toBeUndefined();
      if (control !== null) expect(await findByPk(w, entry.table, control)).toBeDefined();
      // Idempotent: a second pass finds nothing.
      expect(await w.repo.applyDeleteOrNullChunk(c, entry)).toBe(0);
    });
  });

  describe.each(byDisposition('nullify').map((e) => [key(e), e] as const))('nullify: %s', (_name, entry) => {
    it('nulls the column on the subject row only, changes no other column, and keeps the row', async () => {
      const { subject, control } = await seedEntry(w, entry);
      c = await claimSubject(w);

      const sizes = await loops(() => w.repo.applyDeleteOrNullChunk(c, entry));
      for (const n of sizes) expect(n).toBeLessThanOrEqual(CHUNK_ROWS);

      const after = (await findByPk(w, entry.table, subject))!;
      expect(after, 'the row survives').toBeDefined();
      expect(after[entry.column]).toBeNull();
      for (const k of Object.keys(subject)) {
        if (k === entry.column) continue;
        expect(JSON.stringify(after[k]), `${entry.table}.${k}`).toBe(JSON.stringify(subject[k]));
      }
      if (control !== null) {
        const ctl = (await findByPk(w, entry.table, control))!;
        expect(ctl[entry.column]).toBe(control[entry.column]);
      }
      expect(await w.repo.applyDeleteOrNullChunk(c, entry)).toBe(0);
    });
  });

  describe.each(byDisposition('anonymize').map((e) => [key(e), e] as const))('anonymize: %s', (_name, entry) => {
    it('re-points the column at the tombstone, keeps the row and every other column, and leaves the bystander\'s row', async () => {
      const { subject, control } = await seedEntry(w, entry);
      c = await claimSubject(w);
      const tombstoneId = await w.repo.ensureTombstone(c);
      expect(tombstoneId).toBe(c.placeholderId);

      const sizes = await loops(() => w.repo.anonymizeChunk(c, entry, tombstoneId));
      for (const n of sizes) expect(n).toBeLessThanOrEqual(CHUNK_ROWS);
      expect(sizes.length).toBeGreaterThan(0);

      const after = (await findByPk(w, entry.table, subject))!;
      expect(after, 'the row survives anonymization').toBeDefined();
      expect(after[entry.column]).toBe(tombstoneId);
      for (const k of Object.keys(subject)) {
        if (k === entry.column) continue;
        expect(JSON.stringify(after[k]), `${entry.table}.${k} must be unchanged`).toBe(JSON.stringify(subject[k]));
      }
      if (control !== null) expect((await findByPk(w, entry.table, control))![entry.column]).toBe(BOB.id);
      expect(await w.repo.anonymizeChunk(c, entry, tombstoneId)).toBe(0);
      // Nothing in the registry reports this column as still naming the person.
      const remaining = await w.repo.countRemainingReferences(SUBJECT.id);
      expect(remaining.find((r) => r.table === entry.table && r.column === entry.column)).toBeUndefined();
    });
  });

  describe('anonymize_then_delete: experience_logs.user_id (Property 28)', () => {
    const entry = DISPOSITIONS.find((e) => e.table === 'experience_logs')!;

    it('stage 3 re-points only the trip-referenced log and blanks its note; stage 4 deletes the private ones; the trip log entry and its tags survive', async () => {
      const privateLog = await w.seeder.insertRow('experience_logs', { user_id: SUBJECT.id, note: 'private diary' });
      const retained = await w.seeder.insertRow('experience_logs', {
        user_id: SUBJECT.id,
        note: 'ate with Bob',
        rating: 4,
        visited_on: '2026-03-02',
        user_tz: 'America/New_York',
      });
      const tripEntry = await w.seeder.insertRow('trip_log_entries', { member_id: SUBJECT.id, log_id: retained.id });
      const tag = await w.seeder.insertRow('rode_with_tags', { log_entry_id: tripEntry.id, tagged_member_id: BOB.id });
      const feed = await w.seeder.insertRow('trip_feed_items', { trip_id: tripEntry.trip_id, actor_id: BOB.id, type: 'completion_logged' });
      c = await claimSubject(w);
      const tombstoneId = await w.repo.ensureTombstone(c);

      // The delete path refuses to run while a retained row still names the user (it would cascade).
      await expect(w.repo.applyDeleteOrNullChunk(c, entry)).rejects.toThrow(/stage 3 must anonymize/);
      expect(await findByPk(w, 'trip_log_entries', tripEntry)).toBeDefined();

      // Stage 3: counted as remaining before, re-pointed after.
      expect((await w.repo.countRemainingReferences(SUBJECT.id)).find((r) => r.table === 'experience_logs')?.count).toBe(1);
      const sizes = await loops(() => w.repo.anonymizeChunk(c, entry, tombstoneId));
      expect(sizes).toEqual([1]);
      expect((await w.repo.countRemainingReferences(SUBJECT.id)).find((r) => r.table === 'experience_logs')).toBeUndefined();

      const kept = (await findByPk(w, 'experience_logs', retained))!;
      expect(kept.user_id).toBe(tombstoneId);
      expect(kept.note).toBeNull();
      for (const k of ['experience_id', 'visited_on', 'user_tz', 'logged_at', 'rating']) {
        expect(JSON.stringify(kept[k]), k).toBe(JSON.stringify(retained[k]));
      }
      expect((await findByPk(w, 'experience_logs', privateLog))!.user_id).toBe(SUBJECT.id); // untouched by stage 3

      // Stage 4: the private row goes, the retained one stays.
      const deleted = await loops(() => w.repo.applyDeleteOrNullChunk(c, entry));
      expect(deleted).toEqual([1]);
      expect(await findByPk(w, 'experience_logs', privateLog)).toBeUndefined();
      expect(await findByPk(w, 'experience_logs', retained)).toBeDefined();
      expect(await findByPk(w, 'trip_log_entries', tripEntry)).toBeDefined();
      expect(await findByPk(w, 'rode_with_tags', tag)).toBeDefined();
      expect(await findByPk(w, 'trip_feed_items', feed)).toBeDefined();
    });
  });

  describe('trip: trips.creator_id', () => {
    it('is executed by resolveTrip: the creator reference is re-pointed and counted as a remaining reference until then', async () => {
      const entry = DISPOSITIONS.find((e) => e.disposition === 'trip')!;
      const { subject } = await seedEntry(w, entry);
      await w.seeder.insertRow('trip_memberships', { trip_id: subject.id, user_id: SUBJECT.id, role: 'organizer' });
      await w.seeder.insertRow('trip_memberships', { trip_id: subject.id, user_id: BOB.id, role: 'member' });
      c = await claimSubject(w);
      expect((await w.repo.countRemainingReferences(SUBJECT.id)).find((r) => r.table === 'trips')?.count).toBe(1);

      // The registry loop must refuse to treat a trip row as deletable.
      await expect(w.repo.applyDeleteOrNullChunk(c, entry)).rejects.toThrow(/disposition 'trip'/);
      await expect(w.repo.anonymizeChunk(c, entry, c.placeholderId)).rejects.toThrow(/disposition 'trip'/);

      const drivers = photoDrivers(w);
      expect(await w.repo.resolveTrip(c, String(subject.id), { photoPort: drivers.tripPhotos, now: new Date() })).toBe('transferred');
      expect((await findByPk(w, 'trips', subject))!.creator_id).toBe(BOB.id);
      expect((await w.repo.countRemainingReferences(SUBJECT.id)).find((r) => r.table === 'trips')).toBeUndefined();
    });
  });

  it('the registry-driven tests above cover every row: each disposition has at least one describe.each case', () => {
    const covered = new Set([
      ...byDisposition('delete'),
      ...byDisposition('session'),
      ...byDisposition('nullify'),
      ...byDisposition('anonymize'),
      ...byDisposition('anonymize_then_delete'),
      ...byDisposition('trip'),
    ]);
    expect(covered.size).toBe(DISPOSITIONS.length);
  });
});

describe('accountDeletion repo: photo stage, owner nulling, share scrub, recompute drain (pg-mem)', () => {
  let w: World;
  let c: ClaimedAccount;

  beforeEach(async () => {
    w = await createWorld();
    c = await claimSubject(w);
  });

  async function photo(ownerId: string, status = 'approved', extra: Row = {}): Promise<string> {
    return String(
      (
        await w.seeder.insertRow('photos', {
          owner_id: ownerId,
          status,
          harm_verdict: 'pass',
          vision_verdict: 'pass',
          full_etag: 'f',
          thumb_etag: 't',
          ...extra,
        })
      ).id,
    );
  }

  describe('photos (Property 19)', () => {
    it('stage 1 marks every non-deleted photo deleted exactly once, counts them, and a second pass returns nothing', async () => {
      const mine = [await photo(SUBJECT.id), await photo(SUBJECT.id, 'pending'), await photo(SUBJECT.id, 'hidden', { hidden_reason: 'reports' })];
      const already = await photo(SUBJECT.id, 'deleted', { deleted_at: new Date('2026-01-01T00:00:00Z') });
      const theirs = await photo(BOB.id);
      const d = photoDrivers(w);

      await stage1Photos(w, c, d, CHUNK_ROWS);

      const status = async (id: string): Promise<Row> =>
        (await w.pool.query(`SELECT status, deleted_at FROM photos WHERE id = $1`, [id])).rows[0] as Row;
      for (const id of mine) expect((await status(id)).status).toBe('deleted');
      expect((await status(theirs)).status).toBe('approved');
      expect(new Date((await status(already)).deleted_at as Date).toISOString()).toBe('2026-01-01T00:00:00.000Z'); // not re-stamped
      const row = (await w.pool.query(`SELECT purge_photos_deleted, purge_stage FROM users WHERE id = $1`, [SUBJECT.id])).rows[0] as Row;
      expect(row.purge_photos_deleted).toBe(3);
      expect(row.purge_stage).toBe(1);

      expect(await d.photos.deleteAllForUser(SUBJECT.id, { limit: CHUNK_ROWS })).toEqual([]);
    });

    it('the soft-deleted rows are still found BY OWNER until the user row goes (the regression for "photos before the user row")', async () => {
      const id = await photo(SUBJECT.id);
      await stage1Photos(w, c, photoDrivers(w), CHUNK_ROWS);
      const byOwner = (await w.pool.query(`SELECT id, status FROM photos WHERE owner_id = $1`, [SUBJECT.id])).rows as Row[];
      expect(byOwner).toEqual([{ id, status: 'deleted' }]);
    });

    it('stage 4 nulls owner_id in chunks of at most CHUNK_ROWS, listDeleted still returns the rows, and the orphan reaper query does not', async () => {
      const total = Math.floor(CHUNK_ROWS * 2.5);
      const ids: string[] = [];
      for (let i = 0; i < total; i++) ids.push(await photo(SUBJECT.id));
      await stage1Photos(w, c, photoDrivers(w), CHUNK_ROWS);
      const entry = DISPOSITIONS.find((e) => e.table === 'photos')!;

      w.resetStatements();
      const sizes = await loops(() => w.repo.applyDeleteOrNullChunk(c, entry));
      expect(sizes).toEqual([CHUNK_ROWS, CHUNK_ROWS, total - 2 * CHUNK_ROWS]);

      const rows = (await w.pool.query(`SELECT owner_id, status FROM photos`)).rows as Row[];
      expect(rows).toHaveLength(total);
      for (const r of rows) {
        expect(r.owner_id).toBeNull();
        expect(r.status).toBe('deleted');
      }
      // The sweep selects by status, with no owner condition.
      const { createPhotosRepo } = await import('../../photos/repo.js');
      const listed = await createPhotosRepo(w.pool).listDeleted(total + 10);
      expect(listed.map((p) => p.id).sort()).toEqual([...ids].sort());
    });
  });

  describe('scrubShares (Property 20, stage half)', () => {
    const share = (senderId: string, kind: string, payload: object): Promise<Row> =>
      w.seeder.insertRow('shares', { sender_id: senderId, payload_kind: kind, payload_snapshot: payload });

    it('scrubs pinShowcase and tripSummary shares by sender, before and after the re-point, writes nothing the second time, and leaves other kinds and senders alone', async () => {
      const tripId = randomUUID();
      const experienceId = String((await w.seeder.insertRow('experiences')).id);
      const pin = await share(SUBJECT.id, 'pinShowcase', { kind: 'pinShowcase', ownerId: SUBJECT.id, ownerDisplayName: SUBJECT.displayName });
      const trip = await share(SUBJECT.id, 'tripSummary', {
        kind: 'tripSummary',
        tripId,
        tripName: 'Spring',
        sharerDisplayName: SUBJECT.displayName,
        includePhotos: false,
      });
      const expPayload = { kind: 'experience', experienceId, note: 'loved it' };
      const exp = await w.seeder.insertRow('shares', {
        sender_id: SUBJECT.id,
        payload_kind: 'experience',
        experience_id: experienceId,
        payload_snapshot: expPayload,
      });
      const progPayload = { kind: 'progress', overallPercent: 40, perParkPercent: {}, perCategoryPercent: {} };
      const prog = await share(SUBJECT.id, 'progress', progPayload);
      const bobsPayload = { kind: 'pinShowcase', ownerId: BOB.id, ownerDisplayName: BOB.displayName };
      const bobsPin = await share(BOB.id, 'pinShowcase', bobsPayload);
      const tombstoneId = await w.repo.ensureTombstone(c);

      const scrubAll = async (): Promise<number> => {
        let total = 0;
        let cursor: string | null = null;
        for (let i = 0; i < 20; i++) {
          const page: { lastId: string | null; scrubbed: number } = await w.repo.scrubShares(c, tombstoneId, cursor);
          total += page.scrubbed;
          if (page.lastId === null) break;
          cursor = page.lastId;
        }
        return total;
      };
      const payload = async (r: Row): Promise<unknown> =>
        ((await w.pool.query(`SELECT payload_snapshot FROM shares WHERE id = $1`, [r.id])).rows[0] as Row).payload_snapshot;

      expect(await scrubAll()).toBe(2);
      expect(await payload(pin)).toEqual({ kind: 'pinShowcase', ownerId: tombstoneId, ownerDisplayName: 'Deleted user' });
      expect(await payload(trip)).toEqual({
        kind: 'tripSummary',
        tripId,
        tripName: 'Spring',
        sharerDisplayName: 'Deleted user',
        includePhotos: false,
      });
      expect(await payload(exp)).toEqual(expPayload);
      expect(await payload(prog)).toEqual(progPayload);
      expect(await payload(bobsPin)).toEqual(bobsPayload);

      // Re-point the sender, then scrub again: found by the tombstone sender, nothing left to write.
      const shareEntry = DISPOSITIONS.find((e) => e.table === 'shares')!;
      await loops(() => w.repo.anonymizeChunk(c, shareEntry, tombstoneId));
      expect(await scrubAll()).toBe(0);
      expect(await payload(pin)).toEqual({ kind: 'pinShowcase', ownerId: tombstoneId, ownerDisplayName: 'Deleted user' });
      expect(((await w.pool.query(`SELECT sender_id FROM shares WHERE id = $1`, [pin.id])).rows[0] as Row).sender_id).toBe(tombstoneId);
    });

    it('a crash between the re-point and the scrub is repaired by the next run (rows selected by tombstone sender)', async () => {
      const pin = await share(SUBJECT.id, 'pinShowcase', { kind: 'pinShowcase', ownerId: SUBJECT.id, ownerDisplayName: SUBJECT.displayName });
      const tombstoneId = await w.repo.ensureTombstone(c);
      const shareEntry = DISPOSITIONS.find((e) => e.table === 'shares')!;
      await loops(() => w.repo.anonymizeChunk(c, shareEntry, tombstoneId)); // sender now the tombstone; payload still real

      const page = await w.repo.scrubShares(c, tombstoneId);
      expect(page.scrubbed).toBe(1);
      const stored = ((await w.pool.query(`SELECT payload_snapshot FROM shares WHERE id = $1`, [pin.id])).rows[0] as Row).payload_snapshot;
      expect(JSON.stringify(stored)).not.toContain(SUBJECT.id);
      expect(JSON.stringify(stored)).not.toContain(SUBJECT.displayName);
    });

    it('pages by id: every page reads at most CHUNK_ROWS rows and a multi-page set is fully scrubbed', async () => {
      const total = CHUNK_ROWS * 2 + 7;
      for (let i = 0; i < total; i++) {
        await share(SUBJECT.id, 'pinShowcase', { kind: 'pinShowcase', ownerId: SUBJECT.id, ownerDisplayName: SUBJECT.displayName });
      }
      const tombstoneId = await w.repo.ensureTombstone(c);

      w.resetStatements();
      let cursor: string | null = null;
      let scrubbed = 0;
      let pages = 0;
      for (let i = 0; i < 20; i++) {
        const page: { lastId: string | null; scrubbed: number } = await w.repo.scrubShares(c, tombstoneId, cursor);
        scrubbed += page.scrubbed;
        if (page.lastId === null) break;
        pages += 1;
        cursor = page.lastId;
      }
      expect(scrubbed).toBe(total);
      expect(pages).toBe(3);
      const selects = w.statements.filter((s) => /^SELECT id, payload_snapshot FROM shares/.test(s.text.trim()));
      for (const s of selects) expect(s.rowCount).toBeLessThanOrEqual(CHUNK_ROWS);
      const rows = (await w.pool.query(`SELECT payload_snapshot FROM shares`)).rows as Row[];
      expect(JSON.stringify(rows)).not.toContain(SUBJECT.displayName);
    });
  });

  describe('drainRecomputeQueue', () => {
    async function queue(n: number): Promise<string[]> {
      const ids: string[] = [];
      for (let i = 0; i < n; i++) {
        const exp = await w.seeder.insertRow('experiences');
        await w.pool.query(`INSERT INTO account_deletion_recompute_queue (experience_id, enqueued_at) VALUES ($1, $2)`, [
          exp.id,
          new Date(Date.UTC(2026, 4, 1, 0, i)),
        ]);
        ids.push(String(exp.id));
      }
      return ids;
    }
    const queued = async (): Promise<string[]> =>
      ((await w.pool.query(`SELECT experience_id FROM account_deletion_recompute_queue ORDER BY enqueued_at`)).rows as Row[]).map((r) => String(r.experience_id));

    it('recomputes at most `limit` queued experiences oldest first and removes each one it recomputed', async () => {
      const ids = await queue(5);
      const seen: string[] = [];
      expect(await w.repo.drainRecomputeQueue(3, async (id) => void seen.push(id))).toBe(3);
      expect(seen).toEqual(ids.slice(0, 3));
      expect(await queued()).toEqual(ids.slice(3));
    });

    it('a recompute that throws leaves its row queued for the next run and does not block the others', async () => {
      const ids = await queue(3);
      const done = await w.repo.drainRecomputeQueue(10, async (id) => {
        if (id === ids[1]) throw new Error('aggregate down');
      });
      expect(done).toBe(2);
      expect(await queued()).toEqual([ids[1]]);
      expect(await w.repo.drainRecomputeQueue(10, async () => undefined)).toBe(1);
      expect(await queued()).toEqual([]);
    });

    it('an empty queue is one read and no write', async () => {
      w.resetStatements();
      expect(await w.repo.drainRecomputeQueue(10, async () => undefined)).toBe(0);
      expect(w.statements).toHaveLength(1);
      expect(w.statements[0]!.text.trim()).toMatch(/^SELECT/);
    });
  });

  describe('stage idempotence (Property 14)', () => {
    it('running stages 3 and 4 twice leaves the same database as running them once', async () => {
      const tables = [
        'shares', 'completions', 'trip_comments', 'photos', 'experience_logs', 'food_items', 'settlements',
        'trips', 'trip_memberships', 'users', 'profiles',
      ];
      for (const e of DISPOSITIONS) {
        // Seeding every row is covered above; a representative cross-section keeps this test fast.
        if (!tables.includes(e.table) && e.table !== 'ratings') continue;
        await seedEntry(w, e);
      }
      const drivers = photoDrivers(w);
      const snap = async (): Promise<string> => JSON.stringify(await Promise.all([...tables, 'account_deletion_recompute_queue'].map((t) => rowsOf(w, t))));
      const stages = async (): Promise<void> => {
        await stage1Photos(w, c, drivers, CHUNK_ROWS);
        await stage2Trips(w, c, drivers);
        await stage3Anonymize(w, c);
        await stage4PersonalData(w, c);
      };

      await stages();
      const once = await snap();
      await stages();
      // Applying any stage a second time leaves the database exactly as the first run left it (counters
      // are written by advanceStage / addCounters only when a stage did work, so they do not drift either).
      expect(await snap()).toBe(once);
      expect((await userRow(w, SUBJECT.id))!.purge_stage).toBe(4);
    });
  });
});
