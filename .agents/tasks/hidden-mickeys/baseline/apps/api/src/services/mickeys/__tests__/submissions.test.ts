/**
 * Integration & Property 12 tests for Community Submissions (Task 5.2, 5.3).
 *
 * Validates: Requirements 1.4, 6.1 - 6.8, 6.11, 9.1, 16.3, 16.4; Property 12, Property 21
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { DEFAULT_MICKEYS_CONFIG, type MickeysConfig } from '../../../config.js';
import { DefaultMickeyRepo } from '../repo.js';
import { HuntService } from '../service.js';
import { SubmissionService } from '../submissionService.js';
import { mickeyRoutes } from '../routes.js';
import type { TextScreenPort, TextScreenOutcome } from '../adapters/openaiTextScreen.js';
import type { MickeySubmissionBody } from '@dwt/shared';

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

class FakeTextScreen implements TextScreenPort {
  outcome: TextScreenOutcome = { kind: 'ok', flagged: false };
  async screen(_text: string): Promise<TextScreenOutcome> {
    return this.outcome;
  }
}

describe('Community Submissions (Property 12 & Routes)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let repo: DefaultMickeyRepo;
  let fakeTextScreen: FakeTextScreen;
  let submissionService: SubmissionService;
  let huntService: HuntService;

  let testUserId: string;
  let testUser2Id: string;
  let testExpId: string;
  let testExpAliasId: string;
  let testExpInactiveId: string;

  const validSubmission: Omit<MickeySubmissionBody, 'experienceId'> = {
    zone: 'queue',
    difficulty: 'medium',
    clue1: 'Look at the gear pattern on the wall',
    clue2: 'Between the two main entrance doors',
    reveal: 'Three bronze gears form Mickey head and ears',
  };

  beforeEach(async () => {
    db = buildPgMemDatabase();
    applyMigrations(db);
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as DbPool;
    repo = new DefaultMickeyRepo(pool);
    fakeTextScreen = new FakeTextScreen();

    submissionService = new SubmissionService({
      pool,
      config: DEFAULT_MICKEYS_CONFIG,
      textScreen: fakeTextScreen,
    });
    huntService = new HuntService(pool, repo, DEFAULT_MICKEYS_CONFIG);

    testUserId = randomUUID();
    testUser2Id = randomUUID();
    testExpId = randomUUID();
    testExpAliasId = randomUUID();
    testExpInactiveId = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'u1@test.com', 'h'), ($2, 'u2@test.com', 'h')`,
      [testUserId, testUser2Id],
    );
    await pool.query(
      `INSERT INTO profiles (user_id, display_name)
       VALUES ($1, 'User 1'), ($2, 'User 2')`,
      [testUserId, testUser2Id],
    );

    // Canonical experience
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, category, park, land, area_type, active)
       VALUES ($1, 'exp-canon', 'Living with the Land', 'Ride', 'EPCOT', 'The Land', 'ThemePark', true)`,
      [testExpId],
    );
    // Alias experience
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

    // Inactive experience
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, category, park, land, area_type, active)
       VALUES ($1, 'exp-inactive', 'Primeval Whirl', 'Ride', 'Animal Kingdom', 'DinoLand', 'ThemePark', false)`,
      [testExpInactiveId],
    );
  });

  describe('Property 12: Creation invariants', () => {
    it('in publish mode with passing screen: creates approved Community Mickey, Progress row with find, and there vote', async () => {
      const sub = await submissionService.createSubmission(testUserId, {
        experienceId: testExpId,
        ...validSubmission,
      });

      expect(sub.status).toBe('approved');
      expect(sub.official).toBe(false);
      expect(sub.communityVerified).toBe(false);
      expect(sub.experienceName).toBe('Living with the Land');

      // Check hidden_mickeys row
      const hmRes = await pool.query<{ status: string; official: boolean; submitter_id: string }>(
        `SELECT status, official, submitter_id FROM hidden_mickeys WHERE id = $1`,
        [sub.id],
      );
      expect(hmRes.rows[0]).toEqual({
        status: 'approved',
        official: false,
        submitter_id: testUserId,
      });

      // Check mickey_progress row
      const mpRes = await pool.query<{ hint_level: number; found_at: Date; found_on: string }>(
        `SELECT hint_level, found_at, found_on FROM mickey_progress WHERE user_id = $1 AND mickey_id = $2`,
        [testUserId, sub.id],
      );
      expect(mpRes.rows).toHaveLength(1);
      expect(mpRes.rows[0]!.hint_level).toBe(1);
      expect(mpRes.rows[0]!.found_at).toBeDefined();
      expect(mpRes.rows[0]!.found_on).toBeDefined();

      // Check mickey_still_there_votes row
      const voteRes = await pool.query<{ vote: string }>(
        `SELECT vote FROM mickey_still_there_votes WHERE user_id = $1 AND mickey_id = $2`,
        [testUserId, sub.id],
      );
      expect(voteRes.rows).toHaveLength(1);
      expect(voteRes.rows[0]!.vote).toBe('there');

      // Submitter own vote does not make it communityVerified
      const detail = await huntService.getMickeyDetail(sub.id, testUserId);
      expect(detail.communityVerified).toBe(false);
    });

    it('in review mode: creates pending row even with passing screen', async () => {
      const reviewService = new SubmissionService({
        pool,
        config: { ...DEFAULT_MICKEYS_CONFIG, submissionMode: 'review' },
        textScreen: fakeTextScreen,
      });

      const sub = await reviewService.createSubmission(testUserId, {
        experienceId: testExpId,
        ...validSubmission,
      });

      expect(sub.status).toBe('pending');
      const hmRes = await pool.query<{ status: string }>(
        `SELECT status FROM hidden_mickeys WHERE id = $1`,
        [sub.id],
      );
      expect(hmRes.rows[0]!.status).toBe('pending');
    });

    it('with unscreened result (screener timeout/failure): creates pending row with text_screen = unscreened', async () => {
      fakeTextScreen.outcome = { kind: 'retryable', code: 'timeout' };

      const sub = await submissionService.createSubmission(testUserId, {
        experienceId: testExpId,
        ...validSubmission,
      });

      expect(sub.status).toBe('pending');
      const hmRes = await pool.query<{ status: string; text_screen: string }>(
        `SELECT status, text_screen FROM hidden_mickeys WHERE id = $1`,
        [sub.id],
      );
      expect(hmRes.rows[0]!.status).toBe('pending');
      expect(hmRes.rows[0]!.text_screen).toBe('unscreened');
    });

    it('flagged submission throws mickey_text_rejected and leaves no row of any kind', async () => {
      fakeTextScreen.outcome = { kind: 'ok', flagged: true };

      await expect(
        submissionService.createSubmission(testUserId, {
          experienceId: testExpId,
          ...validSubmission,
        }),
      ).rejects.toThrow(expect.objectContaining({ code: 'mickey_text_rejected' }));

      const hmCount = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM hidden_mickeys`);
      const mpCount = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM mickey_progress`);
      const mvCount = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM mickey_still_there_votes`);
      expect(hmCount.rows[0]!.count).toBe(0);
      expect(mpCount.rows[0]!.count).toBe(0);
      expect(mvCount.rows[0]!.count).toBe(0);
    });

    it('URL or email containing submission throws mickey_text_rejected and leaves no row', async () => {
      const inputs = [
        { ...validSubmission, clue1: 'Check out https://disney.com for info' },
        { ...validSubmission, clue2: 'Visit www.example.org/path' },
        { ...validSubmission, reveal: 'Email guide@wdw.com to confirm' },
      ];

      for (const input of inputs) {
        await expect(
          submissionService.createSubmission(testUserId, {
            experienceId: testExpId,
            ...input,
          }),
        ).rejects.toThrow(expect.objectContaining({ code: 'mickey_text_rejected' }));
      }

      const hmCount = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM hidden_mickeys`);
      expect(hmCount.rows[0]!.count).toBe(0);
    });

    it('banned user is refused with mickey_submissions_banned', async () => {
      await pool.query(
        `INSERT INTO mickey_submission_bans (user_id, reason)
         VALUES ($1, 'Spamming fake mickeys')`,
        [testUserId],
      );

      await expect(
        submissionService.createSubmission(testUserId, {
          experienceId: testExpId,
          ...validSubmission,
        }),
      ).rejects.toThrow(expect.objectContaining({ code: 'mickey_submissions_banned' }));
    });

    it('enforces daily cap boundary in trailing 24 hours', async () => {
      const now = new Date('2026-11-06T15:00:00Z');
      const capService = new SubmissionService({
        pool,
        config: { ...DEFAULT_MICKEYS_CONFIG, submissionsPerDay: 2 },
        textScreen: fakeTextScreen,
      });

      // First submission ok
      await capService.createSubmission(testUserId, { experienceId: testExpId, ...validSubmission }, now);
      // Second submission ok
      await capService.createSubmission(testUserId, { experienceId: testExpId, ...validSubmission }, now);

      // Third submission exceeds cap
      await expect(
        capService.createSubmission(testUserId, { experienceId: testExpId, ...validSubmission }, now),
      ).rejects.toThrow(expect.objectContaining({ code: 'mickey_submission_limit' }));

      // Submission 25 hours later succeeds
      const nextDay = new Date(now.getTime() + 25 * 60 * 60 * 1000);
      const nextSub = await capService.createSubmission(
        testUserId,
        { experienceId: testExpId, ...validSubmission },
        nextDay,
      );
      expect(nextSub.id).toBeDefined();
    });

    it('submission naming an alias experience is stored on canonical experience and appears in list for both', async () => {
      const sub = await submissionService.createSubmission(testUserId, {
        experienceId: testExpAliasId,
        ...validSubmission,
      });

      // Verify stored row in hidden_mickeys has experience_id = testExpId
      const hmRes = await pool.query<{ experience_id: string }>(
        `SELECT experience_id FROM hidden_mickeys WHERE id = $1`,
        [sub.id],
      );
      expect(hmRes.rows[0]!.experience_id).toBe(testExpId);

      // Hunt list for alias returns it
      const aliasList = await huntService.listMickeys({ experienceId: testExpAliasId });
      expect(aliasList.items.map((i) => i.id)).toContain(sub.id);

      // Hunt list for canonical returns it
      const canonList = await huntService.listMickeys({ experienceId: testExpId });
      expect(canonList.items.map((i) => i.id)).toContain(sub.id);
    });

    it('submission naming an inactive experience is accepted (Requirement 16.4)', async () => {
      const sub = await submissionService.createSubmission(testUserId, {
        experienceId: testExpInactiveId,
        ...validSubmission,
      });

      expect(sub.status).toBe('approved');
      expect(sub.experienceName).toBe('Primeval Whirl');
    });
  });

  describe('Fastify routes: /me/mickeys/submissions', () => {
    function buildApp(options: {
      callerId?: string | undefined;
      config?: Partial<MickeysConfig> | undefined;
    } = {}): FastifyInstance {
      const app = Fastify();
      registerErrorHandler(app);

      const requireSession: preHandlerHookHandler = async (req) => {
        if (!options.callerId) throw new AppError('unauthorized', 'Auth required');
        req.userId = options.callerId;
      };

      const cfg: MickeysConfig = { ...DEFAULT_MICKEYS_CONFIG, ...(options.config ?? {}) };
      const sService = new SubmissionService({
        pool,
        config: cfg,
        textScreen: fakeTextScreen,
      });

      void app.register(
        mickeyRoutes({
          huntService,
          submissionService: sService,
          requireSession,
          config: cfg,
        }),
      );

      return app;
    }

    it('rejects POST and GET with 401 when unauthenticated', async () => {
      const app = buildApp({ callerId: undefined });
      const postRes = await app.inject({
        method: 'POST',
        url: '/me/mickeys/submissions',
        payload: { experienceId: testExpId, ...validSubmission },
      });
      expect(postRes.statusCode).toBe(401);

      const getRes = await app.inject({
        method: 'GET',
        url: '/me/mickeys/submissions',
      });
      expect(getRes.statusCode).toBe(401);
    });

    it('rejects POST with 503 when feature or submissions disabled', async () => {
      const appDisabled = buildApp({ callerId: testUserId, config: { submissionsEnabled: false } });
      const res = await appDisabled.inject({
        method: 'POST',
        url: '/me/mickeys/submissions',
        payload: { experienceId: testExpId, ...validSubmission },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error?.code).toBe('mickey_feature_disabled');
    });

    it('rejects POST with 400 validation_failed on invalid body', async () => {
      const app = buildApp({ callerId: testUserId });
      const res = await app.inject({
        method: 'POST',
        url: '/me/mickeys/submissions',
        payload: {
          experienceId: testExpId,
          zone: 'invalid_zone',
          difficulty: 'medium',
          clue1: 'Short',
          clue2: 'Between doors',
          reveal: 'Three bronze gears',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error?.code).toBe('validation_failed');
    });

    it('POST returns 201 on success and GET /me/mickeys/submissions lists caller submissions only', async () => {
      const appUser1 = buildApp({ callerId: testUserId });
      const appUser2 = buildApp({ callerId: testUser2Id });

      // User 1 submits
      const postRes = await appUser1.inject({
        method: 'POST',
        url: '/me/mickeys/submissions',
        payload: { experienceId: testExpId, ...validSubmission },
      });
      expect(postRes.statusCode).toBe(201);
      const sub1 = postRes.json();
      expect(sub1.id).toBeDefined();
      expect(sub1.status).toBe('approved');

      // User 2 lists: empty
      const listRes2 = await appUser2.inject({
        method: 'GET',
        url: '/me/mickeys/submissions',
      });
      expect(listRes2.statusCode).toBe(200);
      expect(listRes2.json()).toHaveLength(0);

      // User 1 lists: contains submission
      const listRes1 = await appUser1.inject({
        method: 'GET',
        url: '/me/mickeys/submissions',
      });
      expect(listRes1.statusCode).toBe(200);
      const list = listRes1.json();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(sub1.id);
      expect(list[0].clue1).toBe(validSubmission.clue1);
      expect(list[0].experienceName).toBe('Living with the Land');
    });
  });
});
