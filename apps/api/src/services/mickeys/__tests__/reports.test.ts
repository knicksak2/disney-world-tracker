/**
 * Tests for Hidden Mickeys reporting and soft-hide (Task 6.2).
 *
 * Validates:
 *  - Property 13: Report invariants & soft-hide rules
 *    * Submitter cannot report their own submission (403 / forbidden)
 *    * Duplicate report by the same user is idempotent
 *    * Non-counted reports (users without a Find) do not trigger auto-hide
 *    * 3 counted reports (users with a Find) auto-hide a Community entry atomically
 *    * Reports on an Official entry NEVER auto-hide it or change totals
 *    * Reporting an entry hides it from that reporter's hunt list and detail view
 *  - Route invariants (POST /mickeys/:id/report):
 *    * 204 on success
 *    * 400 on invalid reason or note exceeding 300 characters
 *    * 403 on self-report
 *    * 401 unauthenticated
 *    * 404 when mickey not found
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { newDb, type IMemoryDb, DataType } from 'pg-mem';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DbPool } from '../../../db/pool.js';
import { DEFAULT_MICKEYS_CONFIG, type MickeysConfig } from '../../../config.js';
import { ReportService } from '../reportService.js';
import { DefaultMickeyRepo } from '../repo.js';
import { HuntService } from '../service.js';
import { mickeyRoutes } from '../routes.js';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';

const MIGRATIONS_DIR = resolve(__dirname, '../../../../migrations');

function createMemDb(): IMemoryDb {
  const db = newDb();
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
    let sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf-8');
    sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
    sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
    sql = sql.replace(
      /CREATE INDEX IF NOT EXISTS mickey_progress_mickey_idx ON mickey_progress\(mickey_id\) WHERE found_at IS NOT NULL;/g,
      'CREATE INDEX IF NOT EXISTS mickey_progress_mickey_idx ON mickey_progress(mickey_id);',
    );
    db.public.none(sql);
  }
}

describe('Hidden Mickeys Reports & Soft-Hide (Property 13 & Routes)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let reportService: ReportService;
  let repo: DefaultMickeyRepo;
  let huntService: HuntService;
  let config: MickeysConfig;
  let app: FastifyInstance;

  let activeSessionUserId: string | null = null;
  const testSubmitterId = randomUUID();
  const testUser1 = randomUUID();
  const testUser2 = randomUUID();
  const testUser3 = randomUUID();
  const testExpId = randomUUID();

  beforeEach(async () => {
    db = createMemDb();
    applyMigrations(db);
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as DbPool;

    config = {
      ...DEFAULT_MICKEYS_CONFIG,
      enabled: true,
      reportAutohide: 3,
    };

    repo = new DefaultMickeyRepo(pool);
    huntService = new HuntService(pool, repo, config);
    reportService = new ReportService({ pool, config });

    // Seed test users
    for (const uid of [testSubmitterId, testUser1, testUser2, testUser3]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash)
         VALUES ($1, $2, 'hash')`,
        [uid, `${uid}@wdw.test`],
      );
    }

    // Seed test experience
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, category, park, land, area_type, active)
       VALUES ($1, 'exp-spaceship-earth', 'Spaceship Earth', 'Ride', 'EPCOT', 'World Celebration', 'ThemePark', true)`,
      [testExpId],
    );

    // Build Fastify test app
    app = Fastify();
    registerErrorHandler(app);
    await app.register(
      mickeyRoutes({
        huntService,
        reportService,
        config,
        requireSession: async (req) => {
          if (!activeSessionUserId) {
            throw new AppError('unauthorized', 'Session required.');
          }
          req.userId = activeSessionUserId;
        },
      }),
    );
    await app.ready();
  });

  afterEach(async () => {
    activeSessionUserId = null;
    await app.close();
  });

  async function createTestMickey(options: {
    official: boolean;
    submitterId?: string;
    status?: string;
  }): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO hidden_mickeys (
         id, experience_id, zone, difficulty,
         clue_1, clue_2, reveal, official, source, status, submitter_id
       ) VALUES (
         $1, $2, 'queue', 'easy',
         'Look near the entrance sign', 'Beside the blue panel', 'Three circles in the tile',
         $3, $4, $5, $6
       )`,
      [
        id,
        testExpId,
        options.official,
        options.official ? 'seed' : 'user',
        options.status ?? 'approved',
        options.submitterId ?? (options.official ? null : testSubmitterId),
      ],
    );
    return id;
  }

  describe('Property 13: Report Invariants & Auto-Hide', () => {
    it('refuses report by the submitter on their own submission (Requirement 7.6)', async () => {
      const mickeyId = await createTestMickey({
        official: false,
        submitterId: testSubmitterId,
      });

      await expect(
        reportService.reportMickey(testSubmitterId, mickeyId, {
          reason: 'inappropriate',
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          code: 'mickey_report_forbidden',
        }),
      );

      const rRes = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM mickey_reports WHERE mickey_id = $1`,
        [mickeyId],
      );
      expect(rRes.rows[0]!.count).toBe(0);
    });

    it('duplicate report by the same user is idempotent (Requirement 7.7)', async () => {
      const mickeyId = await createTestMickey({ official: false });

      await reportService.reportMickey(testUser1, mickeyId, {
        reason: 'spam',
        note: 'First note',
      });
      // Second identical report from testUser1
      await reportService.reportMickey(testUser1, mickeyId, {
        reason: 'spam',
        note: 'Second note',
      });

      const rRes = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM mickey_reports WHERE mickey_id = $1`,
        [mickeyId],
      );
      expect(rRes.rows[0]!.count).toBe(1);
    });

    it('non-counted reports (users without a Find) do not trigger auto-hide even with 3+ reports (Requirement 7.3, 7.4)', async () => {
      const mickeyId = await createTestMickey({ official: false });

      // 3 users without finds submit reports
      await reportService.reportMickey(testUser1, mickeyId, { reason: 'not_a_mickey' });
      await reportService.reportMickey(testUser2, mickeyId, { reason: 'not_a_mickey' });
      await reportService.reportMickey(testUser3, mickeyId, { reason: 'not_a_mickey' });

      const hm = await pool.query<{ status: string; hidden_reason: string | null }>(
        `SELECT status, hidden_reason FROM hidden_mickeys WHERE id = $1`,
        [mickeyId],
      );
      expect(hm.rows[0]!.status).toBe('approved');
      expect(hm.rows[0]!.hidden_reason).toBeNull();
    });

    it('three counted reports (users with a Find) auto-hide a Community entry atomically (Requirement 7.4)', async () => {
      const mickeyId = await createTestMickey({ official: false });

      // Give testUser1 and testUser2 finds
      await huntService.recordFind(testUser1, mickeyId);
      await huntService.recordFind(testUser2, mickeyId);
      await huntService.recordFind(testUser3, mickeyId);

      // Report 1
      await reportService.reportMickey(testUser1, mickeyId, { reason: 'not_a_mickey' });
      let hm = await pool.query<{ status: string; hidden_reason: string | null }>(
        `SELECT status, hidden_reason FROM hidden_mickeys WHERE id = $1`,
        [mickeyId],
      );
      expect(hm.rows[0]!.status).toBe('approved');

      // Report 2
      await reportService.reportMickey(testUser2, mickeyId, { reason: 'spam' });
      hm = await pool.query<{ status: string; hidden_reason: string | null }>(
        `SELECT status, hidden_reason FROM hidden_mickeys WHERE id = $1`,
        [mickeyId],
      );
      expect(hm.rows[0]!.status).toBe('approved');

      // Report 3 (hits threshold of 3)
      await reportService.reportMickey(testUser3, mickeyId, { reason: 'inappropriate' });
      hm = await pool.query<{ status: string; hidden_reason: string | null }>(
        `SELECT status, hidden_reason FROM hidden_mickeys WHERE id = $1`,
        [mickeyId],
      );
      expect(hm.rows[0]!.status).toBe('hidden');
      expect(hm.rows[0]!.hidden_reason).toBe('reports');
    });

    it('reports on an Official entry NEVER auto-hide it from other users or change totals (Requirement 7.4)', async () => {
      const officialId = await createTestMickey({ official: true });

      // Give all 3 users finds
      await huntService.recordFind(testUser1, officialId);
      await huntService.recordFind(testUser2, officialId);
      await huntService.recordFind(testUser3, officialId);

      // All 3 report the Official Mickey
      await reportService.reportMickey(testUser1, officialId, { reason: 'not_a_mickey' });
      await reportService.reportMickey(testUser2, officialId, { reason: 'not_a_mickey' });
      await reportService.reportMickey(testUser3, officialId, { reason: 'not_a_mickey' });

      // The Mickey remains approved in the database
      const hm = await pool.query<{ status: string; hidden_reason: string | null }>(
        `SELECT status, hidden_reason FROM hidden_mickeys WHERE id = $1`,
        [officialId],
      );
      expect(hm.rows[0]!.status).toBe('approved');
      expect(hm.rows[0]!.hidden_reason).toBeNull();

      // Check that another user (e.g. testSubmitterId who didn't report it) still sees it in hunt list
      const list = await repo.findApprovedMickeys({ userId: testSubmitterId, park: 'EPCOT' });
      expect(list.items.some((i) => i.id === officialId)).toBe(true);

      // Check park summary total still counts it
      const summary = await repo.getSummary(testSubmitterId);
      const epcot = summary.byPark.find((p) => p.park === 'EPCOT');
      expect(epcot?.total).toBe(1);
    });

    it('reporting an entry immediately hides it from the reporter in list and detail view (Requirement 7.1)', async () => {
      const mickeyId = await createTestMickey({ official: true });

      // Before report, testUser1 sees it in list and detail
      const beforeList = await repo.findApprovedMickeys({ userId: testUser1, park: 'EPCOT' });
      expect(beforeList.items.some((i) => i.id === mickeyId)).toBe(true);

      const beforeDetail = await repo.getMickeyDetail(mickeyId, testUser1);
      expect(beforeDetail).not.toBeNull();

      // testUser1 reports the entry
      await reportService.reportMickey(testUser1, mickeyId, { reason: 'spam' });

      // After report, it is hidden from testUser1's hunt list
      const afterList = await repo.findApprovedMickeys({ userId: testUser1, park: 'EPCOT' });
      expect(afterList.items.some((i) => i.id === mickeyId)).toBe(false);

      // And hidden from testUser1's detail view
      const afterDetail = await repo.getMickeyDetail(mickeyId, testUser1);
      expect(afterDetail).toBeNull();

      // But another user (testUser2) STILL sees it in list and detail!
      const user2List = await repo.findApprovedMickeys({ userId: testUser2, park: 'EPCOT' });
      expect(user2List.items.some((i) => i.id === mickeyId)).toBe(true);
      const user2Detail = await repo.getMickeyDetail(mickeyId, testUser2);
      expect(user2Detail).not.toBeNull();
    });
  });

  describe('Route Invariants: POST /mickeys/:id/report', () => {
    it('returns 401 unauthenticated when no session', async () => {
      activeSessionUserId = null;
      const res = await app.inject({
        method: 'POST',
        url: `/mickeys/${randomUUID()}/report`,
        payload: { reason: 'spam' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 validation_failed on invalid reason', async () => {
      activeSessionUserId = testUser1;
      const res = await app.inject({
        method: 'POST',
        url: `/mickeys/${randomUUID()}/report`,
        payload: { reason: 'made_up_reason' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error?.code).toBe('validation_failed');
    });

    it('returns 400 validation_failed on note longer than 300 characters', async () => {
      activeSessionUserId = testUser1;
      const res = await app.inject({
        method: 'POST',
        url: `/mickeys/${randomUUID()}/report`,
        payload: {
          reason: 'spam',
          note: 'a'.repeat(301),
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error?.code).toBe('validation_failed');
    });

    it('returns 404 when mickeyId does not exist', async () => {
      activeSessionUserId = testUser1;
      const res = await app.inject({
        method: 'POST',
        url: `/mickeys/${randomUUID()}/report`,
        payload: { reason: 'spam' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error?.code).toBe('mickey_not_found');
    });

    it('returns 403 when submitter attempts to report own submission', async () => {
      const mickeyId = await createTestMickey({
        official: false,
        submitterId: testSubmitterId,
      });
      activeSessionUserId = testSubmitterId;

      const res = await app.inject({
        method: 'POST',
        url: `/mickeys/${mickeyId}/report`,
        payload: { reason: 'inappropriate' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error?.code).toBe('mickey_report_forbidden');
    });

    it('returns 204 on successful report', async () => {
      const mickeyId = await createTestMickey({ official: false });
      activeSessionUserId = testUser1;

      const res = await app.inject({
        method: 'POST',
        url: `/mickeys/${mickeyId}/report`,
        payload: {
          reason: 'restricted_area',
          note: 'Behind a cast member only door',
        },
      });
      expect(res.statusCode).toBe(204);

      const rRes = await pool.query<{ reason: string; note: string }>(
        `SELECT reason, note FROM mickey_reports WHERE user_id = $1 AND mickey_id = $2`,
        [testUser1, mickeyId],
      );
      expect(rRes.rows.length).toBe(1);
      expect(rRes.rows[0]!.reason).toBe('restricted_area');
      expect(rRes.rows[0]!.note).toBe('Behind a cast member only door');
    });
  });
});
