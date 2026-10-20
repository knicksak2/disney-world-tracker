/**
 * Source guards and log redaction tests for Photos service.
 *
 * Implements: Task 9.5 (and Task 9.6 guard addition)
 * Validates: Requirements 1.4, 9.7, 10.7, 20.1, 20.5, 20.7, 25.2, 25.3, 25.4, 27.7
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { PHOTO_TARGET_KINDS } from '@dwt/shared';

import { createLogger, loggerOptions } from '../../../logger.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { createPhotosRepo } from '../repo.js';
import { createReportsRepo } from '../reportsRepo.js';
import { photoRoutes } from '../routes.js';
import { foodReadRoutes } from '../foodReadRoutes.js';
import { PhotoService, type PhotoServiceConfig } from '../service.js';
import { FakeClock, FakeObjectStore, FakeTargetAdapter } from './fakes.js';
import type { DbPool } from '../../../db/pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PHOTOS_DIR = resolve(__dirname, '..');
const API_ROOT = resolve(PHOTOS_DIR, '..', '..', '..');
const REPO_ROOT = resolve(API_ROOT, '..', '..');

function collectFiles(dir: string, filter: (path: string) => boolean): string[] {
  const results: string[] = [];
  function walk(current: string) {
    const entries = readdirSync(current);
    for (const entry of entries) {
      const fullPath = join(current, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (filter(fullPath)) {
        results.push(fullPath);
      }
    }
  }
  walk(dir);
  return results;
}

// =========================================================================
// (a) allowlist guard for food_item_logs (Requirement 10.7, Property 14)
// =========================================================================

const FOOD_LOG_ALLOWED_COLUMNS = new Set(['id', 'user_id', 'food_item_id']);

interface GuardResult {
  valid: boolean;
  violations: string[];
}

function checkFoodLogSql(sql: string): GuardResult {
  const violations: string[] = [];

  // Denylist checks
  if (/\bnote\b/i.test(sql)) violations.push('Contains denylisted word: note');
  if (/\buser_tz\b/i.test(sql)) violations.push('Contains denylisted word: user_tz');
  if (/\brating\b/i.test(sql)) violations.push('Contains denylisted word: rating');
  if (/\bvisited_on\b/i.test(sql)) violations.push('Contains denylisted word: visited_on');
  if (/\blogged_at\b/i.test(sql)) violations.push('Contains denylisted word: logged_at');
  if (/\bSELECT\s+\*/i.test(sql)) violations.push('Contains SELECT *');
  if (/\bRETURNING\s+\*/i.test(sql)) violations.push('Contains RETURNING *');

  // Find alias for food_item_logs if present
  // e.g. "FROM food_item_logs l", "JOIN food_item_logs AS fil"
  const aliasMatch = sql.match(/\bfood_item_logs\s+(?:AS\s+)?([a-zA-Z_]\w*)/i);
  const alias = aliasMatch && !['WHERE', 'JOIN', 'ON', 'GROUP', 'ORDER', 'LIMIT', 'SET', 'VALUES'].includes(aliasMatch[1]!.toUpperCase())
    ? aliasMatch[1]!
    : null;

  if (alias) {
    // Check wildcard with alias, e.g. "l.*"
    if (new RegExp(`\\b${alias}\\.\\*`).test(sql)) {
      violations.push(`Contains wildcard on alias ${alias}.*`);
    }

    // Extract all <alias>.<col>
    const colRegex = new RegExp(`\\b${alias}\\.([a-zA-Z_]\\w*)`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = colRegex.exec(sql)) !== null) {
      const col = match[1]!.toLowerCase();
      if (!FOOD_LOG_ALLOWED_COLUMNS.has(col)) {
        violations.push(`Disallowed column reference: ${alias}.${col}`);
      }
    }
  } else {
    // Bare table "FROM food_item_logs" without joins
    if (/\bfood_item_logs\.\*/.test(sql)) {
      violations.push('Contains wildcard on food_item_logs.*');
    }
    // Check if food_item_logs is the sole table queried
    const isSingleTable = !/\bJOIN\b/i.test(sql) && /\bFROM\s+food_item_logs\b/i.test(sql);
    if (isSingleTable) {
      // Find SELECT clause
      const selectMatch = sql.match(/SELECT\s+(.*?)\s+FROM/is);
      if (selectMatch && selectMatch[1]) {
        const selectCols = selectMatch[1].split(',').map((c) => c.trim().toLowerCase());
        for (const rawCol of selectCols) {
          // ignore literal expressions like '1' or 'count(*)'
          if (/^\d+$/.test(rawCol) || /^count\(/i.test(rawCol)) continue;
          const cleanCol = rawCol.replace(/\s+AS\s+.*$/i, '').trim();
          if (!FOOD_LOG_ALLOWED_COLUMNS.has(cleanCol)) {
            violations.push(`Disallowed bare column in single-table query: ${cleanCol}`);
          }
        }
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

describe('Photo Source Guards (Task 9.5)', () => {
  describe('(a) allowlist guard for food_item_logs (Requirement 10.7, Property 14)', () => {
    it('all SQL statements in services/photos referencing food_item_logs strictly obey the allowlist {id, user_id, food_item_id}', () => {
      // Scan all .ts files under services/photos (excluding __tests__)
      const files = collectFiles(
        PHOTOS_DIR,
        (p) => p.endsWith('.ts') && !p.includes('__tests__')
      );

      let statementCount = 0;
      for (const file of files) {
        const content = readFileSync(file, 'utf8');
        // Extract string templates and SQL literals
        const stringLiterals = content.match(/`([^`]+)`/gs) ?? [];
        for (const lit of stringLiterals) {
          if (/\bfood_item_logs\b/i.test(lit)) {
            statementCount++;
            const res = checkFoodLogSql(lit);
            expect(
              res.valid,
              `Violations in ${file}:\n${res.violations.join('\n')}\nSQL:\n${lit}`
            ).toBe(true);
          }
        }
      }

      expect(statementCount).toBeGreaterThan(0);
    });

    it('negative tests verify the food_item_logs guard bites on disallowlisted columns and wildcards', () => {
      // 1. SELECT l.user_tz fails
      const f1 = checkFoodLogSql('SELECT l.user_tz FROM food_item_logs l WHERE l.id = $1');
      expect(f1.valid).toBe(false);
      expect(f1.violations).toContain('Contains denylisted word: user_tz');

      // 2. SELECT l.note fails
      const f2 = checkFoodLogSql('SELECT l.note FROM food_item_logs l WHERE l.id = $1');
      expect(f2.valid).toBe(false);
      expect(f2.violations).toContain('Contains denylisted word: note');

      // 3. SELECT * fails
      const f3 = checkFoodLogSql('SELECT * FROM food_item_logs l WHERE l.id = $1');
      expect(f3.valid).toBe(false);
      expect(f3.violations).toContain('Contains SELECT *');

      // 4. Invented column l.created_by fails
      const f4 = checkFoodLogSql('SELECT l.created_by FROM food_item_logs l WHERE l.id = $1');
      expect(f4.valid).toBe(false);
      expect(f4.violations).toContain('Disallowed column reference: l.created_by');

      // 5. Real orphan check passes
      const f5 = checkFoodLogSql(
        'SELECT p.id, p.target_id FROM photos p WHERE p.target_kind = \'food_log\' AND NOT EXISTS (SELECT 1 FROM food_item_logs l WHERE l.id = p.target_id);'
      );
      expect(f5.valid).toBe(true);
      expect(f5.violations).toHaveLength(0);
    });

    it('Task 9.6: restaurant gallery statements in repo.ts reference fi.name and no other food_items column except join keys', () => {
      const repoPath = resolve(PHOTOS_DIR, 'repo.ts');
      const repoContent = readFileSync(repoPath, 'utf8');

      // Find the gallery queries
      const galleryRegex = /(?:SQL_EXPERIENCE_GALLERY_|SQL_LOCATION_GALLERY_)[A-Z_]+\s*=\s*`([^`]+)`/g;
      const matches = [...repoContent.matchAll(galleryRegex)];
      expect(matches.length).toBeGreaterThanOrEqual(4);

      const ALLOWED_FOOD_ITEM_COLUMNS = new Set(['id', 'name', 'experience_id', 'location_id']);

      for (const m of matches) {
        const sql = m[1]!;
        // Extract all fi.<column>
        const fiCols = [...sql.matchAll(/\bfi\.([a-zA-Z_]\w*)/gi)].map((c) => c[1]!.toLowerCase());
        expect(fiCols.length).toBeGreaterThan(0);
        for (const col of fiCols) {
          expect(
            ALLOWED_FOOD_ITEM_COLUMNS.has(col),
            `Disallowed fi.${col} reference in gallery query:\n${sql}`
          ).toBe(true);
        }
        // Assert fi.name is referenced
        expect(fiCols).toContain('name');
      }
    });
  });

  describe('(b) Provider name guard', () => {
    it('no provider name appears in domain/, ports.ts, service.ts, routes.ts, or foodReadRoutes.ts', () => {
      // Allowlist of files that may name providers
      const ALLOWLIST = new Set([
        resolve(PHOTOS_DIR, 'adapters', 'geminiVisionChecker.ts'),
        resolve(PHOTOS_DIR, 'adapters', 'openaiHarmModerator.ts'),
        resolve(PHOTOS_DIR, 'adapters', 'r2ObjectStore.ts'),
        resolve(API_ROOT, 'src', 'config.ts'),
      ]);

      // Assert allowlist contains nothing else
      expect(ALLOWLIST.size).toBe(4);

      // Word boundary regex patterns
      const providerPatterns = [
        /\bR2\b/,               // case-sensitive R2
        /\bcloudflare\b/i,      // case-insensitive cloudflare
        /\bopenai\b/i,          // case-insensitive openai
        /\bgemini\b/i,          // case-insensitive gemini
        /\bgoogle\b/i,          // case-insensitive google
      ];

      // Collect all non-test ts files under services/photos
      const photosSourceFiles = collectFiles(
        PHOTOS_DIR,
        (p) => p.endsWith('.ts') && !p.includes('__tests__')
      );

      for (const file of photosSourceFiles) {
        if (ALLOWLIST.has(file)) continue;

        const content = readFileSync(file, 'utf8');
        for (const pattern of providerPatterns) {
          const match = content.match(pattern);
          expect(
            match,
            `File ${file} contains provider name matching ${pattern}: "${match?.[0]}"`
          ).toBeNull();
        }
      }
    });
  });

  describe('(c) No process.env read under services/photos', () => {
    it('asserts no process.env read exists anywhere under services/photos', () => {
      const files = collectFiles(
        PHOTOS_DIR,
        (p) => p.endsWith('.ts') && !p.includes('__tests__')
      );

      for (const file of files) {
        const content = readFileSync(file, 'utf8');
        expect(content).not.toContain('process.env');
      }
    });
  });

  describe('(d) Secret-shaped string guard', () => {
    // Build prefix patterns from fragments so this test file does not match itself
    const p1 = ['s', 'k', '-'].join('');
    const openaiRegex = new RegExp(`\\b${p1}[A-Za-z0-9_-]{20,}\\b`);

    const p2 = ['A', 'I', 'z', 'a'].join('');
    const googleRegex = new RegExp(`\\b${p2}[A-Za-z0-9_-]{30,}\\b`);

    const p3 = ['A', 'Q', '.'].join('');
    const pastedKeyRegex = new RegExp(`\\b${p3}[A-Za-z0-9_-]{30,}\\b`);

    it('scans services/photos, .kiro/specs/photo-uploads/, and docs/ for secret prefix shapes', () => {
      const scanDirs = [
        PHOTOS_DIR,
        resolve(REPO_ROOT, '.kiro', 'specs', 'photo-uploads'),
        resolve(REPO_ROOT, 'docs'),
      ];

      for (const dir of scanDirs) {
        const files = collectFiles(dir, (p) => !p.endsWith('.guards.test.ts') && !p.endsWith('.png') && !p.endsWith('.jpg'));
        for (const file of files) {
          const content = readFileSync(file, 'utf8');
          expect(content).not.toMatch(openaiRegex);
          expect(content).not.toMatch(googleRegex);
          expect(content).not.toMatch(pastedKeyRegex);
        }
      }
    });

    it('scans services/photos and its fixtures for 30+ char base64-like runs on lines containing KEY or SECRET', () => {
      const files = collectFiles(PHOTOS_DIR, (p) => !p.endsWith('.guards.test.ts'));
      const base64Heuristic = /^(?!.*(?:test-harm-key|test-vision-key)).*(?:KEY|SECRET).*[A-Za-z0-9+/=]{30,}/i;

      for (const file of files) {
        const lines = readFileSync(file, 'utf8').split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          // Ignore comments indicating regex pattern descriptions or fixture placeholders
          if (line.includes('base64Heuristic') || line.includes('test-secret') || line.includes('test-cron-secret')) continue;
          expect(
            line,
            `Potential secret line in ${file} at line ${i + 1}: ${line}`
          ).not.toMatch(base64Heuristic);
        }
      }
    });

    it('negative tests verify secret patterns detect synthetic secrets', () => {
      const synthOpenai = `${p1}1234567890123456789012345`;
      expect(synthOpenai).toMatch(openaiRegex);

      const synthGoogle = `${p2}12345678901234567890123456789012`;
      expect(synthGoogle).toMatch(googleRegex);

      const synthPasted = `${p3}12345678901234567890123456789012`;
      expect(synthPasted).toMatch(pastedKeyRegex);
    });
  });

  describe('(e) Log redaction (Requirement 9.7)', () => {
    it('captured pino stream contains no X-Amz-Signature, no X-Amz-Credential, no presigned URL query, and no Authorization value', async () => {
      const logChunks: string[] = [];
      const logSink = new Writable({
        write(chunk, _enc, cb) {
          logChunks.push(String(chunk));
          cb();
        },
      });

      const logger = createLogger({ ...loggerOptions, level: 'trace' }, logSink);
      const app = Fastify({ logger });
      registerErrorHandler(app as any);

      const fakePool = {
        query: async () => ({ rows: [] }),
        connect: async () => ({
          query: async () => ({ rows: [] }),
          release: () => {},
        }),
      } as unknown as DbPool;

      const fakeStore = new FakeObjectStore();
      const fakeClock = new FakeClock();
      const fakeAdapter = new FakeTargetAdapter('food_log', 'harm_and_vision', 4);

      const config: PhotoServiceConfig = {
        enabled: true,
        foodEnabled: true,
        tripEnabled: true,
        maxPerFoodLog: 4,
        maxPerTrip: 200,
        maxFeedPostPhotos: 4,
        maxBatch: 10,
        maxBytes: 15_000_000,
        maxThumbBytes: 1_000_000,
        dailyUploadCap: 20,
        globalDailyCap: 2000,
        putUrlTtlSeconds: 900,
        getUrlTtlSeconds: 86400,
        reportAutohideFood: 3,
        reportAutohideTrip: 3,
        experienceStripMax: 8,
        recapHighlightMax: 6,
      };

      const repo = createPhotosRepo(fakePool);
      const reportsRepo = createReportsRepo(fakePool);

      const photoService = new PhotoService({
        pool: fakePool,
        repo,
        reportsRepo,
        objectStore: fakeStore,
        clock: fakeClock,
        config,
        targetAdapters: [fakeAdapter],
      });

      const authSecret = 'Bearer test-secret-token-do-not-log-987654';

      await app.register(photoRoutes, {
        photoService,
        requireSession: async (req) => {
          (req as any).user = { id: randomUUID(), email: 'u@example.com' };
        },
        enabled: true,
      });

      await app.register(foodReadRoutes, {
        photoService,
        requireSession: async (req) => {
          (req as any).user = { id: randomUUID(), email: 'u@example.com' };
        },
      });

      await app.ready();

      // 1. GET /photos/config
      await app.inject({
        method: 'GET',
        url: '/photos/config',
        headers: { authorization: authSecret },
      });

      // 2. GET /me/photos/status?ids=...
      const id1 = randomUUID();
      await app.inject({
        method: 'GET',
        url: `/me/photos/status?ids=${id1}`,
        headers: { authorization: authSecret },
      });

      // 3. GET /food-items/:id/photos
      await app.inject({
        method: 'GET',
        url: `/food-items/${randomUUID()}/photos`,
        headers: { authorization: authSecret },
      });

      // 4. POST /photos/confirm with invalid body
      await app.inject({
        method: 'POST',
        url: '/photos/confirm',
        headers: { authorization: authSecret },
        payload: { items: [] },
      });

      const allLogs = logChunks.join('\n');

      // Assertions per Requirement 9.7
      expect(allLogs).not.toContain('X-Amz-Signature');
      expect(allLogs).not.toContain('X-Amz-Credential');
      expect(allLogs).not.toContain('test-secret-token-do-not-log-987654');
    });
  });

  describe('(f) Non-goals (Requirements 25.2 to 25.4)', () => {
    it('PHOTO_TARGET_KINDS equals exactly [\'food_log\', \'trip\']', () => {
      expect(PHOTO_TARGET_KINDS).toEqual(['food_log', 'trip']);
    });

    it('apps/api/package.json contains no sharp, jimp, canvas, or gm dependency', () => {
      const pkgPath = resolve(API_ROOT, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      const forbidden = ['sharp', 'jimp', 'canvas', 'gm'];
      for (const name of forbidden) {
        expect(allDeps[name], `Forbidden image manipulation dependency: ${name}`).toBeUndefined();
      }
    });

    it('no route path under services/photos or auth service contains delete-account or account/delete', () => {
      const filesToCheck = [
        resolve(PHOTOS_DIR, 'routes.ts'),
        resolve(PHOTOS_DIR, 'foodReadRoutes.ts'),
        resolve(PHOTOS_DIR, 'sweepCronRoute.ts'),
        resolve(API_ROOT, 'src', 'services', 'auth', 'routes.ts'),
      ];

      for (const file of filesToCheck) {
        const content = readFileSync(file, 'utf8');
        expect(content).not.toMatch(/delete-account/i);
        expect(content).not.toMatch(/account\/delete/i);
      }
    });
  });
});
