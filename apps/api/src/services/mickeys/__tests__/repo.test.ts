// Feature: hidden-mickeys, Property 2: Hint level is monotonic
// Feature: hidden-mickeys, Property 3: Find idempotence
// Feature: hidden-mickeys, Property 4: Undo clears exactly the find state
// Feature: hidden-mickeys, Property 6: Community entries never move the official total
// Feature: hidden-mickeys, Property 8: One vote per user
// Feature: hidden-mickeys, Property 10: Visibility
// Feature: hidden-mickeys, Property 21: Experience groups
// Feature: hidden-mickeys, Property 22: Catalog independence
// Feature: hidden-mickeys, Property 23: Zone filter

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { DefaultMickeyRepo } from '../repo.js';
import { HuntService } from '../service.js';
import { DEFAULT_MICKEYS_CONFIG } from '../../../config.js';
import { groupOf } from '../domain/aliasGroup.js';
import type { MickeyZone, MickeyDifficulty } from '@dwt/shared';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'migrations');

function buildPgMemDatabase(): IMemoryDb {
  const db = newDb({ noAstCoverageCheck: true });
  db.registerExtension('citext', () => {});
  db.registerExtension('pg_trgm', () => {});
  db.registerExtension('pgcrypto', (schema) => {
    schema.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      implementation: () => randomUUID(),
      impure: true,
    });
  });

  const pub = db.public;
  pub.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  pub.registerFunction({
    name: 'lower',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.toLowerCase() : ''),
  });
  pub.registerFunction({
    name: 'trim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.trim() : ''),
  });
  pub.registerFunction({
    name: 'btrim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.trim() : ''),
  });
  pub.registerFunction({
    name: 'length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  pub.registerFunction({
    name: 'jsonb_typeof',
    args: [DataType.jsonb],
    returns: DataType.text,
    implementation: (val: unknown): string => {
      if (val === null || val === undefined) return 'null';
      let parsed = val;
      if (typeof val === 'string') {
        try {
          parsed = JSON.parse(val);
        } catch {
          return 'string';
        }
      }
      if (parsed === null) return 'null';
      if (Array.isArray(parsed)) return 'array';
      if (typeof parsed === 'object') return 'object';
      return 'null';
    },
  });

  return db;
}

function applyMigrations(db: IMemoryDb): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((n) => /^\d{4}_.*\.sql$/u.test(n))
    .sort((a, b) => a.localeCompare(b));

  for (const name of files) {
    // Skip data-only backfills as pg-mem does not support correlated subqueries in WHERE NOT EXISTS
    if (/^00(70|71)_backfill/u.test(name)) continue;
    let sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
    sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
    sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
    sql = sql.replace(
      /CREATE INDEX IF NOT EXISTS mickey_progress_mickey_idx ON mickey_progress\(mickey_id\) WHERE found_at IS NOT NULL;/g,
      'CREATE INDEX IF NOT EXISTS mickey_progress_mickey_idx ON mickey_progress(mickey_id);',
    );
    db.public.none(sql);
  }
}

describe('MickeyRepo SQL Integration (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let repo: DefaultMickeyRepo;

  let testUserId: string;
  let testUser2Id: string;
  let testExpId: string;
  let testExpAliasId: string;
  let testExpResortId: string;
  let testTripId: string;
  let testTrip2Id: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    applyMigrations(db);
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as DbPool;
    repo = new DefaultMickeyRepo(pool);

    testUserId = randomUUID();
    testUser2Id = randomUUID();
    testExpId = randomUUID();
    testExpAliasId = randomUUID();
    testExpResortId = randomUUID();
    testTripId = randomUUID();
    testTrip2Id = randomUUID();

    // Insert test users
    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, 'u1@test.com', 'hash')`,
      [testUserId],
    );
    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, 'u2@test.com', 'hash')`,
      [testUser2Id],
    );
    await pool.query(
      `INSERT INTO profiles (user_id, display_name) VALUES ($1, 'User 1'), ($2, 'User 2')`,
      [testUserId, testUser2Id],
    );

    // Insert experiences (base ride, alias ride, resort experience)
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, category, park, land, area_type, active)
       VALUES ($1, 'exp-base-1', 'Living with the Land', 'Ride', 'EPCOT', 'The Land', 'ThemePark', true)`,
      [testExpId],
    );
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, category, park, land, area_type, active)
       VALUES ($1, 'exp-alias-1', 'Glimmering Greenhouses', 'Ride', 'EPCOT', 'The Land', 'ThemePark', true)`,
      [testExpAliasId],
    );
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, category, park, land, area_type, active)
       VALUES ($1, 'exp-resort-1', 'Grand Floridian Lobby', 'Walkthrough', NULL, NULL, 'Resort', true)`,
      [testExpResortId],
    );

    // Register alias link: testExpAliasId -> testExpId
    await pool.query(
      `INSERT INTO mickey_experience_aliases (alias_experience_id, canonical_experience_id)
       VALUES ($1, $2)`,
      [testExpAliasId, testExpId],
    );

    // Insert test trips
    await pool.query(
      `INSERT INTO trips (id, creator_id, name, start_date, end_date)
       VALUES ($1, $2, 'Test Trip', '2026-11-01', '2026-11-10')`,
      [testTripId, testUserId],
    );
    await pool.query(
      `INSERT INTO trips (id, creator_id, name, start_date, end_date)
       VALUES ($1, $2, 'Test Trip 2', '2026-11-01', '2026-11-10')`,
      [testTrip2Id, testUserId],
    );
  });

  async function createTestMickey(overrides: {
    experienceId?: string;
    zone?: MickeyZone;
    difficulty?: MickeyDifficulty;
    clue1?: string;
    clue2?: string;
    reveal?: string;
    official?: boolean;
    status?: string;
    hiddenReason?: string | null;
    submitterId?: string | null;
  } = {}): Promise<string> {
    const id = randomUUID();
    const expId = overrides.experienceId ?? testExpId;
    const official = overrides.official ?? true;
    const status = overrides.status ?? 'approved';
    const source = overrides.submitterId ? 'user' : (official ? 'seed' : 'user');
    const hiddenReason = status === 'hidden' ? (overrides.hiddenReason ?? 'reports') : null;

    await pool.query(
      `INSERT INTO hidden_mickeys (
         id, experience_id, zone, difficulty, clue_1, clue_2, reveal,
         source, official, status, hidden_reason, submitter_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        expId,
        overrides.zone ?? 'queue',
        overrides.difficulty ?? 'medium',
        overrides.clue1 ?? 'Look near the entrance rafters for three round stones',
        overrides.clue2 ?? 'Examine the wooden beam directly above the turnstile',
        overrides.reveal ?? 'Three dark knots in the beam form a classic Mickey silhouette',
        source,
        official,
        status,
        hiddenReason,
        overrides.submitterId ?? null,
      ],
    );

    return id;
  }

  // Feature: hidden-mickeys, Property 10: Visibility
  it('Property 10: list excludes non-approved statuses and reported entries', async () => {
    const approvedId = await createTestMickey({ status: 'approved' });
    const pendingId = await createTestMickey({ status: 'pending' });
    const rejectedId = await createTestMickey({ status: 'rejected' });
    const retiredId = await createTestMickey({ status: 'retired' });
    const hiddenId = await createTestMickey({ status: 'hidden' });

    // Report approvedId as testUserId
    await pool.query(
      `INSERT INTO mickey_reports (user_id, mickey_id, reason)
       VALUES ($1, $2, 'spam')`,
      [testUserId, approvedId],
    );

    // List for testUserId should NOT include approvedId (because reported) or any non-approved
    const resA = await repo.findApprovedMickeys({ userId: testUserId });
    const idsA = resA.items.map((i) => i.id);
    expect(idsA).not.toContain(approvedId);
    expect(idsA).not.toContain(pendingId);
    expect(idsA).not.toContain(rejectedId);
    expect(idsA).not.toContain(retiredId);
    expect(idsA).not.toContain(hiddenId);

    // List for testUser2Id (who did not report approvedId) SHOULD include approvedId
    const resB = await repo.findApprovedMickeys({ userId: testUser2Id });
    const idsB = resB.items.map((i) => i.id);
    expect(idsB).toContain(approvedId);
    expect(idsB).not.toContain(pendingId);
    expect(idsB).not.toContain(rejectedId);
  });

  // Feature: hidden-mickeys, Property 3: Find idempotence
  it('Property 3: find is idempotent and persists found_at, found_on and trip link', async () => {
    const mId = await createTestMickey();
    const t0 = new Date('2026-11-06T10:00:00Z');
    const t1 = new Date('2026-11-06T12:00:00Z');

    const first = await repo.recordFind(testUserId, mId, testTripId, t0);
    expect(first.mickeyId).toBe(mId);
    expect(first.foundAt).toBe(t0.toISOString());
    expect(first.foundOn).toBe('2026-11-06');
    expect(first.tripId).toBe(testTripId);

    // Find again with a later timestamp and a different trip ID:
    // found_at must equal the first request's time, and trip_id is unchanged
    const second = await repo.recordFind(testUserId, mId, testTrip2Id, t1);
    expect(second.foundAt).toBe(t0.toISOString());
    expect(second.tripId).toBe(testTripId);

    // Read row directly back from database to verify persistence
    const dbRow = await pool.query<{ found_on: string; trip_id: string }>(
      `SELECT found_on, trip_id FROM mickey_progress WHERE user_id = $1 AND mickey_id = $2`,
      [testUserId, mId],
    );
    expect(dbRow.rows[0]?.trip_id).toBe(testTripId);

    // Finding automatically recorded a 'there' vote (Property 8)
    const voteRow = await pool.query<{ vote: string }>(
      `SELECT vote FROM mickey_still_there_votes WHERE user_id = $1 AND mickey_id = $2`,
      [testUserId, mId],
    );
    expect(voteRow.rows[0]?.vote).toBe('there');
  });

  // Feature: hidden-mickeys, Property 4: Undo clears exactly the find state
  it('Property 4: undo clears found_at, found_on and trip_id in one statement, removes vote, keeps hint level', async () => {
    const mId = await createTestMickey();
    await repo.recordHint(testUserId, mId, 3);
    await repo.recordFind(testUserId, mId, testTripId);

    // Verify hint_level is 3 and trip_id is set
    const beforeUndo = await repo.getMickeyDetail(mId, testUserId);
    expect(beforeUndo?.hintLevel).toBe(3);
    expect(beforeUndo?.found).toBe(true);
    expect(beforeUndo?.tripId).toBe(testTripId);

    // Execute undo
    await repo.undoFind(testUserId, mId);

    // Check detail after undo
    const afterUndo = await repo.getMickeyDetail(mId, testUserId);
    expect(afterUndo?.hintLevel).toBe(3); // hint_level is preserved
    expect(afterUndo?.found).toBe(false);
    expect(afterUndo?.tripId).toBeNull();

    // Verify raw row in mickey_progress: found_at, found_on, trip_id are all NULL
    const progRow = await pool.query<{ found_at: unknown; found_on: unknown; trip_id: unknown }>(
      `SELECT found_at, found_on, trip_id FROM mickey_progress WHERE user_id = $1 AND mickey_id = $2`,
      [testUserId, mId],
    );
    expect(progRow.rows[0]?.found_at ?? null).toBeNull();
    expect(progRow.rows[0]?.found_on ?? null).toBeNull();
    expect(progRow.rows[0]?.trip_id ?? null).toBeNull();

    // Verify vote is deleted
    const voteRow = await pool.query(
      `SELECT 1 FROM mickey_still_there_votes WHERE user_id = $1 AND mickey_id = $2`,
      [testUserId, mId],
    );
    expect(voteRow.rows).toHaveLength(0);
  });

  // Feature: hidden-mickeys, Property 2: Hint level is monotonic
  it('Property 2: hint level never decreases', async () => {
    const mId = await createTestMickey();
    const h1 = await repo.recordHint(testUserId, mId, 2);
    expect(h1).toBe(2);

    // Requesting level 2 again stays 2
    const h2 = await repo.recordHint(testUserId, mId, 2);
    expect(h2).toBe(2);

    // Upgrading to 3
    const h3 = await repo.recordHint(testUserId, mId, 3);
    expect(h3).toBe(3);

    // Requesting 2 after 3 stays 3
    const h4 = await repo.recordHint(testUserId, mId, 2);
    expect(h4).toBe(3);
  });

  // Feature: hidden-mickeys, Property 8: One vote per user
  it('Property 8: recordVote replaces previous vote', async () => {
    const mId = await createTestMickey();
    await repo.recordVote(testUserId, mId, 'there');

    const v1 = await pool.query<{ vote: string }>(
      `SELECT vote FROM mickey_still_there_votes WHERE user_id = $1 AND mickey_id = $2`,
      [testUserId, mId],
    );
    expect(v1.rows[0]?.vote).toBe('there');

    await repo.recordVote(testUserId, mId, 'gone');
    const v2 = await pool.query<{ vote: string }>(
      `SELECT vote FROM mickey_still_there_votes WHERE user_id = $1 AND mickey_id = $2`,
      [testUserId, mId],
    );
    expect(v2.rows).toHaveLength(1);
    expect(v2.rows[0]?.vote).toBe('gone');
  });

  // Feature: hidden-mickeys, Property 21: Experience groups
  it('Property 21: experienceId filter resolves alias and canonical to identical results matching groupOf', async () => {
    // Mickey on canonical ride
    const mCanonical = await createTestMickey({
      experienceId: testExpId,
      clue1: 'Mickey on the living with the land boat ride',
    });

    // Mickey on alias ride (e.g. holiday overlay specific)
    const mAlias = await createTestMickey({
      experienceId: testExpAliasId,
      clue1: 'Mickey in the glimmering greenhouses light setup',
    });

    // Mickey on unlinked resort
    const mResort = await createTestMickey({
      experienceId: testExpResortId,
      clue1: 'Mickey on grand floridian lobby carpet pattern',
    });

    // Querying canonical experienceId returns both mCanonical and mAlias
    const byCanonical = await repo.findApprovedMickeys({ experienceId: testExpId });
    const idsByCanon = byCanonical.items.map((i) => i.id).sort();
    expect(idsByCanon).toContain(mCanonical);
    expect(idsByCanon).toContain(mAlias);
    expect(idsByCanon).not.toContain(mResort);

    // Querying alias experienceId returns the EXACT same set
    const byAlias = await repo.findApprovedMickeys({ experienceId: testExpAliasId });
    const idsByAlias = byAlias.items.map((i) => i.id).sort();
    expect(idsByAlias).toEqual(idsByCanon);

    // Verify SQL result equals groupOf model
    const storedLinks = [{ aliasId: testExpAliasId, canonicalId: testExpId }];
    const expectedGroup = groupOf(testExpAliasId, storedLinks);
    expect(expectedGroup).toEqual([testExpAliasId, testExpId].sort());

    const returnedExpIds = [...new Set(byAlias.items.map((i) => i.experienceId))].sort();
    expect(returnedExpIds).toEqual(expectedGroup);
  });

  // Feature: hidden-mickeys, Property 22: Catalog independence
  it('Property 22: deactivating experience does not hide mickeys, alter totals, or block finds/votes', async () => {
    const mId = await createTestMickey({ experienceId: testExpId });

    // Flip experience to inactive
    await pool.query(`UPDATE experiences SET active = false WHERE id = $1`, [testExpId]);

    // 1. Still listed in findApprovedMickeys
    const list = await repo.findApprovedMickeys({});
    expect(list.items.some((i) => i.id === mId)).toBe(true);

    // 2. Still in summary totals
    const summary = await repo.getSummary(testUserId);
    expect(summary.overall.total).toBeGreaterThanOrEqual(1);

    // 3. Still findable
    const findRes = await repo.recordFind(testUserId, mId);
    expect(findRes.mickeyId).toBe(mId);

    // 4. Still votable
    await repo.recordVote(testUserId, mId, 'gone');
    const detail = await repo.getMickeyDetail(mId, testUserId);
    expect(detail?.id).toBe(mId);
    expect(detail?.found).toBe(true);
  });

  // Feature: hidden-mickeys, Property 23: Zone filter
  it('Property 23: zone filter matches exactly requested zone and composes with other filters', async () => {
    const mQueue = await createTestMickey({ zone: 'queue', clue1: 'Queue clue text for testing 1' });
    const mRide = await createTestMickey({ zone: 'on_ride', clue1: 'On-ride clue text for testing 2' });

    const queueOnly = await repo.findApprovedMickeys({ zone: 'queue' });
    const queueIds = queueOnly.items.map((i) => i.id);
    expect(queueIds).toContain(mQueue);
    expect(queueIds).not.toContain(mRide);

    const rideOnly = await repo.findApprovedMickeys({ zone: 'on_ride' });
    const rideIds = rideOnly.items.map((i) => i.id);
    expect(rideIds).toContain(mRide);
    expect(rideIds).not.toContain(mQueue);
  });

  // Feature: hidden-mickeys, Property 6: Community entries never move the official total
  it('Property 6: summary counts only Official entries; caller report on Official entry never alters total or found', async () => {
    const mOfficial = await createTestMickey({ official: true, experienceId: testExpId });
    const mCommunity = await createTestMickey({ official: false, experienceId: testExpId });

    // User 1 finds both
    await repo.recordFind(testUserId, mOfficial);
    await repo.recordFind(testUserId, mCommunity);

    const s1 = await repo.getSummary(testUserId);
    expect(s1.overall.total).toBe(1);
    expect(s1.overall.found).toBe(1);
    expect(s1.community.found).toBe(1);

    // User 1 reports the Official mickey
    await pool.query(
      `INSERT INTO mickey_reports (user_id, mickey_id, reason)
       VALUES ($1, $2, 'spam')`,
      [testUserId, mOfficial],
    );

    // Reporter's summary on Official entry is completely unchanged
    const s1AfterOfficialReport = await repo.getSummary(testUserId);
    expect(s1AfterOfficialReport.overall.total).toBe(1);
    expect(s1AfterOfficialReport.overall.found).toBe(1);

    // User 1 reports the Community mickey
    await pool.query(
      `INSERT INTO mickey_reports (user_id, mickey_id, reason)
       VALUES ($1, $2, 'spam')`,
      [testUserId, mCommunity],
    );

    // Reporter's community found drops by 1
    const s1AfterCommunityReport = await repo.getSummary(testUserId);
    expect(s1AfterCommunityReport.community.found).toBe(0);
    expect(s1AfterCommunityReport.overall.total).toBe(1);
    expect(s1AfterCommunityReport.overall.found).toBe(1);
  });

  it('counts resort mickeys under park: null in summary', async () => {
    await createTestMickey({ experienceId: testExpResortId, official: true });
    const summary = await repo.getSummary();
    const nullPark = summary.byPark.find((p) => p.park === null);
    expect(nullPark).toBeDefined();
    expect(nullPark!.total).toBeGreaterThanOrEqual(1);
    expect(summary.overall.total).toBe(summary.byPark.reduce((acc, p) => acc + p.total, 0));
  });

  it('filters by areaType=Resort and q search parameter in SQL', async () => {
    const mResort = await createTestMickey({ experienceId: testExpResortId, clue1: 'UniqueSecretInLobbyClue' });
    const mThemePark = await createTestMickey({ experienceId: testExpId, clue1: 'ThemeParkDifferentClue' });

    // areaType filter
    const resortRes = await repo.findApprovedMickeys({ areaType: 'Resort' });
    const resortIds = resortRes.items.map((i) => i.id);
    expect(resortIds).toContain(mResort);
    expect(resortIds).not.toContain(mThemePark);

    // q filter
    const qRes = await repo.findApprovedMickeys({ q: 'UniqueSecretInLobby' });
    expect(qRes.items.map((i) => i.id)).toEqual([mResort]);
  });

  describe('findUserFinds (Task 4.1, Requirement 10.2)', () => {
    it('returns only approved finds with cursor pagination and no clue2 or reveal', async () => {
      const m1 = await createTestMickey({ experienceId: testExpId, official: true, clue1: 'First approved find clue' });
      const m2 = await createTestMickey({ experienceId: testExpId, official: false, clue1: 'Second approved community clue' });
      const m3 = await createTestMickey({ experienceId: testExpId, status: 'pending', clue1: 'Pending unapproved clue' });

      // Record finds for m1 and m2
      await repo.recordFind(testUserId, m1, null, new Date('2026-11-06T10:00:00Z'));
      await repo.recordFind(testUserId, m2, null, new Date('2026-11-06T11:00:00Z'));

      const page1 = await repo.findUserFinds(testUserId, undefined, 1);
      expect(page1.items).toHaveLength(1);
      expect(page1.items[0]!.mickeyId).toBe(m2); // Newest first
      expect(page1.items[0]!.clue1).toBe('Second approved community clue');
      expect((page1.items[0] as any).clue2).toBeUndefined();
      expect((page1.items[0] as any).reveal).toBeUndefined();
      expect(page1.nextCursor).toBeDefined();

      const page2 = await repo.findUserFinds(testUserId, page1.nextCursor!, 1);
      expect(page2.items).toHaveLength(1);
      expect(page2.items[0]!.mickeyId).toBe(m1);
      expect(page2.nextCursor).toBeNull();

      // Non-found mickey m3 not returned
      const all = await repo.findUserFinds(testUserId, undefined, 10);
      expect(all.items.map((i) => i.mickeyId)).toEqual([m2, m1]);
      expect(all.items.some((i) => i.mickeyId === m3)).toBe(false);
    });
  });

  describe('getTripMickeys (Task 4.2, Property 17: Trip tally counts)', () => {
    it('computes member counts and distinct mickeys, handles member departure and other trip finds', async () => {
      const mOff = await createTestMickey({ experienceId: testExpId, official: true, clue1: 'Official trip mickey' });
      const mCom = await createTestMickey({ experienceId: testExpId, official: false, clue1: 'Community trip mickey' });
      const mOther = await createTestMickey({ experienceId: testExpId, official: true, clue1: 'Other trip mickey' });

      // testUserId and testUser2Id are members of testTripId
      await pool.query(
        `INSERT INTO trip_memberships (trip_id, user_id, role)
         VALUES ($1, $2, 'member'), ($1, $3, 'member')
         ON CONFLICT DO NOTHING`,
        [testTripId, testUserId, testUser2Id],
      );

      // Finds on testTripId:
      // testUserId finds mOff and mCom on testTripId
      await repo.recordFind(testUserId, mOff, testTripId);
      await repo.recordFind(testUserId, mCom, testTripId);

      // testUser2Id finds mOff on testTripId
      await repo.recordFind(testUser2Id, mOff, testTripId);

      // testUserId finds mOther with no trip
      await repo.recordFind(testUserId, mOther, null);

      const tally1 = await repo.getTripMickeys(testTripId);
      expect(tally1.members).toHaveLength(2);

      const user1Member = tally1.members.find((m) => m.userId === testUserId);
      const user2Member = tally1.members.find((m) => m.userId === testUser2Id);
      expect(user1Member?.count).toBe(2); // mOff + mCom
      expect(user2Member?.count).toBe(1); // mOff

      expect(tally1.mickeys).toHaveLength(2);
      const mOffTally = tally1.mickeys.find((m) => m.mickeyId === mOff);
      const mComTally = tally1.mickeys.find((m) => m.mickeyId === mCom);
      expect(mOffTally?.foundByCount).toBe(2);
      expect(mComTally?.foundByCount).toBe(1);
      expect((mOffTally as any).clue2).toBeUndefined();
      expect((mOffTally as any).reveal).toBeUndefined();

      // Member departure: testUser2Id leaves the trip
      await pool.query(`DELETE FROM trip_memberships WHERE trip_id = $1 AND user_id = $2`, [
        testTripId,
        testUser2Id,
      ]);

      const tallyAfterDeparture = await repo.getTripMickeys(testTripId);
      expect(tallyAfterDeparture.members).toHaveLength(1);
      expect(tallyAfterDeparture.members[0]!.userId).toBe(testUserId);
      // mOff foundByCount now only counts current members (1)
      const mOffAfter = tallyAfterDeparture.mickeys.find((m) => m.mickeyId === mOff);
      expect(mOffAfter?.foundByCount).toBe(1);
    });
  });

  describe('Property 16: Friend read gating', () => {
    it('authorizes self and friend, rejects stranger with profile_forbidden', async () => {
      const huntService = new HuntService(pool, repo, DEFAULT_MICKEYS_CONFIG);
      const strangerId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, email, password_hash)
         VALUES ($1, 'stranger@example.com', 'hash')`,
        [strangerId],
      );

      // Establish friendship between testUserId and testUser2Id
      const [lo, hi] = testUserId < testUser2Id ? [testUserId, testUser2Id] : [testUser2Id, testUserId];
      await pool.query(
        `INSERT INTO friendships (user_lo_id, user_hi_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [lo, hi],
      );

      // Self read succeeds
      const selfFinds = await huntService.getUserFinds(testUserId, testUserId);
      expect(selfFinds.items).toBeDefined();

      const selfSummary = await huntService.getSummary(testUserId, testUserId);
      expect(selfSummary.overall).toBeDefined();

      // Friend read succeeds
      const friendFinds = await huntService.getUserFinds(testUser2Id, testUserId);
      expect(friendFinds.items).toBeDefined();

      const friendSummary = await huntService.getSummary(testUser2Id, testUserId);
      expect(friendSummary.overall).toBeDefined();

      // Stranger read fails with profile_forbidden
      await expect(huntService.getUserFinds(strangerId, testUserId)).rejects.toThrow(
        expect.objectContaining({ code: 'profile_forbidden' }),
      );

      await expect(huntService.getSummary(strangerId, testUserId)).rejects.toThrow(
        expect.objectContaining({ code: 'profile_forbidden' }),
      );
    });
  });
});
