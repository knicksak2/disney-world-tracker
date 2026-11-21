// Feature: first-run-onboarding, Property 4: Quick-Completions Deduplication and Idempotency
// Feature: first-run-onboarding, Property 5: Quick-Completions Atomicity on Invalid IDs

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { createOnboardingRepo, type OnboardingRepo } from '../repo.js';
import { createOnboardingService } from '../service.js';
import { deriveOnboardingState, mergeOnboardingPatch } from '../domain/statePolicy.js';

const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'migrations',
);

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
      if (typeof parsed === 'number') return 'number';
      if (typeof parsed === 'boolean') return 'boolean';
      if (typeof parsed === 'string') return 'string';
      return 'object';
    },
  });
  return db;
}

function applyMigrations(db: IMemoryDb): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((n) => /^\d{4}_.*\.sql$/u.test(n))
    .sort((a, b) => a.localeCompare(b));

  for (const name of files) {
    if (/^00(70|71|74)_.*backfill/u.test(name) || /^0074_trip_stays_backfill/u.test(name)) {
      continue;
    }
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

describe('OnboardingRepo SQL Integration (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let repo: OnboardingRepo;
  let userId: string;
  let exp1Id: string;
  let exp2Id: string;
  let exp3Id: string;
  let inactiveExpId: string;

  async function seedUser(email: string): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash')`,
      [id, email],
    );
    return id;
  }

  async function seedExperience(name: string, active = true): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category, active)
       VALUES ($1, $2, $3, 'Magic Kingdom', 'Ride', $4)`,
      [id, `ent-${id}`, name, active],
    );
    return id;
  }

  beforeEach(async () => {
    db = buildPgMemDatabase();
    applyMigrations(db);
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as DbPool;
    repo = createOnboardingRepo(pool);

    userId = await seedUser('newbie@example.com');
    exp1Id = await seedExperience('Space Mountain', true);
    exp2Id = await seedExperience('Haunted Mansion', true);
    exp3Id = await seedExperience('Pirates of the Caribbean', true);
    inactiveExpId = await seedExperience('Splash Mountain', false);
  });

  it('initializes brand-new user with grandfatheredAt = null and keeps needsOnboarding true across Step 2 writes', async () => {
    const t0 = new Date('2026-11-18T12:00:00.000Z');
    const first = await repo.getOrInitSnapshot(userId, t0);
    expect(first.stored.grandfatheredAt).toBeNull();
    expect(deriveOnboardingState(first.stored, first.signals).needsOnboarding).toBe(true);

    // Step 2 adds a completion and a trip membership before completedAt is stamped
    await repo.insertQuickCompletions(userId, [exp1Id], '2026-11-18', 'America/New_York');
    const tripId = randomUUID();
    await pool.query(
      `INSERT INTO trips (id, name, creator_id, start_date, end_date) VALUES ($1, 'Starter Trip', $2, '2026-12-01', '2026-12-05')`,
      [tripId, userId],
    );
    await pool.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role) VALUES ($1, $2, 'organizer')`,
      [tripId, userId],
    );

    const midFlow = await repo.getOrInitSnapshot(userId, new Date('2026-11-18T12:01:00.000Z'));
    expect(midFlow.stored.grandfatheredAt).toBeNull();
    const derived = deriveOnboardingState(midFlow.stored, midFlow.signals);
    expect(derived.needsOnboarding).toBe(true);
    expect(derived.checklist.loggedFirstExperience).toBe(true);
    expect(derived.checklist.hasTrip).toBe(true);
  });

  it('grandfathers users on first read for each core activity table and stays permanent after data deletion', async () => {
    const t0 = new Date('2026-11-18T12:00:00.000Z');

    // 1) completion
    const uComp = await seedUser('vet-comp@example.com');
    await pool.query(
      `INSERT INTO completions (user_id, experience_id, completed_on, user_tz) VALUES ($1, $2, '2026-10-01', 'America/New_York')`,
      [uComp, exp1Id],
    );
    const snapComp = await repo.getOrInitSnapshot(uComp, t0);
    expect(snapComp.stored.grandfatheredAt).not.toBeNull();
    expect(deriveOnboardingState(snapComp.stored, snapComp.signals).needsOnboarding).toBe(false);
    // Delete completion afterward -> still grandfathered
    await pool.query(`DELETE FROM completions WHERE user_id = $1`, [uComp]);
    const afterDelete = await repo.getOrInitSnapshot(uComp, new Date('2026-11-18T13:00:00.000Z'));
    expect(afterDelete.stored.grandfatheredAt).not.toBeNull();
    expect(deriveOnboardingState(afterDelete.stored, afterDelete.signals).needsOnboarding).toBe(false);

    // 2) experience_logs
    const uLog = await seedUser('vet-log@example.com');
    await pool.query(
      `INSERT INTO experience_logs (user_id, experience_id, visited_on, user_tz) VALUES ($1, $2, '2026-10-01', 'America/New_York')`,
      [uLog, exp1Id],
    );
    const snapLog = await repo.getOrInitSnapshot(uLog, t0);
    expect(snapLog.stored.grandfatheredAt).not.toBeNull();

    // 3) food_item_logs
    const uFood = await seedUser('vet-food@example.com');
    const foodItemId = randomUUID();
    await pool.query(
      `INSERT INTO food_items (id, experience_id, name, created_by_user_id) VALUES ($1, $2, 'Dole Whip', $3)`,
      [foodItemId, exp1Id, uFood],
    );
    await pool.query(
      `INSERT INTO food_item_logs (user_id, food_item_id, visited_on, user_tz) VALUES ($1, $2, '2026-10-01', 'America/New_York')`,
      [uFood, foodItemId],
    );
    const snapFood = await repo.getOrInitSnapshot(uFood, t0);
    expect(snapFood.stored.grandfatheredAt).not.toBeNull();

    // 4) trip_memberships
    const uTrip = await seedUser('vet-trip@example.com');
    const tripId = randomUUID();
    await pool.query(
      `INSERT INTO trips (id, name, creator_id, start_date, end_date) VALUES ($1, 'Vet Trip', $2, '2026-10-01', '2026-10-05')`,
      [tripId, uTrip],
    );
    await pool.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role) VALUES ($1, $2, 'organizer')`,
      [tripId, uTrip],
    );
    const snapTrip = await repo.getOrInitSnapshot(uTrip, t0);
    expect(snapTrip.stored.grandfatheredAt).not.toBeNull();
  });

  it('handles concurrent/repeated first reads idempotently and tracks unclaimed vs claimed pins', async () => {
    const t0 = new Date('2026-11-18T12:00:00.000Z');
    const [a, b] = await Promise.all([
      repo.getOrInitSnapshot(userId, t0),
      repo.getOrInitSnapshot(userId, t0),
    ]);
    expect(a.stored).toEqual(b.stored);

    // Unclaimed pin does not satisfy claimedPin
    await pool.query(
      `INSERT INTO user_pins (user_id, pin_id, claimed_at) VALUES ($1, 'bronze_park_starter_magic_kingdom', NULL)`,
      [userId],
    );
    const unclaimed = await repo.getOrInitSnapshot(userId, t0);
    expect(unclaimed.signals.hasClaimedPin).toBe(false);

    // Claimed pin satisfies claimedPin; favorite satisfies starredFavorite
    await pool.query(
      `UPDATE user_pins SET claimed_at = NOW() WHERE user_id = $1`,
      [userId],
    );
    await pool.query(
      `INSERT INTO experience_favorites (user_id, experience_id) VALUES ($1, $2)`,
      [userId, exp1Id],
    );
    const claimed = await repo.getOrInitSnapshot(userId, t0);
    expect(claimed.signals.hasClaimedPin).toBe(true);
    expect(claimed.signals.hasFavorite).toBe(true);
  });

  it('upsertState preserves grandfathered_at and keeps completedAt monotonic', async () => {
    const vetId = await seedUser('vet-upsert@example.com');
    await pool.query(
      `INSERT INTO completions (user_id, experience_id, completed_on, user_tz) VALUES ($1, $2, '2026-10-01', 'America/New_York')`,
      [vetId, exp1Id],
    );
    const init = await repo.getOrInitSnapshot(vetId, new Date('2026-11-18T10:00:00.000Z'));
    expect(init.stored.grandfatheredAt).not.toBeNull();

    // Even if upsert passes a modified/null grandfatheredAt, ON CONFLICT DO UPDATE never wipes grandfathered_at
    const next = mergeOnboardingPatch(
      init.stored,
      { initialIntent: 'plan', complete: true },
      '2026-11-18T11:00:00.000Z',
    );
    const saved1 = await repo.upsertState(
      vetId,
      { ...next, grandfatheredAt: null },
      new Date('2026-11-18T11:00:00.000Z'),
    );
    expect(saved1.grandfatheredAt).toBe(init.stored.grandfatheredAt);
    expect(saved1.completedAt).toBe('2026-11-18T11:00:00.000Z');

    const next2 = mergeOnboardingPatch(
      saved1,
      { complete: true },
      '2026-11-18T12:00:00.000Z',
    );
    const saved2 = await repo.upsertState(vetId, next2, new Date('2026-11-18T12:00:00.000Z'));
    expect(saved2.completedAt).toBe('2026-11-18T11:00:00.000Z');
  });

  it('Property 4: quick-completions deduplicates, preserves user_tz, omits experience_logs, and is idempotent', async () => {
    const poolIds = [exp1Id, exp2Id, exp3Id];
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...poolIds), { minLength: 1, maxLength: 6 }),
        async (ids) => {
          const freshUser = await seedUser(`p4-${randomUUID()}@example.com`);
          const uniqueCount = new Set(ids).size;

          const first = await repo.insertQuickCompletions(
            freshUser,
            ids,
            '2026-11-18',
            'America/Chicago',
          );
          expect(first.addedCount).toBe(uniqueCount);
          expect(first.alreadyCompletedCount).toBe(0);
          expect(first.addedCount + first.alreadyCompletedCount).toBe(uniqueCount);

          const second = await repo.insertQuickCompletions(
            freshUser,
            ids,
            '2026-11-18',
            'America/Chicago',
          );
          expect(second.addedCount).toBe(0);
          expect(second.alreadyCompletedCount).toBe(uniqueCount);

          const storedCompletions = await pool.query<{
            experience_id: string;
            user_tz: string;
          }>(
            `SELECT experience_id, user_tz FROM completions WHERE user_id = $1`,
            [freshUser],
          );
          expect(storedCompletions.rows).toHaveLength(uniqueCount);
          for (const row of storedCompletions.rows) {
            expect(row.user_tz).toBe('America/Chicago');
          }

          const logsRes = await pool.query<{ n: number }>(
            `SELECT COUNT(*)::int AS n FROM experience_logs WHERE user_id = $1`,
            [freshUser],
          );
          expect(logsRes.rows[0]?.n).toBe(0);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('Property 5: quick-completions rejects missing or inactive experience ids atomically with 0 inserts', async () => {
    const unknownId = randomUUID();

    await expect(
      repo.insertQuickCompletions(
        userId,
        [exp1Id, unknownId],
        '2026-11-18',
        'America/New_York',
      ),
    ).rejects.toMatchObject({ code: 'experience_not_found' });

    await expect(
      repo.insertQuickCompletions(
        userId,
        [exp1Id, inactiveExpId],
        '2026-11-18',
        'America/New_York',
      ),
    ).rejects.toMatchObject({ code: 'experience_not_found' });

    const res = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM completions WHERE user_id = $1`,
      [userId],
    );
    expect(res.rows[0]?.n).toBe(0);
  });

  it('derives addedCount from INSERT ... ON CONFLICT DO NOTHING RETURNING when concurrent tx skips a row', async () => {
    const concurrentPool = {
      query: ((...args: Parameters<DbPool['query']>) => pool.query(...args)) as DbPool['query'],
      connect: (async () => {
        const realClient = await pool.connect();
        return {
          release: () => realClient.release(),
          query: async (text: string, params?: unknown[]) => {
            if (text.includes('INSERT INTO completions') && text.includes('RETURNING experience_id')) {
              // Simulate a concurrent transaction having committed `exp1Id` after
              // `existingRes` ran, so Postgres INSERT ... ON CONFLICT DO NOTHING
              // returns only `exp2Id` from RETURNING.
              await realClient.query(
                `INSERT INTO completions (user_id, experience_id, completed_on, user_tz)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (user_id, experience_id) DO NOTHING`,
                [userId, exp1Id, '2026-11-18', 'America/New_York'],
              );
              return realClient.query(
                `INSERT INTO completions (user_id, experience_id, completed_on, user_tz)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (user_id, experience_id) DO NOTHING
                 RETURNING experience_id`,
                [userId, exp2Id, '2026-11-18', 'America/New_York'],
              );
            }
            return realClient.query(text, params as never);
          },
        };
      }) as unknown as DbPool['connect'],
      end: () => pool.end(),
    } as unknown as DbPool;

    const concurrentRepo = createOnboardingRepo(concurrentPool);
    const result = await concurrentRepo.insertQuickCompletions(
      userId,
      [exp1Id, exp2Id],
      '2026-11-18',
      'America/New_York',
    );

    expect(result).toEqual({ addedCount: 1, alreadyCompletedCount: 1 });
  });

  it('service patchOnboardingState before any GET grandfathers veterans and keeps new users eligible', async () => {
    const service = createOnboardingService({
      repo,
      clock: () => new Date('2026-11-18T15:00:00.000Z'),
    });

    // Veteran who has never called GET /me/onboarding sends PATCH directly
    const vetId = await seedUser('vet-patch-first@example.com');
    await pool.query(
      `INSERT INTO completions (user_id, experience_id, completed_on, user_tz) VALUES ($1, $2, '2026-10-01', 'America/New_York')`,
      [vetId, exp1Id],
    );
    const vetPatched = await service.patchOnboardingState(vetId, { initialIntent: 'explore' });
    expect(vetPatched.needsOnboarding).toBe(false);
    expect(vetPatched.showStarterChecklist).toBe(false);
    const vetRow = await pool.query<{ grandfathered_at: Date | null }>(
      `SELECT grandfathered_at FROM user_onboarding WHERE user_id = $1`,
      [vetId],
    );
    expect(vetRow.rows[0]?.grandfathered_at).not.toBeNull();

    // Brand-new user sending PATCH before GET keeps grandfathered_at = NULL
    const newPatched = await service.patchOnboardingState(userId, { initialIntent: 'plan' });
    expect(newPatched.needsOnboarding).toBe(true);
    expect(newPatched.showStarterChecklist).toBe(true);
    const newRow = await pool.query<{ grandfathered_at: Date | null }>(
      `SELECT grandfathered_at FROM user_onboarding WHERE user_id = $1`,
      [userId],
    );
    expect(newRow.rows[0]?.grandfathered_at).toBeNull();
  });
});
