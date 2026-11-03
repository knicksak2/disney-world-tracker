/**
 * Feature: trip-budget, Requirement 15: Lightning Lane Read Repo
 *
 * Validates: Requirements 15.7, 15.8, 20.6
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { LlPriceRef } from '@dwt/shared';
import type { DbPool } from '../../../db/pool.js';
import { createLightningLaneRepo, type LightningLaneRepo } from '../repo.js';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'migrations');
const MIGRATION_TARGET = '0066_lightning_lane_prices.sql';

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
  db.public.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  db.public.registerFunction({
    name: 'lower',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.toLowerCase() : ''),
  });
  db.public.registerFunction({
    name: 'trim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.trim() : ''),
  });
  db.public.registerFunction({
    name: 'btrim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.trim() : ''),
  });
  db.public.registerFunction({
    name: 'length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  return db;
}

function migrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((n) => /^\d{4}_.*\.sql$/u.test(n))
    .sort((a, b) => a.localeCompare(b));
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  sql = sql.replace(/CREATE INDEX[^;]+ON lightning_lane_single_prices[^;]+;/gms, '');
  db.public.none(sql);
}

describe('LightningLaneRepo.readBook (pg-mem)', () => {
  let db: IMemoryDb;
  let rawPool: any;
  let countingPool: DbPool;
  let statementCount: number;
  let repo: LightningLaneRepo;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    for (const name of migrationNames().filter((n) => n <= MIGRATION_TARGET)) {
      applyMigration(db, name);
    }
    const { Pool: PgMemPool } = db.adapters.createPg();
    rawPool = new PgMemPool();

    statementCount = 0;
    countingPool = {
      query: async (text: any, params?: any) => {
        statementCount++;
        return rawPool.query(text, params);
      },
      connect: async () => {
        const client = await rawPool.connect();
        return {
          query: async (t: any, p?: any) => {
            statementCount++;
            return client.query(t, p);
          },
          release: () => client.release(),
        };
      },
    } as any;

    repo = createLightningLaneRepo(countingPool) as LightningLaneRepo;
  });

  it('statement count is constant (exactly 2) for 1 key and for 40 keys', async () => {
    // 1 key
    const oneKey: LlPriceRef[] = [
      { kind: 'll', park: 'Magic Kingdom', date: '2026-07-02', passType: 'multi' },
    ];
    statementCount = 0;
    await repo.readBook(oneKey, '2026-07-01');
    expect(statementCount).toBe(2);

    // 40 keys across multiple parks, dates, pass types
    const fortyKeys: LlPriceRef[] = [];
    const parks: LlPriceRef['park'][] = ['Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom'];
    for (let i = 1; i <= 10; i++) {
      const day = String(i).padStart(2, '0');
      for (const park of parks) {
        fortyKeys.push({
          kind: 'll',
          park,
          date: `2026-07-${day}`,
          passType: i % 2 === 0 ? 'multi' : 'premier',
        });
      }
    }
    expect(fortyKeys).toHaveLength(40);

    statementCount = 0;
    await repo.readBook(fortyKeys, '2026-07-01');
    expect(statementCount).toBe(2);
  });

  it('history excludes today and later dates', async () => {
    const today = '2026-07-01';

    // Seed past dates, today, and future date
    await rawPool.query(`
      INSERT INTO park_schedule_signals (
        park, date, ll_multipass_price_cents, ll_multipass_captured_at
      ) VALUES
        ('Magic Kingdom', '2026-06-10', 2500, '2026-06-10T12:00:00Z'),
        ('Magic Kingdom', '2026-06-20', 2700, '2026-06-20T12:00:00Z'),
        ('Magic Kingdom', '2026-07-01', 3000, '2026-07-01T12:00:00Z'),
        ('Magic Kingdom', '2026-07-15', 3500, '2026-07-15T12:00:00Z')
    `);

    const book = await repo.readBook(
      [{ kind: 'll', park: 'Magic Kingdom', date: '2026-07-15', passType: 'multi' }],
      today,
    );

    const mkHistory = book.history.get('multi|Magic Kingdom|');
    expect(mkHistory).toBeDefined();
    // Only June 10 and June 20 are in history (< 2026-07-01)
    expect(mkHistory?.map((h) => h.date)).toEqual(['2026-06-10', '2026-06-20']);
    expect(mkHistory?.map((h) => h.cents)).toEqual([2500, 2700]);
  });

  it('yields multi and premier StoredLlRow with independent capturedAt values from the same date', async () => {
    const T1 = '2026-07-01T10:00:00.000Z';
    const T2 = '2026-07-01T14:30:00.000Z';

    await rawPool.query(`
      INSERT INTO park_schedule_signals (
        park, date,
        ll_multipass_price_cents, ll_multipass_available, ll_multipass_captured_at,
        ll_premier_price_cents, ll_premier_available, ll_premier_captured_at
      ) VALUES (
        'Magic Kingdom', '2026-07-02',
        2800, true, '${T1}',
        39900, false, '${T2}'
      )
    `);

    const book = await repo.readBook(
      [
        { kind: 'll', park: 'Magic Kingdom', date: '2026-07-02', passType: 'multi' },
        { kind: 'll', park: 'Magic Kingdom', date: '2026-07-02', passType: 'premier' },
      ],
      '2026-07-01',
    );

    expect(book.stored).toHaveLength(2);
    const multiRow = book.stored.find((s) => s.passType === 'multi');
    const premierRow = book.stored.find((s) => s.passType === 'premier');

    expect(multiRow).toBeDefined();
    expect(multiRow?.cents).toBe(2800);
    expect(multiRow?.available).toBe(true);
    expect(multiRow?.capturedAt.toISOString()).toBe(T1);

    expect(premierRow).toBeDefined();
    expect(premierRow?.cents).toBe(39900);
    expect(premierRow?.available).toBe(false);
    expect(premierRow?.capturedAt.toISOString()).toBe(T2);
  });

  it('legacy row with NULL capturedAt is omitted from stored but feeds history', async () => {
    // Legacy row before migration 0066: price is present, captured_at is NULL
    await rawPool.query(`
      INSERT INTO park_schedule_signals (
        park, date, ll_multipass_price_cents, ll_multipass_captured_at
      ) VALUES (
        'EPCOT', '2026-06-15', 2100, NULL
      )
    `);

    const book = await repo.readBook(
      [{ kind: 'll', park: 'EPCOT', date: '2026-06-15', passType: 'multi' }],
      '2026-07-01',
    );

    // Stored is empty because captured_at is NULL
    expect(book.stored).toHaveLength(0);

    // History includes the legacy row price
    const epHistory = book.history.get('multi|EPCOT|');
    expect(epHistory).toBeDefined();
    expect(epHistory).toEqual([{ date: '2026-06-15', cents: 2100 }]);
  });

  it('handles single pass stored rows and history rows with experienceId', async () => {
    const expId = randomUUID();
    const T = '2026-07-01T08:00:00.000Z';

    // Seed experience
    await rawPool.query(`
      INSERT INTO experiences (id, upstream_entity_id, park, category, name)
      VALUES ('${expId}', '12345;entityType=Attraction', 'Magic Kingdom', 'Ride', 'Space Mountain')
    `);

    // Single pass in past (history)
    await rawPool.query(`
      INSERT INTO lightning_lane_single_prices (
        park, date, experience_id, purchase_id, attraction_name, price_cents, available, captured_at
      ) VALUES (
        'Magic Kingdom', '2026-06-15', '${expId}', 'lightninglane_12345', 'Space Mountain', 1400, true, '2026-06-15T10:00:00Z'
      )
    `);

    // Single pass on target date (stored)
    await rawPool.query(`
      INSERT INTO lightning_lane_single_prices (
        park, date, experience_id, purchase_id, attraction_name, price_cents, available, captured_at
      ) VALUES (
        'Magic Kingdom', '2026-07-05', '${expId}', 'lightninglane_12345', 'Space Mountain', 1600, true, '${T}'
      )
    `);

    const book = await repo.readBook(
      [
        {
          kind: 'll',
          park: 'Magic Kingdom',
          date: '2026-07-05',
          passType: 'single',
          experienceId: expId,
        },
      ],
      '2026-07-01',
    );

    expect(book.stored).toHaveLength(1);
    expect(book.stored[0]).toMatchObject({
      passType: 'single',
      park: 'Magic Kingdom',
      date: '2026-07-05',
      experienceId: expId,
      purchaseId: 'lightninglane_12345',
      cents: 1600,
      available: true,
    });
    expect(book.stored[0]?.capturedAt.toISOString()).toBe(T);

    const singleHistory = book.history.get(`single|Magic Kingdom|${expId}`);
    expect(singleHistory).toBeDefined();
    expect(singleHistory).toEqual([{ date: '2026-06-15', cents: 1400 }]);
  });

  it('B4 / N-b: excludes history rows older than the lower bound across multi, premier, and single selects (date < today - lookbackDays)', async () => {
    // today is 2026-07-01, lookbackDays is 10 -> lower bound is 2026-06-21
    // Seed rows for:
    // 1. multi & premier (park_schedule_signals)
    // 2. single (lightning_lane_single_prices)
    const expId = '55555555-5555-4555-8555-555555555555';
    await rawPool.query(`
      INSERT INTO experiences (id, upstream_entity_id, park, category, name)
      VALUES ('${expId}', '54321;entityType=Attraction', 'Magic Kingdom', 'Ride', 'Big Thunder Mountain')
    `);

    // 2026-06-25: within 10-day lookback -> included
    // 2026-06-15: older than 10-day lookback (16 days ago) -> excluded!
    await rawPool.query(`
      INSERT INTO park_schedule_signals (
        park, date, ll_multipass_price_cents, ll_multipass_captured_at,
        ll_premier_price_cents, ll_premier_captured_at
      ) VALUES
        ('Magic Kingdom', '2026-06-25', 2500, '2026-06-25T08:00:00Z', 35000, '2026-06-25T08:00:00Z'),
        ('Magic Kingdom', '2026-06-15', 2200, '2026-06-15T08:00:00Z', 30000, '2026-06-15T08:00:00Z')
    `);

    await rawPool.query(`
      INSERT INTO lightning_lane_single_prices (
        park, date, experience_id, purchase_id, attraction_name, price_cents, available, captured_at
      ) VALUES
        ('Magic Kingdom', '2026-06-25', '${expId}', 'lightninglane_54321', 'Big Thunder Mountain', 1500, true, '2026-06-25T10:00:00Z'),
        ('Magic Kingdom', '2026-06-15', '${expId}', 'lightninglane_54321', 'Big Thunder Mountain', 1400, true, '2026-06-15T10:00:00Z')
    `);

    const book = await repo.readBook(
      [
        {
          kind: 'll',
          park: 'Magic Kingdom',
          date: '2026-07-05',
          passType: 'multi',
        },
        {
          kind: 'll',
          park: 'Magic Kingdom',
          date: '2026-07-05',
          passType: 'premier',
        },
        {
          kind: 'll',
          park: 'Magic Kingdom',
          date: '2026-07-05',
          passType: 'single',
          experienceId: expId,
        },
      ],
      '2026-07-01',
      10, // lookbackDays = 10
    );

    // Multi: 2026-06-25 included, 2026-06-15 excluded
    const multiHistory = book.history.get('multi|Magic Kingdom|');
    expect(multiHistory).toBeDefined();
    expect(multiHistory).toEqual([{ date: '2026-06-25', cents: 2500 }]);

    // Premier: 2026-06-25 included, 2026-06-15 excluded
    const premierHistory = book.history.get('premier|Magic Kingdom|');
    expect(premierHistory).toBeDefined();
    expect(premierHistory).toEqual([{ date: '2026-06-25', cents: 35000 }]);

    // Single: 2026-06-25 included, 2026-06-15 excluded
    const singleHistory = book.history.get(`single|Magic Kingdom|${expId}`);
    expect(singleHistory).toBeDefined();
    expect(singleHistory).toEqual([{ date: '2026-06-25', cents: 1500 }]);
  });
});