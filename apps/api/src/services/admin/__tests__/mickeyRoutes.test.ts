/**
 * Integration & Property tests for Admin Hidden Mickeys Review Queue (Task 7.3).
 *
 * Validates: Requirements 1.3, 8.1 - 8.9, 15.4, 15.5; Properties 6, 11, 14, 20, 22
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { registerErrorHandler } from '../../../errors/index.js';
import { createBasicAuthHook } from '../basicAuth.js';
import { createAdminRepo, type AdminRepo } from '../repo.js';
import { adminRoutes } from '../routes.js';
import { registerMickeyRoutes } from '../mickeyRoutes.js';
import { AdminMickeyService } from '../../mickeys/adminService.js';
import { DefaultMickeyRepo } from '../../mickeys/repo.js';

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

describe('Admin Hidden Mickeys Review Queue (Task 7.3)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let adminRepo: AdminRepo;
  let adminMickeyService: AdminMickeyService;
  let mickeyRepo: DefaultMickeyRepo;
  let app: FastifyInstance;

  const username = 'testadmin';
  const password = 'testpassword';
  const validAuth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  const sameOriginHeaders = {
    authorization: validAuth,
    'sec-fetch-site': 'same-origin',
  };

  let testUserId: string;
  let testExpId: string;
  let testExpAliasId: string;
  let testInactiveCanonId: string;
  let testInactiveAliasId: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    applyMigrations(db);

    const adapter = db.adapters.createPg();
    pool = new adapter.Pool() as unknown as DbPool;
    const redis = new RedisMock() as unknown as Redis;
    adminRepo = createAdminRepo(pool, redis);
    adminMickeyService = new AdminMickeyService({ pool });
    mickeyRepo = new DefaultMickeyRepo(pool);

    const basicAuth = createBasicAuthHook({ username, password });

    app = Fastify();
    registerErrorHandler(app as any);
    await app.register(
      adminRoutes({
        repo: adminRepo,
        basicAuth,
        mickeys: adminMickeyService,
        pool,
      }),
    );
    await app.ready();

    testUserId = randomUUID();
    testExpId = randomUUID();
    testExpAliasId = randomUUID();
    testInactiveCanonId = randomUUID();
    testInactiveAliasId = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'sub@wdw.test', 'h')`,
      [testUserId],
    );
    await pool.query(
      `INSERT INTO profiles (user_id, display_name)
       VALUES ($1, 'Explorer Sam')`,
      [testUserId],
    );

    // Active canonical & alias pair
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, category, park, land, area_type, active)
       VALUES ($1, 'exp-canon', 'Living with the Land', 'Ride', 'EPCOT', 'The Land', 'ThemePark', true)`,
      [testExpId],
    );
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, category, park, land, area_type, active)
       VALUES ($1, 'exp-alias', 'Glimmering Greenhouses', 'Ride', 'EPCOT', 'The Land', 'ThemePark', true)`,
      [testExpAliasId],
    );
    await pool.query(
      `INSERT INTO mickey_experience_aliases (alias_experience_id, canonical_experience_id)
       VALUES ($1, $2)`,
      [testExpAliasId, testExpId],
    );

    // Entirely inactive experience group
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, category, park, land, area_type, active)
       VALUES ($1, 'exp-whirl', 'Primeval Whirl', 'Ride', 'Animal Kingdom', 'DinoLand U.S.A.', 'ThemePark', false)`,
      [testInactiveCanonId],
    );
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, category, park, land, area_type, active)
       VALUES ($1, 'exp-whirl-alias', 'Primeval Whirl Holiday', 'Ride', 'Animal Kingdom', 'DinoLand U.S.A.', 'ThemePark', false)`,
      [testInactiveAliasId],
    );
    await pool.query(
      `INSERT INTO mickey_experience_aliases (alias_experience_id, canonical_experience_id)
       VALUES ($1, $2)`,
      [testInactiveAliasId, testInactiveCanonId],
    );
  });

  async function createMickey(options: {
    status?: string;
    official?: boolean;
    source?: string;
    experienceId?: string;
    clue1?: string;
    submitterId?: string;
  } = {}): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO hidden_mickeys (
         id, experience_id, zone, difficulty,
         clue_1, clue_2, reveal, official, source, status, submitter_id
       ) VALUES (
         $1, $2, 'queue', 'easy',
         $3, 'Beside the blue panel', 'Three circles in the tile',
         $4, $5, $6, $7
       )`,
      [
        id,
        options.experienceId ?? testExpId,
        options.clue1 ?? 'Look near the entrance sign',
        options.official ?? false,
        options.source ?? 'user',
        options.status ?? 'pending',
        options.submitterId ?? testUserId,
      ],
    );
    return id;
  }

  // ---------------------------------------------------------------------------
  // Security & Auth Gate
  // ---------------------------------------------------------------------------
  describe('Security & Auth Gates', () => {
    it('returns 401 on GET /admin/mickeys without basic auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/admin/mickeys' });
      expect(res.statusCode).toBe(401);
    });

    it('returns 403 on cross-origin POST', async () => {
      const id = await createMickey({ status: 'pending' });
      const res = await app.inject({
        method: 'POST',
        url: `/admin/mickeys/${id}/approve`,
        headers: {
          authorization: validAuth,
          'sec-fetch-site': 'cross-site',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('sets X-Robots-Tag: noindex, nofollow and Cache-Control: private, no-store headers', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/mickeys',
        headers: { authorization: validAuth },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect(res.headers['cache-control']).toBe('private, no-store');
    });
  });

  // ---------------------------------------------------------------------------
  // Mutating Actions & Status Transitions (Property 11, Property 14, Property 20)
  // ---------------------------------------------------------------------------
  describe('Property 11: Status Transitions & Actions', () => {
    it('approves a pending Mickey and refuses re-approving an approved Mickey', async () => {
      const id = await createMickey({ status: 'pending' });

      const res = await app.inject({
        method: 'POST',
        url: `/admin/mickeys/${id}/approve`,
        headers: { ...sameOriginHeaders, accept: 'application/json' },
      });
      expect(res.statusCode).toBe(200);

      const hm = await pool.query<{ status: string; reviewed_at: Date }>(
        `SELECT status, reviewed_at FROM hidden_mickeys WHERE id = $1`,
        [id],
      );
      expect(hm.rows[0]!.status).toBe('approved');
      expect(hm.rows[0]!.reviewed_at).toBeDefined();

      // Refuse re-approving
      const reApprove = await app.inject({
        method: 'POST',
        url: `/admin/mickeys/${id}/approve`,
        headers: { ...sameOriginHeaders, accept: 'application/json' },
      });
      expect(reApprove.statusCode).toBe(400);
      expect(reApprove.body).toContain('Cannot transition Hidden Mickey from approved to approved');
    });

    it('rejects a pending Mickey with review note up to 300 characters, refuses if > 300 chars', async () => {
      const id = await createMickey({ status: 'pending' });

      // Over 300 chars fails
      const longNoteRes = await app.inject({
        method: 'POST',
        url: `/admin/mickeys/${id}/reject`,
        headers: sameOriginHeaders,
        payload: { reviewNote: 'x'.repeat(301) },
      });
      expect(longNoteRes.statusCode).toBe(400);

      // Valid reject
      const rejectRes = await app.inject({
        method: 'POST',
        url: `/admin/mickeys/${id}/reject`,
        headers: { ...sameOriginHeaders, accept: 'application/json' },
        payload: { reviewNote: 'Too blurry to distinguish' },
      });
      expect(rejectRes.statusCode).toBe(200);

      const hm = await pool.query<{ status: string; review_note: string }>(
        `SELECT status, review_note FROM hidden_mickeys WHERE id = $1`,
        [id],
      );
      expect(hm.rows[0]!.status).toBe('rejected');
      expect(hm.rows[0]!.review_note).toBe('Too blurry to distinguish');
    });

    it('retires an approved Mickey and marks open reports upheld', async () => {
      const id = await createMickey({ status: 'approved' });
      // Add an open report
      await pool.query(
        `INSERT INTO mickey_reports (user_id, mickey_id, reason, status)
         VALUES ($1, $2, 'not_a_mickey', 'open')`,
        [testUserId, id],
      );

      const res = await app.inject({
        method: 'POST',
        url: `/admin/mickeys/${id}/retire`,
        headers: { ...sameOriginHeaders, accept: 'application/json' },
      });
      expect(res.statusCode).toBe(200);

      const hm = await pool.query<{ status: string }>(
        `SELECT status FROM hidden_mickeys WHERE id = $1`,
        [id],
      );
      expect(hm.rows[0]!.status).toBe('retired');

      const rep = await pool.query<{ status: string }>(
        `SELECT status FROM mickey_reports WHERE mickey_id = $1`,
        [id],
      );
      expect(rep.rows[0]!.status).toBe('upheld');
    });

    it('restores a retired Mickey to approved and marks open reports dismissed', async () => {
      const id = await createMickey({ status: 'retired' });
      await pool.query(
        `INSERT INTO mickey_reports (user_id, mickey_id, reason, status)
         VALUES ($1, $2, 'spam', 'open')`,
        [testUserId, id],
      );

      const res = await app.inject({
        method: 'POST',
        url: `/admin/mickeys/${id}/restore`,
        headers: { ...sameOriginHeaders, accept: 'application/json' },
      });
      expect(res.statusCode).toBe(200);

      const hm = await pool.query<{ status: string }>(
        `SELECT status FROM hidden_mickeys WHERE id = $1`,
        [id],
      );
      expect(hm.rows[0]!.status).toBe('approved');

      const rep = await pool.query<{ status: string }>(
        `SELECT status FROM mickey_reports WHERE mickey_id = $1`,
        [id],
      );
      expect(rep.rows[0]!.status).toBe('dismissed');
    });
  });

  describe('Property 14 & Property 6: Promotion Invariants & Park Total Increase', () => {
    it('promotes approved Community Mickey: sets official=true and promoted_at and changes NO other column', async () => {
      const id = await createMickey({
        status: 'approved',
        official: false,
        clue1: 'Promotable clue 1',
      });

      const before = await pool.query(
        `SELECT * FROM hidden_mickeys WHERE id = $1`,
        [id],
      );
      const bRow = before.rows[0]!;

      // User has found this mickey
      await pool.query(
        `INSERT INTO mickey_progress (user_id, mickey_id, hint_level, found_at, found_on)
         VALUES ($1, $2, 1, now(), '2026-11-06')`,
        [testUserId, id],
      );

      // Before promotion, summary has 0 official found/total for EPCOT
      const summaryBefore = await mickeyRepo.getSummary(testUserId);
      const epcotBefore = summaryBefore.byPark.find((p) => p.park === 'EPCOT');
      expect(epcotBefore?.total ?? 0).toBe(0);
      expect(epcotBefore?.found ?? 0).toBe(0);

      // Operator promotes Mickey
      const res = await app.inject({
        method: 'POST',
        url: `/admin/mickeys/${id}/promote`,
        headers: { ...sameOriginHeaders, accept: 'application/json' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().park).toBe('EPCOT');

      const after = await pool.query(
        `SELECT * FROM hidden_mickeys WHERE id = $1`,
        [id],
      );
      const aRow = after.rows[0]!;

      expect(aRow.official).toBe(true);
      expect(aRow.promoted_at).toBeDefined();

      // Ensure every other content column is untouched (Property 14)
      expect(aRow.experience_id).toBe(bRow.experience_id);
      expect(aRow.zone).toBe(bRow.zone);
      expect(aRow.difficulty).toBe(bRow.difficulty);
      expect(aRow.clue_1).toBe(bRow.clue_1);
      expect(aRow.clue_2).toBe(bRow.clue_2);
      expect(aRow.reveal).toBe(bRow.reveal);
      expect(aRow.submitter_id).toBe(bRow.submitter_id);
      expect(aRow.status).toBe('approved');

      // Now EPCOT official total AND user's found count grow by exactly 1 (Property 6)
      const summaryAfter = await mickeyRepo.getSummary(testUserId);
      const epcotAfter = summaryAfter.byPark.find((p) => p.park === 'EPCOT');
      expect(epcotAfter?.total).toBe(1);
      expect(epcotAfter?.found).toBe(1);
    });

    it('refuses promotion if already official or not approved', async () => {
      const officialId = await createMickey({ status: 'approved', official: true });
      const pendingId = await createMickey({ status: 'pending', official: false });

      const res1 = await app.inject({
        method: 'POST',
        url: `/admin/mickeys/${officialId}/promote`,
        headers: sameOriginHeaders,
      });
      expect(res1.statusCode).toBe(400);

      const res2 = await app.inject({
        method: 'POST',
        url: `/admin/mickeys/${pendingId}/promote`,
        headers: sameOriginHeaders,
      });
      expect(res2.statusCode).toBe(400);
    });
  });

  describe('Property 20: Submitter Ban and Unban', () => {
    it('banning submitter inserts ban and hides approved community entries with reason=operator; unban deletes ban and does not auto-restore', async () => {
      // Submitter has 1 approved community, 1 official, 1 pending
      const commId = await createMickey({
        status: 'approved',
        official: false,
        submitterId: testUserId,
      });
      const offId = await createMickey({
        status: 'approved',
        official: true,
        submitterId: testUserId,
      });
      const penId = await createMickey({
        status: 'pending',
        official: false,
        submitterId: testUserId,
      });

      // Ban user
      const banRes = await app.inject({
        method: 'POST',
        url: `/admin/mickeys/ban`,
        headers: { ...sameOriginHeaders, accept: 'application/json' },
        payload: { userId: testUserId, reason: 'Repeated spam submissions' },
      });
      expect(banRes.statusCode).toBe(200);

      // Verify ban row
      const banRow = await pool.query(
        `SELECT * FROM mickey_submission_bans WHERE user_id = $1`,
        [testUserId],
      );
      expect(banRow.rows).toHaveLength(1);

      // Approved community entry is hidden with reason operator
      const commAfter = await pool.query<{ status: string; hidden_reason: string }>(
        `SELECT status, hidden_reason FROM hidden_mickeys WHERE id = $1`,
        [commId],
      );
      expect(commAfter.rows[0]!.status).toBe('hidden');
      expect(commAfter.rows[0]!.hidden_reason).toBe('operator');

      // Official entry was NOT hidden
      const offAfter = await pool.query<{ status: string }>(
        `SELECT status FROM hidden_mickeys WHERE id = $1`,
        [offId],
      );
      expect(offAfter.rows[0]!.status).toBe('approved');

      // Pending entry remains pending
      const penAfter = await pool.query<{ status: string }>(
        `SELECT status FROM hidden_mickeys WHERE id = $1`,
        [penId],
      );
      expect(penAfter.rows[0]!.status).toBe('pending');

      // Unban user
      const unbanRes = await app.inject({
        method: 'POST',
        url: `/admin/mickeys/unban`,
        headers: { ...sameOriginHeaders, accept: 'application/json' },
        payload: { userId: testUserId },
      });
      expect(unbanRes.statusCode).toBe(200);

      const banRowAfter = await pool.query(
        `SELECT * FROM mickey_submission_bans WHERE user_id = $1`,
        [testUserId],
      );
      expect(banRowAfter.rows).toHaveLength(0);

      // Hidden entry is NOT restored automatically (Requirement 8.6)
      const commStillHidden = await pool.query<{ status: string }>(
        `SELECT status FROM hidden_mickeys WHERE id = $1`,
        [commId],
      );
      expect(commStillHidden.rows[0]!.status).toBe('hidden');
    });
  });

  describe('Property 22: Inactive Experience Groups & Index Page Lists', () => {
    it('lists approved entries whose group is entirely inactive, omits ones whose group has an active alias or canonical, and rendering changes no status', async () => {
      // 1. Entry on inactive canonical experience with inactive alias (whole group inactive)
      const inactiveGrpId = await createMickey({
        experienceId: testInactiveCanonId,
        status: 'approved',
        official: true,
        clue1: 'Inactive group entry',
      });

      // 2. Entry on active canonical with active alias (group active)
      const activeGrpId = await createMickey({
        experienceId: testExpId,
        status: 'approved',
        official: true,
        clue1: 'Active group entry',
      });

      // Render index page
      const res = await app.inject({
        method: 'GET',
        url: '/admin/mickeys',
        headers: { authorization: validAuth },
      });
      expect(res.statusCode).toBe(200);
      const html = res.body;

      // Section 5 contains the inactive group entry
      expect(html).toContain('Inactive group entry');
      expect(html).toContain('Primeval Whirl');

      // Section 5 does NOT contain the active group entry
      expect(html).not.toMatch(/Inactive Experience Group Advisories[\s\S]*Active group entry/);

      // Verify that rendering the page changes NO status anywhere in hidden_mickeys (Property 22)
      const afterRender = await pool.query<{ id: string; status: string }>(
        `SELECT id, status FROM hidden_mickeys WHERE id IN ($1, $2)`,
        [inactiveGrpId, activeGrpId],
      );
      for (const row of afterRender.rows) {
        expect(row.status).toBe('approved');
      }
    });

    it('open-Reports section lists Official entries ahead of Community entries', async () => {
      const commReportedId = await createMickey({
        status: 'approved',
        official: false,
        clue1: 'Community reported Mickey',
      });
      const offReportedId = await createMickey({
        status: 'approved',
        official: true,
        clue1: 'Official reported Mickey',
      });

      // Report both
      await pool.query(
        `INSERT INTO mickey_reports (user_id, mickey_id, reason, status)
         VALUES ($1, $2, 'spam', 'open'), ($1, $3, 'spam', 'open')`,
        [testUserId, commReportedId, offReportedId],
      );

      const res = await app.inject({
        method: 'GET',
        url: '/admin/mickeys',
        headers: { authorization: validAuth },
      });
      expect(res.statusCode).toBe(200);

      const html = res.body;
      const offIdx = html.indexOf('Official reported Mickey');
      const commIdx = html.indexOf('Community reported Mickey');

      expect(offIdx).toBeGreaterThan(-1);
      expect(commIdx).toBeGreaterThan(-1);
      // Official entry appears BEFORE community entry
      expect(offIdx).toBeLessThan(commIdx);
    });

    it('Section 6 lists recently approved community submissions (Requirement 8.10)', async () => {
      await createMickey({
        status: 'approved',
        official: false,
        clue1: 'Recently approved community Mickey',
      });
      await createMickey({
        status: 'approved',
        official: true,
        clue1: 'Official seed Mickey',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/admin/mickeys',
        headers: { authorization: validAuth },
      });
      expect(res.statusCode).toBe(200);

      const html = res.body;
      expect(html).toContain('6. Recently Approved Community Mickeys');
      expect(html).toContain('Recently approved community Mickey');
      // Official entry should NOT be listed in section 6
      expect(html).not.toMatch(/6\. Recently Approved Community Mickeys[\s\S]*Official seed Mickey/);
    });

    describe('GET /admin/mickeys/all (All Hidden Mickeys Directory)', () => {
      it('returns 401 without basic auth', async () => {
        const res = await app.inject({
          method: 'GET',
          url: '/admin/mickeys/all',
        });
        expect(res.statusCode).toBe(401);
      });

      it('renders directory with metric cards and lists all entries', async () => {
        await createMickey({
          status: 'approved',
          official: true,
          clue1: 'Mickey in Carousel of Progress',
        });
        await createMickey({
          status: 'retired',
          official: false,
          clue1: 'Retired Mickey in Great Movie Ride',
        });

        const res = await app.inject({
          method: 'GET',
          url: '/admin/mickeys/all',
          headers: { authorization: validAuth },
        });
        expect(res.statusCode).toBe(200);
        const html = res.body;
        expect(html).toContain('All Hidden Mickeys Directory');
        expect(html).toContain('Total Catalog');
        expect(html).toContain('Mickey in Carousel of Progress');
        expect(html).toContain('Retired Mickey in Great Movie Ride');
        expect(html).toContain('Can Restore');
      });

      it('filters by status=retired to surface retired Mickeys for restoration', async () => {
        await createMickey({
          status: 'approved',
          official: true,
          clue1: 'Active Live Mickey',
        });
        await createMickey({
          status: 'retired',
          official: true,
          clue1: 'Permanently Removed Wall Mickey',
        });

        const res = await app.inject({
          method: 'GET',
          url: '/admin/mickeys/all?status=retired',
          headers: { authorization: validAuth },
        });
        expect(res.statusCode).toBe(200);
        const html = res.body;
        expect(html).toContain('Permanently Removed Wall Mickey');
        expect(html).toContain('Can Restore');
        expect(html).not.toContain('Active Live Mickey');
      });

      it('filters by type=community to surface community entries with Can Promote badge', async () => {
        await createMickey({
          status: 'approved',
          official: false,
          clue1: 'Community Found Mickey on Coaster',
        });
        await createMickey({
          status: 'approved',
          official: true,
          clue1: 'Official Park Mickey on Dark Ride',
        });

        const res = await app.inject({
          method: 'GET',
          url: '/admin/mickeys/all?type=community',
          headers: { authorization: validAuth },
        });
        expect(res.statusCode).toBe(200);
        const html = res.body;
        expect(html).toContain('Community Found Mickey on Coaster');
        expect(html).toContain('Can Promote');
        expect(html).not.toContain('Official Park Mickey on Dark Ride');
      });

      it('searches by query text (q)', async () => {
        await createMickey({
          status: 'approved',
          official: true,
          clue1: 'Look at the gear pattern on the ceiling',
        });
        await createMickey({
          status: 'approved',
          official: true,
          clue1: 'Check the plate arrangement on the dining table',
        });

        const res = await app.inject({
          method: 'GET',
          url: '/admin/mickeys/all?q=gear',
          headers: { authorization: validAuth },
        });
        expect(res.statusCode).toBe(200);
        const html = res.body;
        expect(html).toContain('Look at the gear pattern on the ceiling');
        expect(html).not.toContain('Check the plate arrangement on the dining table');
      });
    });

    it('throws a clear error at registration time when options.pool and options.mickeys are missing', async () => {
      const brokenApp = Fastify();
      const authHook = createBasicAuthHook({ username, password });
      await expect(
        brokenApp.register(async (instance) => {
          await registerMickeyRoutes(instance, {
            repo: adminRepo,
            basicAuth: authHook,
          } as any);
        }),
      ).rejects.toThrow('registerMickeyRoutes requires options.mickeys or options.pool');
    });
  });
});
