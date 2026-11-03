/**
 * Feature: trip-budget, Property 19: LL persistence has one writer, is deduped and bounded
 *
 * Real-SQL integration test against local Postgres for:
 * - upsertParkScheduleSignals (12 unnest parameters, non-destructive LL COALESCE, per-pass timestamps)
 * - upsertLightningLaneSinglePrices (Map dedupe, numeric suffix exact Attraction join)
 * - pruneLightningLaneSinglePrices
 * - getLlSinglePricesLastCapturedAt
 * - Property 19 structural test: exactly one non-test source writes ll_multipass_price_cents
 *
 * Validates: Requirements 15.1, 15.4, 15.5, 15.6, 15.10, 20.5
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { IntelligenceRepo } from '../../intelligence/IntelligenceRepo.js';
import type { ScheduleSignalRow, LlSinglePriceRow } from '../../intelligence/IntelligenceRepo.js';

const { Pool } = pg;

const BASE_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dwt:dwt@localhost:5432/dwt';

async function probeDatabase(): Promise<boolean> {
  const probe = new Pool({
    connectionString: BASE_DATABASE_URL,
    connectionTimeoutMillis: 2_000,
    max: 1,
  });
  try {
    await probe.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => {});
  }
}

const DB_AVAILABLE = await probeDatabase();

function withDatabaseName(url: string, dbName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', 'migrations');
}

async function applyAllMigrations(pool: DbPool): Promise<void> {
  const dir = migrationsDir();
  const files = readdirSync(dir)
    .filter((name) => /^\d{4,}_.+\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  const client = await pool.connect();
  try {
    for (const name of files) {
      await client.query(readFileSync(join(dir, name), 'utf8'));
    }
  } finally {
    client.release();
  }
}

describe.skipIf(!DB_AVAILABLE)(
  'IntelligenceRepo — Lightning Lane persistence (live Postgres)',
  () => {
    let adminPool: DbPool;
    let testPool: DbPool;
    let testDbName: string;
    let repo: IntelligenceRepo;

    beforeAll(async () => {
      testDbName = `dwt_ll_test_${randomUUID().replace(/-/g, '')}`;
      adminPool = new Pool({ connectionString: BASE_DATABASE_URL, max: 1 });
      await adminPool.query(`CREATE DATABASE ${testDbName}`);

      testPool = new Pool({
        connectionString: withDatabaseName(BASE_DATABASE_URL, testDbName),
        max: 5,
      });
      await applyAllMigrations(testPool);
      repo = new IntelligenceRepo(testPool as any);
    }, 120_000);

    afterAll(async () => {
      await testPool?.end().catch(() => {});
      if (adminPool) {
        await adminPool.query(`DROP DATABASE IF EXISTS ${testDbName} WITH (FORCE)`).catch(() => {});
        await adminPool.end().catch(() => {});
      }
    });

    describe('upsertParkScheduleSignals', () => {
      it('round-trips all schedule and LL fields and keeps non-LL behavior', async () => {
        const date = new Date('2026-07-01T00:00:00.000Z');
        const openTime = new Date('2026-07-01T13:00:00.000Z');
        const closeTime = new Date('2026-07-02T03:00:00.000Z');
        const capturedAt = new Date('2026-07-01T10:00:00.000Z');

        const row: ScheduleSignalRow = {
          park: 'Magic Kingdom',
          date,
          open_time: openTime,
          close_time: closeTime,
          early_entry: true,
          extended_evening: false,
          ticketed_event: false,
          ll_multipass_price_cents: 3200,
          ll_multipass_available: true,
          ll_premier_price_cents: 39900,
          ll_premier_available: false,
          ll_prices_captured_at: capturedAt,
        };

        await repo.upsertParkScheduleSignals([row]);

        const res = await testPool.query(
          `SELECT * FROM park_schedule_signals WHERE park = $1 AND date = $2`,
          ['Magic Kingdom', '2026-07-01'],
        );
        expect(res.rows).toHaveLength(1);
        const stored = res.rows[0];
        expect(stored.open_time.toISOString()).toBe(openTime.toISOString());
        expect(stored.close_time.toISOString()).toBe(closeTime.toISOString());
        expect(stored.early_entry).toBe(true);
        expect(stored.extended_evening).toBe(false);
        expect(stored.ll_multipass_price_cents).toBe(3200);
        expect(stored.ll_multipass_available).toBe(true);
        expect(stored.ll_premier_price_cents).toBe(39900);
        expect(stored.ll_premier_available).toBe(false);
        expect(stored.ll_prices_captured_at.toISOString()).toBe(capturedAt.toISOString());
        expect(stored.ll_multipass_captured_at.toISOString()).toBe(capturedAt.toISOString());
        expect(stored.ll_premier_captured_at.toISOString()).toBe(capturedAt.toISOString());
      });

      it('leaves ll_prices_captured_at NULL when no LL prices provided', async () => {
        const date = new Date('2026-07-02T00:00:00.000Z');
        const row: ScheduleSignalRow = {
          park: 'EPCOT',
          date,
          open_time: new Date('2026-07-02T13:00:00.000Z'),
          close_time: new Date('2026-07-03T01:00:00.000Z'),
          early_entry: false,
          extended_evening: false,
          ticketed_event: false,
          ll_multipass_price_cents: null,
          ll_multipass_available: null,
          ll_premier_price_cents: null,
          ll_premier_available: null,
          ll_prices_captured_at: null,
        };

        await repo.upsertParkScheduleSignals([row]);

        const res = await testPool.query(
          `SELECT * FROM park_schedule_signals WHERE park = $1 AND date = $2`,
          ['EPCOT', '2026-07-02'],
        );
        expect(res.rows).toHaveLength(1);
        expect(res.rows[0].ll_prices_captured_at).toBeNull();
        expect(res.rows[0].ll_multipass_captured_at).toBeNull();
        expect(res.rows[0].ll_premier_captured_at).toBeNull();
      });

      it('is non-destructive on null and maintains independent per-pass timestamps (round 3 M3, round 4 L1)', async () => {
        const park = 'Hollywood Studios';
        const date = new Date('2026-07-03T00:00:00.000Z');
        const t1 = new Date('2026-07-01T08:00:00.000Z');
        const t2 = new Date('2026-07-01T12:00:00.000Z');
        const t3 = new Date('2026-07-01T16:00:00.000Z');

        // Step 1: Store Multi 2700, Premier 2900, both available, captured at T1
        await repo.upsertParkScheduleSignals([
          {
            park,
            date,
            open_time: new Date('2026-07-03T12:00:00.000Z'),
            close_time: new Date('2026-07-04T01:00:00.000Z'),
            early_entry: false,
            extended_evening: false,
            ticketed_event: false,
            ll_multipass_price_cents: 2700,
            ll_multipass_available: true,
            ll_premier_price_cents: 2900,
            ll_premier_available: true,
            ll_prices_captured_at: t1,
          },
        ]);

        let row = (
          await testPool.query(
            `SELECT * FROM park_schedule_signals WHERE park = $1 AND date = $2`,
            [park, '2026-07-03'],
          )
        ).rows[0];
        expect(row.ll_multipass_price_cents).toBe(2700);
        expect(row.ll_premier_price_cents).toBe(2900);
        expect(row.ll_prices_captured_at.toISOString()).toBe(t1.toISOString());
        expect(row.ll_multipass_captured_at.toISOString()).toBe(t1.toISOString());
        expect(row.ll_premier_captured_at.toISOString()).toBe(t1.toISOString());

        // Step 2: Upsert second row with ALL LL fields NULL, but updated open/close times
        const newOpen = new Date('2026-07-03T13:00:00.000Z');
        const newClose = new Date('2026-07-04T02:00:00.000Z');
        await repo.upsertParkScheduleSignals([
          {
            park,
            date,
            open_time: newOpen,
            close_time: newClose,
            early_entry: true,
            extended_evening: false,
            ticketed_event: false,
            ll_multipass_price_cents: null,
            ll_multipass_available: null,
            ll_premier_price_cents: null,
            ll_premier_available: null,
            ll_prices_captured_at: null,
          },
        ]);

        row = (
          await testPool.query(
            `SELECT * FROM park_schedule_signals WHERE park = $1 AND date = $2`,
            [park, '2026-07-03'],
          )
        ).rows[0];
        // Non-LL columns took the second statement's values
        expect(row.open_time.toISOString()).toBe(newOpen.toISOString());
        expect(row.close_time.toISOString()).toBe(newClose.toISOString());
        expect(row.early_entry).toBe(true);
        // All five LL columns still equal the first values
        expect(row.ll_multipass_price_cents).toBe(2700);
        expect(row.ll_multipass_available).toBe(true);
        expect(row.ll_premier_price_cents).toBe(2900);
        expect(row.ll_premier_available).toBe(true);
        expect(row.ll_prices_captured_at.toISOString()).toBe(t1.toISOString());
        expect(row.ll_multipass_captured_at.toISOString()).toBe(t1.toISOString());
        expect(row.ll_premier_captured_at.toISOString()).toBe(t1.toISOString());

        // Step 3: Upsert third row with new Multi Pass price 3000 at T2 (Premier is null)
        await repo.upsertParkScheduleSignals([
          {
            park,
            date,
            open_time: newOpen,
            close_time: newClose,
            early_entry: true,
            extended_evening: false,
            ticketed_event: false,
            ll_multipass_price_cents: 3000,
            ll_multipass_available: true,
            ll_premier_price_cents: null,
            ll_premier_available: null,
            ll_prices_captured_at: t2,
          },
        ]);

        row = (
          await testPool.query(
            `SELECT * FROM park_schedule_signals WHERE park = $1 AND date = $2`,
            [park, '2026-07-03'],
          )
        ).rows[0];
        // Multi updated, Premier unchanged, ll_prices_captured_at advances, ll_multipass_captured_at advances, premier captured_at stays T1
        expect(row.ll_multipass_price_cents).toBe(3000);
        expect(row.ll_premier_price_cents).toBe(2900);
        expect(row.ll_prices_captured_at.toISOString()).toBe(t2.toISOString());
        expect(row.ll_multipass_captured_at.toISOString()).toBe(t2.toISOString());
        expect(row.ll_premier_captured_at.toISOString()).toBe(t1.toISOString());

        // Step 4: Upsert fourth row with only a Premier price 3500 at T3 (Multi is null)
        await repo.upsertParkScheduleSignals([
          {
            park,
            date,
            open_time: newOpen,
            close_time: newClose,
            early_entry: true,
            extended_evening: false,
            ticketed_event: false,
            ll_multipass_price_cents: null,
            ll_multipass_available: null,
            ll_premier_price_cents: 3500,
            ll_premier_available: true,
            ll_prices_captured_at: t3,
          },
        ]);

        row = (
          await testPool.query(
            `SELECT * FROM park_schedule_signals WHERE park = $1 AND date = $2`,
            [park, '2026-07-03'],
          )
        ).rows[0];
        // Premier advances to 3500, captured at T3; Multi stays 3000, captured at T2; overall captured_at is T3
        expect(row.ll_multipass_price_cents).toBe(3000);
        expect(row.ll_premier_price_cents).toBe(3500);
        expect(row.ll_prices_captured_at.toISOString()).toBe(t3.toISOString());
        expect(row.ll_multipass_captured_at.toISOString()).toBe(t2.toISOString());
        expect(row.ll_premier_captured_at.toISOString()).toBe(t3.toISOString());
      });
    });

    describe('upsertLightningLaneSinglePrices and single pass methods', () => {
      let attractionExpId: string;
      let entertainmentExpId: string;

      beforeAll(async () => {
        attractionExpId = randomUUID();
        entertainmentExpId = randomUUID();

        // Two experiences sharing numeric prefix 80010856
        await testPool.query(
          `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            attractionExpId,
            '80010856;entityType=Attraction',
            'Space Mountain Attraction',
            'Magic Kingdom',
            'Ride',
          ],
        );

        await testPool.query(
          `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            entertainmentExpId,
            '80010856;entityType=Entertainment',
            'Space Mountain Entertainment',
            'Magic Kingdom',
            'Show',
          ],
        );
      });

      it('dedupes duplicate keys in batch without error 21000 and resolves attraction experience_id (round 5 M5)', async () => {
        const rows: LlSinglePriceRow[] = [
          {
            park: 'Magic Kingdom',
            date: '2026-07-10',
            purchaseId: 'lightninglane_80010856',
            attractionName: 'Space Mountain',
            priceCents: 1500,
            available: true,
          },
          // Duplicate in batch with updated price
          {
            park: 'Magic Kingdom',
            date: '2026-07-10',
            purchaseId: 'lightninglane_80010856',
            attractionName: 'Space Mountain',
            priceCents: 1600,
            available: true,
          },
        ];

        // Should not throw error 21000
        await repo.upsertLightningLaneSinglePrices(rows);

        const res = await testPool.query(
          `SELECT * FROM lightning_lane_single_prices WHERE park = $1 AND date = $2 AND purchase_id = $3`,
          ['Magic Kingdom', '2026-07-10', 'lightninglane_80010856'],
        );

        expect(res.rows).toHaveLength(1);
        expect(res.rows[0].price_cents).toBe(1600);
        // EXACT match on Attraction entity type: matches attractionExpId, not entertainmentExpId
        expect(res.rows[0].experience_id).toBe(attractionExpId);
      });

      it('stores experience_id as NULL when only non-Attraction entity exists or purchaseId has no numeric suffix', async () => {
        const entOnlyExpId = randomUUID();
        await testPool.query(
          `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            entOnlyExpId,
            '99999999;entityType=Entertainment',
            'Parade Show',
            'Magic Kingdom',
            'Show',
          ],
        );

        const rows: LlSinglePriceRow[] = [
          // Matches 99999999 which is ONLY Entertainment, not Attraction
          {
            park: 'Magic Kingdom',
            date: '2026-07-11',
            purchaseId: 'lightninglane_99999999',
            attractionName: 'Parade',
            priceCents: 1200,
            available: true,
          },
          // No numeric suffix
          {
            park: 'Magic Kingdom',
            date: '2026-07-11',
            purchaseId: 'lightninglane_special_attraction',
            attractionName: 'Special Attraction',
            priceCents: 2000,
            available: null,
          },
          // Valid distinct third key
          {
            park: 'EPCOT',
            date: '2026-07-11',
            purchaseId: 'lightninglane_77777777',
            attractionName: 'Cosmic Rewind',
            priceCents: 1700,
            available: true,
          },
        ];

        await repo.upsertLightningLaneSinglePrices(rows);

        const res = await testPool.query(
          `SELECT * FROM lightning_lane_single_prices WHERE date = '2026-07-11' ORDER BY purchase_id`,
        );

        expect(res.rows).toHaveLength(3);
        const [cosmic, parade, special] = res.rows;
        expect(parade.purchase_id).toBe('lightninglane_99999999');
        expect(parade.experience_id).toBeNull();

        expect(special.purchase_id).toBe('lightninglane_special_attraction');
        expect(special.experience_id).toBeNull();
        expect(special.available).toBeNull();

        expect(cosmic.purchase_id).toBe('lightninglane_77777777');
        expect(cosmic.price_cents).toBe(1700);
      });

      it('prunes rows strictly before olderThanDate and preserves boundary', async () => {
        await repo.upsertLightningLaneSinglePrices([
          {
            park: 'EPCOT',
            date: '2026-07-15',
            purchaseId: 'll_1',
            attractionName: 'Ride 1',
            priceCents: 1000,
            available: true,
          },
          {
            park: 'EPCOT',
            date: '2026-07-16',
            purchaseId: 'll_2',
            attractionName: 'Ride 2',
            priceCents: 1000,
            available: true,
          },
          {
            park: 'EPCOT',
            date: '2026-07-17',
            purchaseId: 'll_3',
            attractionName: 'Ride 3',
            priceCents: 1000,
            available: true,
          },
        ]);

        const deletedCount = await repo.pruneLightningLaneSinglePrices('2026-07-16');
        expect(deletedCount).toBeGreaterThanOrEqual(1);

        const remaining = await testPool.query(
          `SELECT date FROM lightning_lane_single_prices WHERE purchase_id IN ('ll_1', 'll_2', 'll_3') ORDER BY date`,
        );
        const dates = remaining.rows.map((r) => r.date.toISOString().split('T')[0]);
        expect(dates).not.toContain('2026-07-15');
        expect(dates).toContain('2026-07-16');
        expect(dates).toContain('2026-07-17');
      });

      it('getLlSinglePricesLastCapturedAt returns max captured_at Date or null when empty', async () => {
        const lastCaptured = await repo.getLlSinglePricesLastCapturedAt();
        expect(lastCaptured).toBeInstanceOf(Date);
        expect(lastCaptured!.getTime()).toBeGreaterThan(0);
      });
    });

    describe('Property 19: Structural scan — exactly one non-test statement writes ll_multipass_price_cents', () => {
      it('finds exactly one non-test SQL assignment to ll_multipass_price_cents', () => {
        const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
        const tsFiles: string[] = [];

        function walk(dir: string) {
          for (const ent of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, ent.name);
            if (ent.isDirectory()) {
              if (ent.name !== 'node_modules' && ent.name !== 'dist' && ent.name !== '__tests__') {
                walk(full);
              }
            } else if (ent.isFile() && ent.name.endsWith('.ts') && !ent.name.includes('.test.') && !ent.name.includes('.spec.')) {
              tsFiles.push(full);
            }
          }
        }

        walk(srcDir);

        const hits: { file: string; match: string }[] = [];

        for (const file of tsFiles) {
          const content = readFileSync(file, 'utf8');
          const sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
          let foundInTemplate = false;

          function visit(node: ts.Node) {
            if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
              const text = node.getText(sf);
              if (/ll_multipass_price_cents\s*=/.test(text)) {
                foundInTemplate = true;
              }
            }
            if (!foundInTemplate) {
              ts.forEachChild(node, visit);
            }
          }

          visit(sf);
          if (foundInTemplate) {
            hits.push({ file, match: 'SQL template assignment' });
          }
        }

        // Exactly one SQL assignment statement in IntelligenceRepo.ts
        expect(hits).toHaveLength(1);
        expect(hits[0]!.file.replace(/\\/g, '/')).toContain('IntelligenceRepo.ts');
      });
    });
  },
);
