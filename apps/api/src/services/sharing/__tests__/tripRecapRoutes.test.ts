/**
 * Tests for recipient trip recap read route and projection.
 *
 * Implements: Task 21.3, Task 22.7
 * Validates: Requirements 12.10, 15.3, 15.4, 15.5, 15.7, 15.12, 15.14, 15.15, 15.16, 15.17, 15.20, 15.21, 15.22, 16.8, 17.1,
 *            Property 21, Property 40, Property 42, Property 43, decisions D21, D25, D26, D27, D28, D32, D33, D34
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { registerErrorHandler } from '../../../errors/index.js';
import type { TripRole } from '../../trips/permissions.js';
import type {
  TripRecapDTO,
  TripSummaryDTO,
  TripSummarySharePayload,
} from '@dwt/shared';
import type { RecapPhotoPort, TripShareFacts } from '../ports.js';
import { PARKS } from '@dwt/shared';
import { deriveTripSummary } from '../../trips/summary.js';
import { DefaultRecapShareGate } from '../tripRecapGate.js';
import { projectRecapFigures } from '../tripRecapProjection.js';
import { registerTripRecapRoutes } from '../tripRecapRoutes.js';
import { DefaultRecapPhotoPort } from '../../photos/recapPhotoPort.js';
import type { AppConfig } from '../../../config.js';
import { PhotoService } from '../../photos/service.js';
import { photoRoutes } from '../../photos/routes.js';
import { createPhotosRepo } from '../../photos/repo.js';
import { createReportsRepo } from '../../photos/reportsRepo.js';
import { TripTarget } from '../../photos/targets/tripTarget.js';
import { FakeObjectStore } from '../../photos/__tests__/fakes.js';
import { photoKeys } from '../../photos/domain/objectKeys.js';
import { pair as canonicalPair } from '../../friends/canonicalPair.js';
import { buildServer } from '../../../server.js';

function makeTestConfig(enabled: boolean): AppConfig {
  return {
    env: 'test',
    server: { host: '127.0.0.1', port: 0, logLevel: 'silent' },
    database: { url: 'postgres://test/dwt' },
    redis: { url: 'redis://test:6379' },
    session: { secret: 'test-session-secret-must-be-at-least-32-chars' },
    intelligence: { samplingCronSecret: 'test-sampling-secret', crowdSeedDir: 'seed-data/crowd/' },
    pins: { reconcileCronSecret: 'test-pin-reconcile-secret' },
    accountDeletion: {
      graceDays: 30,
      cronSecret: 'test-account-deletion-cron-secret-12345',
      purgeBatch: 10,
      purgeTimeBudgetMs: 25000,
      reauthWindowSeconds: 300,
      chunkRows: 500,
    },
    support: { email: 'support@example.com' },
    themeparks: { baseUrl: 'https://themeparks.invalid/v1' },
    disney: {
      syncGateway: { baseUrl: 'https://disney.invalid' },
      diningMenuBaseUrl: 'https://disney.invalid/menu',
      menuFreshnessMs: 86400000,
      syncIntervalMs: 86400000,
      credentials: { username: 'u', password: 'p' },
      requestBudget: { maxRequestsPerSecond: 5, maxConcurrency: 4 },
      backoff: {
        baseDelayMs: 500,
        factor: 2,
        maxRetries: 5,
        maxDelayMs: 5000,
        maxTotalDelayMs: 30000,
      },
    },
    tripBooking: {
      cronSecret: 'test-trip-booking-cron-secret-12345',
      reminder: {
        leads: ['eve', 'open'],
        catchupMinutes: 180,
        minPassIntervalSeconds: 300,
        sendStartMinutes: 360,
        sendEndMinutes: 1380,
        retentionDays: 30,
      },
    },
    admin: {
      username: 'admin',
      password: 'password',
    },
    photos: {
      enabled,
      foodEnabled: true,
      tripEnabled: true,
      cronSecret: 'test-photos-cron-secret',
      recapHighlightMax: 6,
      experienceStripMax: 8,
      store: {
        endpoint: 'https://test.r2.cloudflarestorage.com',
        bucket: 'test-bucket',
        accessKeyId: 'test-access-key',
        secretAccessKey: 'test-secret-key',
        region: 'auto',
      },
      harm: {
        apiKey: 'test-harm-key',
        baseUrl: 'https://api.openai.com',
        model: 'omni-moderation-latest',
        timeoutMs: 15000,
        invalidImageCodes: [],
        badRequestAlertCount: 5,
        scoreThreshold: 0.5,
        checkThumb: true,
      },
      vision: {
        apiKey: 'test-vision-key',
        baseUrl: 'https://generativelanguage.googleapis.com',
        model: 'gemini-3.5-flash-lite',
        fallbackModel: 'gemini-3.1-flash-lite',
        timeoutMs: 20000,
        minFoodConfidence: 0.6,
        maxProminentFaces: 0,
        maxTextFraction: 0.25,
      },
      limits: {
        dailyUploadCap: 20,
        globalDailyCap: 2000,
        maxPerFoodLog: 4,
        maxPerTrip: 300,
        maxFeedPostPhotos: 4,
        maxBatch: 10,
        maxBytes: 1048576,
        maxThumbBytes: 65536,
      },
      urls: {
        putTtlSeconds: 900,
        getTtlSeconds: 3600,
        adminTtlSeconds: 300,
      },
      moderation: {
        uploadExpiryMinutes: 120,
        maxAttempts: 6,
        leaseSeconds: 180,
        needsReviewMaxAgeHours: 120,
        uploadPrefixExpiryDays: 7,
        concurrency: 3,
        rejectedRetentionHours: 24,
      },
      reports: {
        autohideFood: 3,
        autohideTrip: 1,
      },
      sweep: {
        batch: 200,
        timeBudgetMs: 25000,
        visionFieldsRetentionDays: 30,
      },
      exif: {
        policy: 'log',
        scanBytes: 65536,
      },
    },
  };
}

function buildPgMemDatabase(): IMemoryDb {
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
    name: 'length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  pub.registerFunction({
    name: 'hashtext',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: () => 1,
  });
  pub.registerFunction({
    name: 'pg_advisory_xact_lock',
    args: [DataType.integer],
    returns: DataType.bool,
    implementation: () => true,
    impure: true,
  });

  return db;
}

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

// ===========================================================================
// Unit & Property Tests: projectRecapFigures (Property 40)
// ===========================================================================

describe('projectRecapFigures', () => {
  // Feature: photo-uploads, Property 40: Recap figures projection is an allowlist
  it('Property 40: projectRecapFigures returns allowlist keys, drops memberId, drops perMember, caps topRated at 3', () => {
    fc.assert(
      fc.property(
        fc.record({
          distinctExperienceCount: fc.integer({ min: 0, max: 100 }),
          plannedCompletedCount: fc.integer({ min: 0, max: 100 }),
          plannedTotalCount: fc.integer({ min: 0, max: 100 }),
          superlatives: fc.array(
            fc.record({
              id: fc.uuid(),
              title: fc.string({ minLength: 1 }),
              description: fc.string(),
              icon: fc.string(),
              memberId: fc.option(fc.uuid(), { nil: undefined }),
              memberDisplayName: fc.option(fc.string(), { nil: undefined }),
              experienceName: fc.option(fc.string(), { nil: undefined }),
              value: fc.option(fc.oneof(fc.integer(), fc.string()), { nil: undefined }),
            }),
            { maxLength: 10 }
          ),
          topRated: fc.array(
            fc.record({
              experienceId: fc.uuid(),
              experienceName: fc.string({ minLength: 1 }),
              meanRating: fc.float({ min: 1, max: 10 }),
              ratingCount: fc.integer({ min: 1, max: 50 }),
              park: fc.constant('Magic Kingdom' as const),
              category: fc.constant('attraction'),
              imageUrl: fc.constant('https://example.com/img.jpg'),
            }),
            { maxLength: 10 }
          ),
          perMember: fc.array(
            fc.record({
              memberId: fc.uuid(),
              displayName: fc.string(),
              logEntryCount: fc.integer({ min: 0, max: 50 }),
              confirmedTagCount: fc.integer({ min: 0, max: 50 }),
            }),
            { maxLength: 5 }
          ),
        }),
        (summary: TripSummaryDTO) => {
          const res = projectRecapFigures(summary);

          // Allowed keys exactly:
          // (extended by Requirement 15.21 / decision D34: see Property 43 below)
          const allowedKeys = [
            'distinctExperienceCount',
            'parksExploredCount',
            'plannedCompletedCount',
            'plannedTotalCount',
            'superlatives',
            'topRated',
            'totalCompletionsCount',
            'totalRatingsCount',
          ].sort();
          expect(Object.keys(res).sort()).toEqual(allowedKeys);

          // Numeric fields equal input:
          expect(res.distinctExperienceCount).toBe(summary.distinctExperienceCount);
          expect(res.plannedCompletedCount).toBe(summary.plannedCompletedCount);
          expect(res.plannedTotalCount).toBe(summary.plannedTotalCount);

          // Superlatives have no memberId:
          for (const s of res.superlatives) {
            expect('memberId' in s).toBe(false);
            expect(Object.keys(s).every((k) =>
              ['id', 'title', 'description', 'icon', 'experienceName', 'value', 'memberDisplayName'].includes(k)
            )).toBe(true);
          }

          // Top rated has at most 3 items; each row carries the three figures plus the
          // catalog-only fields (the generator always supplies them), never experienceId:
          expect(res.topRated.length).toBeLessThanOrEqual(3);
          for (const t of res.topRated) {
            expect(Object.keys(t).sort()).toEqual(
              ['category', 'experienceName', 'imageUrl', 'meanRating', 'park', 'ratingCount'],
            );
          }

          // Serialized output contains no memberId or perMember:
          const serialized = JSON.stringify(res);
          expect(serialized).not.toContain('"perMember"');
          expect(serialized).not.toContain('"memberId"');
          expect(serialized).not.toContain('"experienceId"');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('drops extra keys and preserves memberDisplayName only through superlatives', () => {
    const input: TripSummaryDTO & { secretAdminKey: string } = {
      distinctExperienceCount: 12,
      plannedCompletedCount: 5,
      plannedTotalCount: 8,
      secretAdminKey: 'secret_sentinel_token',
      perMember: [
        {
          memberId: 'member-user-123',
          displayName: 'Bob The Member',
          logEntryCount: 10,
          confirmedTagCount: 2,
        },
      ],
      superlatives: [
        {
          id: 'sup-1',
          title: 'Top Rider',
          description: 'Rode the most attractions',
          icon: 'coaster',
          memberId: 'member-user-123',
          memberDisplayName: 'Bob The Member',
          experienceName: 'Space Mountain',
          value: 7,
        },
      ],
      topRated: [
        {
          experienceId: 'exp-1',
          experienceName: 'Space Mountain',
          meanRating: 9.5,
          ratingCount: 4,
          imageUrl: 'https://example.com/space.jpg',
        },
      ],
    };

    const res = projectRecapFigures(input);
    const serialized = JSON.stringify(res);

    expect(serialized).not.toContain('secret_sentinel_token');
    expect(serialized).not.toContain('member-user-123');
    expect(serialized).not.toContain('"perMember"');
    expect(serialized).not.toContain('exp-1');

    // Bob The Member appears only in memberDisplayName of the superlative
    expect(res.superlatives[0]?.memberDisplayName).toBe('Bob The Member');
    expect((res.superlatives[0] as any).memberId).toBeUndefined();
  });
});

// ===========================================================================
// Property 43: Recap aggregate-only boundary (decision D34, R15.21, R15.22)
// ===========================================================================

describe('projectRecapFigures aggregate-only boundary', () => {
  const FIGURE_KEYS = [
    'distinctExperienceCount',
    'parksExploredCount',
    'plannedCompletedCount',
    'plannedTotalCount',
    'superlatives',
    'topRated',
    'totalCompletionsCount',
    'totalRatingsCount',
  ];
  const ROW_KEYS = ['category', 'experienceName', 'imageUrl', 'meanRating', 'park', 'ratingCount'];
  const REQUIRED_ROW_KEYS = ['experienceName', 'meanRating', 'ratingCount'];

  const sentinel = (label: string): fc.Arbitrary<string> =>
    fc.string({ maxLength: 12 }).map((s) => `SENTINEL_${label}_${s}`);

  const perMemberArb: fc.Arbitrary<TripSummaryDTO['perMember']> = fc.array(
    fc.record({
      memberId: sentinel('MEMBER'),
      displayName: sentinel('NAME'),
      avatarPreset: fc.option(sentinel('AVATAR'), { nil: null }),
      logEntryCount: fc.integer({ min: 0, max: 5000 }),
      confirmedTagCount: fc.integer({ min: 0, max: 5000 }),
      totalCompletedCount: fc.option(fc.integer({ min: 0, max: 5000 }), { nil: undefined }),
      topRatedExperienceName: fc.option(sentinel('TOPEXP'), { nil: null }),
      topRating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
    }),
    { maxLength: 6 },
  );

  const summaryArb: fc.Arbitrary<TripSummaryDTO> = fc.record({
    distinctExperienceCount: fc.integer({ min: 0, max: 200 }),
    plannedCompletedCount: fc.integer({ min: 0, max: 200 }),
    plannedTotalCount: fc.integer({ min: 0, max: 200 }),
    totalCompletionsCount: fc.option(fc.integer({ min: 0, max: 5000 }), { nil: undefined }),
    totalRatingsCount: fc.option(fc.integer({ min: 0, max: 5000 }), { nil: undefined }),
    parkBreakdown: fc.option(
      fc.array(
        fc.record({ park: fc.constantFrom(...PARKS), count: fc.integer({ min: 1, max: 100 }) }),
        { maxLength: 10 },
      ),
      { nil: undefined },
    ),
    topRated: fc.array(
      fc.record({
        experienceId: sentinel('EXPID'),
        experienceName: fc.string({ minLength: 1, maxLength: 20 }),
        meanRating: fc.double({ min: 1, max: 10, noNaN: true }),
        ratingCount: fc.integer({ min: 1, max: 50 }),
        park: fc.option(fc.constantFrom(...PARKS), { nil: undefined }),
        category: fc.option(fc.constantFrom('Ride', 'Show', 'Dining'), { nil: undefined }),
        imageUrl: fc.option(fc.webUrl(), { nil: undefined }),
      }),
      { maxLength: 8 },
    ),
    perMember: perMemberArb,
    superlatives: fc.option(
      fc.array(
        fc.record({
          id: fc.uuid(),
          title: fc.string({ minLength: 1, maxLength: 20 }),
          description: fc.string({ maxLength: 40 }),
          icon: fc.constantFrom('trophy', 'compass', 'people', 'star', 'sparkles', 'map'),
          memberId: fc.option(sentinel('SUPMEMBER'), { nil: undefined }),
          memberDisplayName: fc.option(fc.string({ maxLength: 12 }), { nil: undefined }),
          experienceName: fc.option(fc.string({ maxLength: 12 }), { nil: undefined }),
          value: fc.option(fc.oneof(fc.integer(), fc.string({ maxLength: 8 })), { nil: undefined }),
        }),
        { maxLength: 6 },
      ),
      { nil: undefined },
    ),
  });

  // Feature: photo-uploads, Property 43: Recap aggregate-only boundary
  it('Property 43: key set is always the D34 allowlist and nothing member-derived is emitted', () => {
    fc.assert(
      fc.property(summaryArb, perMemberArb, (base, otherPerMember) => {
        // Unknown extra keys on the summary must never reach the recap (explicit allowlist).
        const summary: TripSummaryDTO = Object.assign({}, base, {
          SENTINEL_EXTRA_KEY: 'SENTINEL_EXTRA_VALUE',
        });
        const before = structuredClone(summary);

        const res = projectRecapFigures(summary);

        expect(Object.keys(res).sort()).toEqual(FIGURE_KEYS);
        expect(res.topRated.length).toBeLessThanOrEqual(3);
        expect(res.topRated.length).toBe(Math.min(3, summary.topRated.length));

        res.topRated.forEach((row, index) => {
          const source = summary.topRated[index];
          const keys = Object.keys(row);
          for (const required of REQUIRED_ROW_KEYS) expect(keys).toContain(required);
          for (const key of keys) expect(ROW_KEYS).toContain(key);
          // Catalog keys are present exactly when the source has a value.
          expect(keys.includes('park')).toBe(source?.park !== undefined && source?.park !== null);
          expect(keys.includes('category')).toBe(source?.category !== undefined && source?.category !== null);
          expect(keys.includes('imageUrl')).toBe(source?.imageUrl !== undefined && source?.imageUrl !== null);
        });

        const serialized = JSON.stringify(res);
        expect(serialized).not.toContain('SENTINEL_');
        for (const key of ['experienceId', 'memberId', 'perMember', 'actor_id', 'avatarPreset', 'logEntryCount', 'confirmedTagCount', 'topRating']) {
          expect(serialized).not.toContain(`"${key}"`);
        }

        // Aggregates equal the summary's (or an explicit 0), and parks are distinct parks.
        expect(res.totalCompletionsCount).toBe(summary.totalCompletionsCount ?? 0);
        expect(res.totalRatingsCount).toBe(summary.totalRatingsCount ?? 0);
        expect(res.parksExploredCount).toBe(new Set((summary.parkBreakdown ?? []).map((p) => p.park)).size);

        // Metamorphic: the projection ignores perMember entirely.
        expect(projectRecapFigures({ ...summary, perMember: otherPerMember })).toEqual(res);

        // Pure: the input is not mutated.
        expect(summary).toEqual(before);
      }),
      { numRuns: 150 },
    );
  });
});

function adaptPgMemSql(
  text: string,
  params?: ReadonlyArray<unknown>
): [string, ReadonlyArray<unknown> | undefined] {
  if (params === undefined) return [text, params];

  let adaptedText = text;
  const newParams = [...params];

  if (/=\s*ANY\(\$\d+\)/i.test(adaptedText)) {
    adaptedText = adaptedText.replace(/=\s*ANY\(\$(\d+)\)/gi, (match, num: string) => {
      const arr = params[Number(num) - 1];
      if (!Array.isArray(arr)) return match;
      if (arr.length === 0) return '= NULL';
      const placeholders = arr.map((value) => {
        newParams.push(value);
        return `$${newParams.length}`;
      });
      return `IN (${placeholders.join(', ')})`;
    });
  }

  if (/NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+user_blocks\s+b\s+WHERE/i.test(adaptedText)) {
    adaptedText = adaptedText.replace(
      /AND\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+user_blocks\s+b\s+WHERE\s*\(\s*b\.blocker_id\s*=\s*\$(\d+)\s+AND\s+b\.blocked_id\s*=\s*p\.owner_id\s*\)\s*OR\s*\(\s*b\.blocker_id\s*=\s*p\.owner_id\s+AND\s+b\.blocked_id\s*=\s*\$\1\s*\)\s*\)/gi,
      (_match, viewerParam: string) => {
        return `AND (p.owner_id IS NULL OR (p.owner_id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = $${viewerParam}) AND p.owner_id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_id = $${viewerParam})))`;
      }
    );
  }

  return [adaptedText, newParams];
}

function withPgMemCompat(base: DbPool): DbPool {
  const raw = base as unknown as {
    query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
    connect(): Promise<{
      query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
      release(): void;
    }>;
  };
  return {
    query(text: string, params?: ReadonlyArray<unknown>) {
      const [t, p] = adaptPgMemSql(text, params);
      return raw.query(t, p);
    },
    async connect() {
      const client = await raw.connect();
      return {
        query(text: string, params?: ReadonlyArray<unknown>) {
          const [t, p] = adaptPgMemSql(text, params);
          return client.query(t, p);
        },
        release() {
          client.release();
        },
      } as any;
    },
  } as unknown as DbPool;
}

// ===========================================================================
// Route Integration Tests (Property 21, Property 42, etc.)
// ===========================================================================

describe('GET /me/inbox/:shareId/trip-recap route', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let senderId: string;
  let recipient1Id: string;
  let recipient2Id: string;
  let strangerId: string;
  let tripId: string;
  let shareId: string;

  beforeEach(() => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = withPgMemCompat(new PgMemPool() as unknown as DbPool);

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0002_experience_images.sql');
    applyMigration(db, '0013_avatar_presets.sql');
    applyMigration(db, '0015_trips.sql');
    applyMigration(db, '0040_food_item_logging.sql');
    applyMigration(db, '0062_photo_uploads.sql');
    applyMigration(db, '0063_trip_photos.sql');
  // The friend gate and the inbox read the 0064 visibility views.
  applyMigration(db, '0064_account_deletion.sql');

    senderId = randomUUID();
    recipient1Id = randomUUID();
    recipient2Id = randomUUID();
    strangerId = randomUUID();
    tripId = randomUUID();
    shareId = randomUUID();

    // Insert users and profiles
    db.public.none(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${senderId}', 'sender@example.com', 'h1'),
             ('${recipient1Id}', 'rec1@example.com', 'h2'),
             ('${recipient2Id}', 'rec2@example.com', 'h3'),
             ('${strangerId}', 'stranger@example.com', 'h4');

      INSERT INTO profiles (user_id, display_name, avatar_preset)
      VALUES ('${senderId}', 'Alice Sender', 'castle'),
             ('${recipient1Id}', 'Bob Recipient', 'wishing-star'),
             ('${recipient2Id}', 'Charlie Recipient', 'fireworks'),
             ('${strangerId}', 'Sam Stranger', 'popcorn');

      INSERT INTO trips (id, name, creator_id, start_date, end_date)
      VALUES ('${tripId}', 'Magic Kingdom 2026', '${senderId}', '2026-10-18', '2026-10-25');

      INSERT INTO trip_memberships (trip_id, user_id, role)
      VALUES ('${tripId}', '${senderId}', 'organizer');
    `);

    // Insert friendships
    const pair1 = canonicalPair(senderId, recipient1Id);
    const pair2 = canonicalPair(senderId, recipient2Id);
    db.public.none(`
      INSERT INTO friendships (user_lo_id, user_hi_id)
      VALUES ('${pair1.lo}', '${pair1.hi}'),
             ('${pair2.lo}', '${pair2.hi}');
    `);

    // Insert share
    const payload: TripSummarySharePayload = {
      kind: 'tripSummary',
      tripId,
      tripName: 'Magic Kingdom 2026',
      sharerDisplayName: 'Alice Sender',
      includePhotos: true,
    };

    db.public.none(`
      INSERT INTO shares (id, sender_id, payload_kind, payload_snapshot)
      VALUES ('${shareId}', '${senderId}', 'tripSummary', '${JSON.stringify(payload)}');

      INSERT INTO share_recipients (share_id, recipient_id)
      VALUES ('${shareId}', '${recipient1Id}'),
             ('${shareId}', '${recipient2Id}');
    `);
  });

  function createTestTripShareFacts(overrides: Partial<TripShareFacts> = {}): TripShareFacts {
    return {
      async roleOf(userId, targetTripId) {
        if (overrides.roleOf) return overrides.roleOf(userId, targetTripId);
        const res = await pool.query<{ role: TripRole }>(
          'SELECT role FROM trip_memberships WHERE trip_id = $1 AND user_id = $2',
          [targetTripId, userId]
        );
        return res.rows[0]?.role ?? null;
      },
      async tripName(targetTripId) {
        if (overrides.tripName) return overrides.tripName(targetTripId);
        const res = await pool.query<{ name: string }>(
          'SELECT name FROM trips WHERE id = $1',
          [targetTripId]
        );
        return res.rows[0]?.name ?? null;
      },
      async isMember(userId, targetTripId) {
        if (overrides.isMember) return overrides.isMember(userId, targetTripId);
        const res = await pool.query<{ exists: number }>(
          'SELECT 1 FROM trip_memberships WHERE trip_id = $1 AND user_id = $2',
          [targetTripId, userId]
        );
        return res.rows.length > 0;
      },
      async summary(targetTripId) {
        if (overrides.summary) return overrides.summary(targetTripId);
        return {
          distinctExperienceCount: 15,
          plannedCompletedCount: 10,
          plannedTotalCount: 12,
          totalCompletionsCount: 42,
          totalRatingsCount: 19,
          parkBreakdown: [
            { park: 'Magic Kingdom', count: 30 },
            { park: 'EPCOT', count: 12 },
          ],
          topRated: [
            {
              experienceId: randomUUID(),
              experienceName: 'Space Mountain',
              meanRating: 9.8,
              ratingCount: 3,
              park: 'Magic Kingdom',
              category: 'Ride',
              imageUrl: 'https://img.example.test/space-mountain.jpg',
            },
          ],
          perMember: [],
          superlatives: [
            {
              id: 'sup-1',
              title: 'Thrill Seeker',
              description: 'Completed top rides',
              icon: 'star',
              memberDisplayName: 'Alice Sender',
            },
          ],
        };
      },
    };
  }

  async function buildServerWithRecap(options: {
    currentUserId?: string;
    tripShareFacts?: TripShareFacts;
    recapPhotoPort?: RecapPhotoPort | undefined;
  }): Promise<FastifyInstance> {
    const app = Fastify({ logger: false });
    registerErrorHandler(app);

    const facts = options.tripShareFacts ?? createTestTripShareFacts();
    const gate = new DefaultRecapShareGate({ pool, tripShareFacts: facts });

    registerTripRecapRoutes(app, {
      requireSession: async (req) => {
        (req as any).user = options.currentUserId ? { id: options.currentUserId } : undefined;
      },
      recapShareGate: gate,
      tripShareFacts: facts,
      recapPhotoPort: options.recapPhotoPort,
    });

    return app;
  }

  it('happy path: returns figures, photos (access: granted), and Cache-Control: private, no-store', async () => {
    const objectStore = new FakeObjectStore();
    const photoPort = new DefaultRecapPhotoPort({
      pool,
      store: objectStore,
    });

    // Seed an approved photo exactly as production leaves it: the row keeps the u/ upload
    // keys, but approval copied the objects to p/ and DELETED the u/ objects, so the bucket
    // holds ONLY the p/ objects.
    const photoId = randomUUID();
    const keys = photoKeys(photoId);
    objectStore.put(keys.full, new Uint8Array([1, 2, 3]));
    objectStore.put(keys.thumb, new Uint8Array([4, 5, 6]));
    db.public.none(`
      INSERT INTO photos (id, owner_id, target_kind, target_id, scope_id, status, object_key, thumb_key, byte_size, thumb_byte_size, width, height, sort_at, harm_verdict, full_etag, thumb_etag)
      VALUES ('${photoId}', '${senderId}', 'trip', '${tripId}', '${tripId}', 'approved', '${keys.uploadFull}', '${keys.uploadThumb}', 1000, 200, 800, 600, '2026-10-20T14:00:00Z', 'pass', 'e1', 'e2');
    `);

    const server = await buildServerWithRecap({
      currentUserId: recipient1Id,
      recapPhotoPort: photoPort,
    });

    const res = await server.inject({
      method: 'GET',
      url: `/me/inbox/${shareId}/trip-recap`,
    });

    if (res.statusCode !== 200) {
      console.log('RECAP 500 BODY:', res.json());
    }
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');

    const body = res.json() as TripRecapDTO;
    expect(body.tripId).toBe(tripId);
    expect(body.tripName).toBe('Magic Kingdom 2026');
    expect(body.sharerDisplayName).toBe('Alice Sender');
    expect(body.recap).toEqual({
      distinctExperienceCount: 15,
      plannedCompletedCount: 10,
      plannedTotalCount: 12,
      totalCompletionsCount: 42,
      totalRatingsCount: 19,
      parksExploredCount: 2,
      superlatives: [
        {
          id: 'sup-1',
          title: 'Thrill Seeker',
          description: 'Completed top rides',
          icon: 'star',
          memberDisplayName: 'Alice Sender',
        },
      ],
      topRated: [
        {
          experienceName: 'Space Mountain',
          meanRating: 9.8,
          ratingCount: 3,
          park: 'Magic Kingdom',
          category: 'Ride',
          imageUrl: 'https://img.example.test/space-mountain.jpg',
        },
      ],
    });
    expect(body.photos.access).toBe('granted');
    expect(body.photos.photos.length).toBe(1);
    expect(body.photos.photos[0]?.id).toBe(photoId);
    // The recap URLs must be the p/ serving keys, which exist in the bucket (not the row's u/ keys).
    expect(FakeObjectStore.keyFromUrl(body.photos.photos[0]?.url ?? '')).toBe(keys.full);
    expect(FakeObjectStore.keyFromUrl(body.photos.photos[0]?.thumbUrl ?? '')).toBe(keys.thumb);
    expect(objectStore.mintedGetKeys().sort()).toEqual([keys.full, keys.thumb].sort());
    expect(objectStore.missingGetKeys()).toEqual([]);
    expect(objectStore.mintedGetKeys().some((k) => k.startsWith('u/'))).toBe(false);
  });

  // Feature: photo-uploads, Property 43: Recap aggregate-only boundary (route level, decision D34)
  it('route payload: exact figure and top-rated key sets, aggregates present, no member sentinel leaks (R15.21, R15.22)', async () => {
    const SENTINEL_MEMBER_ID = 'SENTINEL_MEMBER_ID_7f3a';
    const SENTINEL_MEMBER_NAME = 'SENTINEL_MEMBER_NAME_Gonzo';
    const SENTINEL_TOP_EXP = 'SENTINEL_TOP_EXP_Hidden Gem';
    const SENTINEL_AVATAR = 'SENTINEL_AVATAR_preset';
    const SENTINEL_NUMBER = 918273;
    const SENTINEL_EXPERIENCE_ID = 'SENTINEL_EXPERIENCE_ID_b19c';

    const fixture: TripSummaryDTO = {
      distinctExperienceCount: 14,
      plannedCompletedCount: 7,
      plannedTotalCount: 9,
      totalCompletionsCount: 31,
      totalRatingsCount: 18,
      parkBreakdown: [
        { park: 'Magic Kingdom', count: 15 },
        { park: 'EPCOT', count: 10 },
        { park: 'Animal Kingdom', count: 6 },
      ],
      categoryBreakdown: [{ category: 'Ride', count: 25 }],
      topRated: [
        {
          experienceId: `${SENTINEL_EXPERIENCE_ID}_1`,
          experienceName: 'Space Mountain',
          meanRating: 9.5,
          ratingCount: 4,
          park: 'Magic Kingdom',
          category: 'Ride',
          imageUrl: 'https://img.example.test/space-mountain.jpg',
        },
        {
          experienceId: `${SENTINEL_EXPERIENCE_ID}_2`,
          experienceName: 'Soarin',
          meanRating: 9,
          ratingCount: 2,
          park: 'EPCOT',
          category: 'Ride',
          imageUrl: 'https://img.example.test/soarin.jpg',
        },
        {
          experienceId: `${SENTINEL_EXPERIENCE_ID}_3`,
          experienceName: 'Tiana Snack Stand',
          meanRating: 8,
          ratingCount: 1,
          park: null,
          category: null,
          imageUrl: null,
        },
        {
          experienceId: `${SENTINEL_EXPERIENCE_ID}_4`,
          experienceName: 'Fourth Row Dropped',
          meanRating: 7,
          ratingCount: 1,
          park: 'Animal Kingdom',
          category: 'Ride',
          imageUrl: 'https://img.example.test/fourth.jpg',
        },
      ],
      perMember: [
        {
          memberId: SENTINEL_MEMBER_ID,
          displayName: SENTINEL_MEMBER_NAME,
          avatarPreset: SENTINEL_AVATAR,
          logEntryCount: SENTINEL_NUMBER,
          confirmedTagCount: SENTINEL_NUMBER + 1,
          totalCompletedCount: SENTINEL_NUMBER + 2,
          topRatedExperienceName: SENTINEL_TOP_EXP,
          topRating: SENTINEL_NUMBER + 3,
        },
      ],
      superlatives: [
        {
          id: 'most-rides',
          title: 'Ride Master',
          description: 'Logged the most rides',
          icon: 'trophy',
          memberId: SENTINEL_MEMBER_ID,
          memberDisplayName: 'Alice Sender',
          value: 12,
        },
        {
          id: 'top-experience',
          title: 'Crowd Favorite',
          description: 'The group favorite',
          icon: 'star',
          experienceName: 'Space Mountain',
        },
      ],
    };

    const server = await buildServerWithRecap({
      currentUserId: recipient1Id,
      tripShareFacts: createTestTripShareFacts({ summary: async () => fixture }),
    });
    const res = await server.inject({ method: 'GET', url: `/me/inbox/${shareId}/trip-recap` });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');

    for (const sentinel of [
      SENTINEL_MEMBER_ID,
      SENTINEL_MEMBER_NAME,
      SENTINEL_TOP_EXP,
      SENTINEL_AVATAR,
      SENTINEL_EXPERIENCE_ID,
      String(SENTINEL_NUMBER),
      String(SENTINEL_NUMBER + 1),
      String(SENTINEL_NUMBER + 2),
      String(SENTINEL_NUMBER + 3),
    ]) {
      expect(res.body).not.toContain(sentinel);
    }
    for (const key of ['perMember', 'memberId', 'experienceId', 'actor_id', 'avatarPreset', 'logEntryCount', 'confirmedTagCount']) {
      expect(res.body).not.toContain(`"${key}"`);
    }

    const body = res.json() as TripRecapDTO;
    const recap = body.recap;
    expect(recap).not.toBeNull();
    if (recap === null) return;

    // The contract: the literal, sorted allowlist (written here, not imported, so a
    // field added to the projection later fails this test until the spec is amended).
    expect(Object.keys(recap).sort()).toEqual([
      'distinctExperienceCount',
      'parksExploredCount',
      'plannedCompletedCount',
      'plannedTotalCount',
      'superlatives',
      'topRated',
      'totalCompletionsCount',
      'totalRatingsCount',
    ]);
    expect(recap.totalCompletionsCount).toBe(31);
    expect(recap.totalRatingsCount).toBe(18);
    expect(recap.parksExploredCount).toBe(3);

    // Top-rated: capped at 3 (4th row dropped), catalog fields only when present.
    expect(recap.topRated.map((r) => r.experienceName)).toEqual([
      'Space Mountain',
      'Soarin',
      'Tiana Snack Stand',
    ]);
    expect(Object.keys(recap.topRated[0] ?? {}).sort()).toEqual([
      'category',
      'experienceName',
      'imageUrl',
      'meanRating',
      'park',
      'ratingCount',
    ]);
    expect(recap.topRated[0]).toEqual({
      experienceName: 'Space Mountain',
      meanRating: 9.5,
      ratingCount: 4,
      park: 'Magic Kingdom',
      category: 'Ride',
      imageUrl: 'https://img.example.test/space-mountain.jpg',
    });
    expect(Object.keys(recap.topRated[2] ?? {}).sort()).toEqual([
      'experienceName',
      'meanRating',
      'ratingCount',
    ]);

    // Superlatives keep the existing projection: display name allowed, id never.
    expect(recap.superlatives[0]).toEqual({
      id: 'most-rides',
      title: 'Ride Master',
      description: 'Logged the most rides',
      icon: 'trophy',
      memberDisplayName: 'Alice Sender',
      value: 12,
    });
  });

  // Feature: photo-uploads, Property 43: Recap aggregate-only boundary (totals equal the real summary's)
  it('totals equal the real derived summary totals; parksExploredCount is the distinct park count (R15.21)', async () => {
    const memberA = randomUUID();
    const memberB = randomUUID();
    const expMk = randomUUID();
    const expEp = randomUUID();
    const expAk = randomUUID();
    const expAk2 = randomUUID();
    const logEntries = [
      { memberId: memberA, experienceId: expMk, experienceName: 'Space Mountain', park: 'Magic Kingdom', category: 'Ride', imageUrl: 'https://img.example.test/sm.jpg' },
      { memberId: memberA, experienceId: expEp, experienceName: 'Soarin', park: 'EPCOT', category: 'Ride', imageUrl: null },
      { memberId: memberB, experienceId: expAk, experienceName: 'Expedition Everest', park: 'Animal Kingdom', category: 'Ride', imageUrl: null },
      { memberId: memberB, experienceId: expAk2, experienceName: 'Kilimanjaro Safaris', park: 'Animal Kingdom', category: 'Ride', imageUrl: null },
    ];
    const confirmedTags = [
      { memberId: memberB, experienceId: expMk, experienceName: 'Space Mountain', park: 'Magic Kingdom', category: 'Ride', imageUrl: null },
    ];
    const ratings = [
      { memberId: memberA, experienceId: expMk, value: 9 },
      { memberId: memberB, experienceId: expMk, value: 10 },
      { memberId: memberA, experienceId: expEp, value: 8 },
    ];
    const derived = deriveTripSummary({
      logEntries,
      confirmedTags,
      ratings,
      plannedItems: [{ experienceId: expMk }, { experienceId: expEp }, { experienceId: randomUUID() }],
    });
    const summary: TripSummaryDTO = {
      ...derived,
      perMember: derived.perMember.map((m, index) => ({
        ...m,
        displayName: `Member ${index}`,
        avatarPreset: null,
      })),
    };

    const server = await buildServerWithRecap({
      currentUserId: recipient1Id,
      tripShareFacts: createTestTripShareFacts({ summary: async () => summary }),
    });
    const res = await server.inject({ method: 'GET', url: `/me/inbox/${shareId}/trip-recap` });
    expect(res.statusCode).toBe(200);
    const recap = (res.json() as TripRecapDTO).recap;
    expect(recap).not.toBeNull();
    if (recap === null) return;

    expect(recap.totalCompletionsCount).toBe(logEntries.length + confirmedTags.length);
    expect(recap.totalCompletionsCount).toBe(5);
    expect(recap.totalRatingsCount).toBe(ratings.length);
    expect(recap.parksExploredCount).toBe(3);
    expect(recap.parksExploredCount).toBe(summary.parkBreakdown?.length);
    expect(recap.distinctExperienceCount).toBe(4);
    expect(recap.plannedCompletedCount).toBe(2);
    expect(recap.plannedTotalCount).toBe(3);
    // Catalog fields come from the log entries through the real derivation.
    expect(recap.topRated[0]).toEqual({
      experienceName: 'Space Mountain',
      meanRating: 9.5,
      ratingCount: 2,
      park: 'Magic Kingdom',
      category: 'Ride',
      imageUrl: 'https://img.example.test/sm.jpg',
    });
  });

  it('absent totals and park breakdown default to 0 and never fall back to perMember (R15.21, R15.22)', async () => {
    const summary: TripSummaryDTO = {
      distinctExperienceCount: 3,
      plannedCompletedCount: 0,
      plannedTotalCount: 0,
      topRated: [],
      perMember: [
        {
          memberId: 'SENTINEL_MEMBER_ID_zero',
          displayName: 'Busy Member',
          logEntryCount: 40,
          confirmedTagCount: 10,
          totalCompletedCount: 50,
        },
      ],
    };
    const server = await buildServerWithRecap({
      currentUserId: recipient1Id,
      tripShareFacts: createTestTripShareFacts({ summary: async () => summary }),
    });
    const res = await server.inject({ method: 'GET', url: `/me/inbox/${shareId}/trip-recap` });
    expect(res.statusCode).toBe(200);
    const recap = (res.json() as TripRecapDTO).recap;
    expect(recap?.totalCompletionsCount).toBe(0);
    expect(recap?.totalRatingsCount).toBe(0);
    expect(recap?.parksExploredCount).toBe(0);
    expect(recap?.topRated).toEqual([]);
    expect(res.body).not.toContain('SENTINEL_MEMBER_ID_zero');
  });

  it('unfriend after send (Requirement 15.14, decision D25): cut access, facts and photo port never called after failure', async () => {
    let factsSummaryCalls = 0;
    let photoPortCalls = 0;

    const facts = createTestTripShareFacts({
      async summary(_tid) {
        factsSummaryCalls++;
        return {
          distinctExperienceCount: 10,
          plannedCompletedCount: 5,
          plannedTotalCount: 5,
          topRated: [],
          perMember: [],
        };
      },
    });

    const fakePhotoPort: RecapPhotoPort = {
      async highlights() {
        photoPortCalls++;
        return [];
      },
      async isHighlight() {
        return false;
      },
      async albumPage() {
        return { photos: [], nextCursor: null };
      },
      async isAlbumPhoto() {
        return false;
      },
    };

    // 1. Recipient 1 reads once successfully
    const server1 = await buildServerWithRecap({
      currentUserId: recipient1Id,
      tripShareFacts: facts,
      recapPhotoPort: fakePhotoPort,
    });

    const res1 = await server1.inject({
      method: 'GET',
      url: `/me/inbox/${shareId}/trip-recap`,
    });
    expect(res1.statusCode).toBe(200);
    expect(factsSummaryCalls).toBe(1);

    // 2. Remove friendship between sender and recipient1
    const pair1 = canonicalPair(senderId, recipient1Id);
    db.public.none(`
      DELETE FROM friendships WHERE user_lo_id = '${pair1.lo}' AND user_hi_id = '${pair1.hi}';
    `);

    // Reset counters to test call-order assertion
    factsSummaryCalls = 0;
    photoPortCalls = 0;

    // 3. Recipient 1 reads again -> validation_failed, no recap, no URL, no downstream calls
    const res2 = await server1.inject({
      method: 'GET',
      url: `/me/inbox/${shareId}/trip-recap`,
    });
    expect(res2.statusCode).toBe(400);
    expect(res2.json().error?.code).toBe('validation_failed');
    expect(factsSummaryCalls).toBe(0);
    expect(photoPortCalls).toBe(0);

    // 4. Recipient 2 (still a friend) can still read successfully
    const server2 = await buildServerWithRecap({
      currentUserId: recipient2Id,
      tripShareFacts: facts,
      recapPhotoPort: fakePhotoPort,
    });
    const res3 = await server2.inject({
      method: 'GET',
      url: `/me/inbox/${shareId}/trip-recap`,
    });
    expect(res3.statusCode).toBe(200);
  });

  it('recipient soft delete ends access (validation_failed) while other recipient still reads', async () => {
    // Soft delete recipient 1
    db.public.none(`
      UPDATE share_recipients SET recipient_deleted_at = now()
      WHERE share_id = '${shareId}' AND recipient_id = '${recipient1Id}';
    `);

    const server1 = await buildServerWithRecap({ currentUserId: recipient1Id });
    const res1 = await server1.inject({
      method: 'GET',
      url: `/me/inbox/${shareId}/trip-recap`,
    });
    expect(res1.statusCode).toBe(400);
    expect(res1.json().error?.code).toBe('validation_failed');

    // Recipient 2 still reads it
    const server2 = await buildServerWithRecap({ currentUserId: recipient2Id });
    const res2 = await server2.inject({
      method: 'GET',
      url: `/me/inbox/${shareId}/trip-recap`,
    });
    expect(res2.statusCode).toBe(200);
  });

  it('non-recipient friend gets validation_failed', async () => {
    // Stranger is not recipient
    const server = await buildServerWithRecap({ currentUserId: strangerId });
    const res = await server.inject({
      method: 'GET',
      url: `/me/inbox/${shareId}/trip-recap`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error?.code).toBe('validation_failed');
  });

  it('Trip deleted or sharer removed: returns 200 with recap: null and access: unavailable (unavailable wins)', async () => {
    // Remove sender from trip_memberships
    db.public.none(`DELETE FROM trip_memberships WHERE trip_id = '${tripId}' AND user_id = '${senderId}';`);

    const server = await buildServerWithRecap({ currentUserId: recipient1Id });
    const res = await server.inject({
      method: 'GET',
      url: `/me/inbox/${shareId}/trip-recap`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as TripRecapDTO;
    expect(body.recap).toBeNull();
    expect(body.photos.access).toBe('unavailable');
    expect(body.photos.photos).toEqual([]);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('distinctExperienceCount');
    expect(serialized).not.toContain('topRated');
    // The D34 aggregates are figures too: none of them appears when recap is null.
    expect(serialized).not.toContain('totalCompletionsCount');
    expect(serialized).not.toContain('totalRatingsCount');
    expect(serialized).not.toContain('parksExploredCount');
  });

  it('includePhotos: false gives not_included when trip available, but unavailable when trip gone', async () => {
    // Update share payload to includePhotos: false
    const payloadFalse: TripSummarySharePayload = {
      kind: 'tripSummary',
      tripId,
      tripName: 'Magic Kingdom 2026',
      sharerDisplayName: 'Alice Sender',
      includePhotos: false,
    };
    db.public.none(`
      UPDATE shares SET payload_snapshot = '${JSON.stringify(payloadFalse)}'
      WHERE id = '${shareId}';
    `);

    // Case 1: Trip available -> access is 'not_included', figures present
    const server1 = await buildServerWithRecap({ currentUserId: recipient1Id });
    const res1 = await server1.inject({
      method: 'GET',
      url: `/me/inbox/${shareId}/trip-recap`,
    });
    expect(res1.statusCode).toBe(200);
    const body1 = res1.json() as TripRecapDTO;
    expect(body1.recap).not.toBeNull();
    expect(body1.photos.access).toBe('not_included');
    expect(body1.photos.photos).toEqual([]);

    // Case 2: Sharer removed -> access is 'unavailable' (unavailable wins)
    db.public.none(`DELETE FROM trip_memberships WHERE trip_id = '${tripId}' AND user_id = '${senderId}';`);
    const server2 = await buildServerWithRecap({ currentUserId: recipient1Id });
    const res2 = await server2.inject({
      method: 'GET',
      url: `/me/inbox/${shareId}/trip-recap`,
    });
    expect(res2.statusCode).toBe(200);
    const body2 = res2.json() as TripRecapDTO;
    expect(body2.recap).toBeNull();
    expect(body2.photos.access).toBe('unavailable');
  });

  it('photos disabled (recapPhotoPort omitted): returns figures and photos.access: unavailable', async () => {
    const server = await buildServerWithRecap({
      currentUserId: recipient1Id,
      recapPhotoPort: undefined,
    });
    const res = await server.inject({
      method: 'GET',
      url: `/me/inbox/${shareId}/trip-recap`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as TripRecapDTO;
    expect(body.recap).not.toBeNull();
    expect(body.photos.access).toBe('unavailable');
    expect(body.photos.photos).toEqual([]);
  });

  it('highlight selection: picks earliest photo per day up to max, excluding blocked uploader', async () => {
    const blockedUploaderId = randomUUID();
    db.public.none(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${blockedUploaderId}', 'blocked@example.com', 'h5');
      INSERT INTO trip_memberships (trip_id, user_id, role)
      VALUES ('${tripId}', '${blockedUploaderId}', 'member');
      INSERT INTO user_blocks (blocker_id, blocked_id)
      VALUES ('${recipient1Id}', '${blockedUploaderId}');
    `);

    // Photos on Day 1: one from blocked uploader (earlier), one from sender (later)
    const p1Blocked = randomUUID();
    const p1Good = randomUUID();
    // Photos on Day 2: from sender
    const p2Good = randomUUID();

    // Rows hold the u/ upload keys (production shape); the bucket holds only p/ objects.
    const objectStore = new FakeObjectStore();
    for (const id of [p1Blocked, p1Good, p2Good]) {
      objectStore.put(photoKeys(id).full, new Uint8Array([1]));
      objectStore.put(photoKeys(id).thumb, new Uint8Array([2]));
    }
    db.public.none(`
      INSERT INTO photos (id, owner_id, target_kind, target_id, scope_id, status, object_key, thumb_key, byte_size, thumb_byte_size, width, height, sort_at, harm_verdict, full_etag, thumb_etag)
      VALUES ('${p1Blocked}', '${blockedUploaderId}', 'trip', '${tripId}', '${tripId}', 'approved', '${photoKeys(p1Blocked).uploadFull}', '${photoKeys(p1Blocked).uploadThumb}', 100, 10, 100, 100, '2026-10-20T10:00:00Z', 'pass', 'e1', 'e2'),
             ('${p1Good}', '${senderId}', 'trip', '${tripId}', '${tripId}', 'approved', '${photoKeys(p1Good).uploadFull}', '${photoKeys(p1Good).uploadThumb}', 100, 10, 100, 100, '2026-10-20T15:00:00Z', 'pass', 'e3', 'e4'),
             ('${p2Good}', '${senderId}', 'trip', '${tripId}', '${tripId}', 'approved', '${photoKeys(p2Good).uploadFull}', '${photoKeys(p2Good).uploadThumb}', 100, 10, 100, 100, '2026-10-21T11:00:00Z', 'pass', 'e5', 'e6');
    `);

    const photoPort = new DefaultRecapPhotoPort({
      pool,
      store: objectStore,
    });

    const server = await buildServerWithRecap({
      currentUserId: recipient1Id,
      recapPhotoPort: photoPort,
    });

    const res = await server.inject({
      method: 'GET',
      url: `/me/inbox/${shareId}/trip-recap`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as TripRecapDTO;
    expect(body.photos.photos.length).toBe(2);
    // Day 1 photo should be p1Good because p1Blocked was blocked
    expect(body.photos.photos[0]?.id).toBe(p1Good);
    expect(body.photos.photos[1]?.id).toBe(p2Good);
    // Every minted URL is a p/ key present in the bucket.
    expect(objectStore.missingGetKeys()).toEqual([]);
    expect(objectStore.mintedGetKeys().some((k) => k.startsWith('u/'))).toBe(false);
    expect(body.photos.photos.map((p) => FakeObjectStore.keyFromUrl(p.url))).toEqual([
      photoKeys(p1Good).full,
      photoKeys(p2Good).full,
    ]);
  });

  it('unauthenticated request is 401', async () => {
    const server = await buildServerWithRecap({});
    const res = await server.inject({
      method: 'GET',
      url: `/me/inbox/${shareId}/trip-recap`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('source guard: tripRecapRoutes.ts does not import trips/repo, trips/authz, or DbPool/pg', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const recapSource = readFileSync(resolve(here, '..', 'tripRecapRoutes.ts'), 'utf8');

    expect(recapSource).not.toMatch(/from\s+['"][^'"]*trips\/repo(\.js)?['"]/);
    expect(recapSource).not.toMatch(/from\s+['"][^'"]*trips\/authz(\.js)?['"]/);
    expect(recapSource).not.toMatch(/from\s+['"][^'"]*db\/pool(\.js)?['"]/);
    expect(recapSource).not.toMatch(/from\s+['"]pg['"]/);
  });

  it('report and block through shareId (Requirements 16.8, 16.9)', async () => {
    // Setup photo routes
    const fakeStore = {
      presignGet: async ({ key }: { key: string }) => `https://signed.example.com/${key}`,
      presignPut: async () => 'https://put.example.com',
      delete: async () => {},
      copy: async () => ({ kind: 'ok' as const, etag: 'etag' }),
    };
    const photoPort = new DefaultRecapPhotoPort({
      pool,
      store: fakeStore as any,
    });
    const facts = createTestTripShareFacts();
    const gate = new DefaultRecapShareGate({ pool, tripShareFacts: facts });

    const photoRepo = createPhotosRepo(pool);
    const reportsRepo = createReportsRepo(pool);
    const tripTarget = new TripTarget({ pool, maxPerTrip: 100, tripEnabled: true });

    const photoService = new PhotoService({
      pool,
      repo: photoRepo,
      reportsRepo,
      objectStore: fakeStore as any,
      clock: { now: () => new Date() },
      targetAdapters: [tripTarget],
      config: {
        enabled: true,
        foodEnabled: true,
        tripEnabled: true,
        maxBytes: 10_000_000,
        maxThumbBytes: 1_000_000,
        putUrlTtlSeconds: 300,
        dailyUploadCap: 50,
        globalDailyCap: 1000,
        maxPerFoodLog: 4,
        maxPerTrip: 300,
        maxFeedPostPhotos: 4,
        maxBatch: 10,
        recapHighlightMax: 6,
        reportAutohideTrip: 3,
        reportAutohideFood: 3,
        getUrlTtlSeconds: 3600,
        experienceStripMax: 8,
      },
      recapShareGate: gate,
      recapPhotoPort: photoPort,
    });

    const app = Fastify({ logger: false });
    registerErrorHandler(app);

    let activeUser = recipient1Id;
    const sessionMiddleware = async (req: any) => {
      req.userId = activeUser;
      req.user = { id: activeUser };
    };

    await app.register(photoRoutes, {
      photoService,
      requireSession: sessionMiddleware,
    });

    // Seed two approved trip photos: pHighlight and pNonHighlight
    const pHighlight = randomUUID();
    const pNonHighlight = randomUUID();
    db.public.none(`
      INSERT INTO photos (id, owner_id, target_kind, target_id, scope_id, status, object_key, thumb_key, byte_size, thumb_byte_size, width, height, sort_at, harm_verdict, full_etag, thumb_etag)
      VALUES ('${pHighlight}', '${senderId}', 'trip', '${tripId}', '${tripId}', 'approved', 'h.jpg', 'th.jpg', 100, 10, 100, 100, '2026-10-20T10:00:00Z', 'pass', 'e1', 'e2'),
             ('${pNonHighlight}', '${senderId}', 'trip', '${tripId}', '${tripId}', 'approved', 'nh.jpg', 'tnh.jpg', 100, 10, 100, 100, '2026-10-20T12:00:00Z', 'pass', 'e3', 'e4');
    `);

    // 1. Report highlight photo WITH shareId -> 204
    const reportRes1 = await app.inject({
      method: 'POST',
      url: `/photos/${pHighlight}/report`,
      payload: {
        reason: 'spam',
        shareId,
      },
    });
    expect(reportRes1.statusCode).toBe(204);

    // 2. An approved Trip photo that is not a highlight is reportable through the share
    //    (widened D32, decision D35, Requirement 16.10) -> 204
    const reportRes2 = await app.inject({
      method: 'POST',
      url: `/photos/${pNonHighlight}/report`,
      payload: {
        reason: 'spam',
        shareId,
      },
    });
    expect(reportRes2.statusCode).toBe(204);

    // 3. Report highlight photo WITHOUT shareId (recipient is not a trip member) -> 404 photo_not_found
    const reportRes3 = await app.inject({
      method: 'POST',
      url: `/photos/${pHighlight}/report`,
      payload: {
        reason: 'spam',
      },
    });
    expect(reportRes3.statusCode).toBe(404);
    expect(reportRes3.json().error?.code).toBe('photo_not_found');

    // 4. Block with { photoId, shareId } -> 201, returns BlockedUserDTO with no userId
    const blockRes = await app.inject({
      method: 'POST',
      url: '/me/blocks',
      payload: {
        photoId: pHighlight,
        shareId,
      },
    });
    expect(blockRes.statusCode).toBe(201);
    const blockBody = blockRes.json();
    expect(blockBody.blockId).toBeDefined();
    expect(blockBody.userId).toBeUndefined();
    expect(blockBody.displayName).toBe('Alice Sender'); // Alice is a friend of recipient1
  });

  it('production registration (Requirement 15.17): route is registered with photos enabled and with photos disabled', async () => {
    const facts = createTestTripShareFacts();
    const gate = new DefaultRecapShareGate({ pool, tripShareFacts: facts });
    const fakeStore = {
      presignGet: async ({ key }: { key: string }) => `https://signed.example.com/${key}`,
    };
    const photoPort = new DefaultRecapPhotoPort({
      pool,
      store: fakeStore as any,
    });

    const dummySharingRepo = {
      async createShareAtomic() { throw new Error('noop'); },
      async listInbox() { return { items: [], nextCursor: null, unread: 0 }; },
      async countUnreadInbox() { return 0; },
      async markAllInboxRead() { return 0; },
      async openShare() { return null; },
      async softDeleteForRecipient() { return false; },
      async listSentShares() { return []; },
    };

    // 1. PHOTOS_ENABLED=true: route is registered and RecapPhotoPort is wired
    const configEnabled = makeTestConfig(true);
    const appEnabled = buildServer(configEnabled, {
      sharing: {
        repo: dummySharingRepo,
        requireSession: async (req: any) => { req.user = { id: recipient1Id }; },
        tripShareFacts: facts,
        recapShareGate: gate,
        recapPhotoPort: photoPort,
      },
    });
    await appEnabled.ready();

    // With session, inject answers 200 with access: granted
    const probeRes1 = await appEnabled.inject({
      method: 'GET',
      url: `/me/inbox/${shareId}/trip-recap`,
    });
    expect(probeRes1.statusCode).toBe(200);
    const body1 = probeRes1.json() as TripRecapDTO;
    expect(body1.photos.access).toBe('granted');

    // 2. PHOTOS_ENABLED=false: route is registered, no RecapPhotoPort, answers 200 with access: unavailable
    const configDisabled = makeTestConfig(false);
    const appDisabled = buildServer(configDisabled, {
      sharing: {
        repo: dummySharingRepo,
        requireSession: async (req: any) => { req.user = { id: recipient1Id }; },
        tripShareFacts: facts,
        recapShareGate: gate,
      },
      photos: {
        requireSession: async () => {},
        enabled: false,
      },
    });
    await appDisabled.ready();

    const probeRes2 = await appDisabled.inject({
      method: 'GET',
      url: `/me/inbox/${shareId}/trip-recap`,
    });
    expect(probeRes2.statusCode).toBe(200);
    const body2 = probeRes2.json() as TripRecapDTO;
    expect(body2.photos.access).toBe('unavailable');
  });
});
