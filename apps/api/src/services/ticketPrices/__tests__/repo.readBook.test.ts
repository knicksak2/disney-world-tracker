/**
 * Feature: trip-budget, Requirement 14: Ticket Prices readBook Repo Tests (pg-mem)
 *
 * Validates: Requirements 11.6, 11.7, 14.3, 14.4, 20.6
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import { addDays } from '../dates.js';
import { createTicketPricesRepo, type TicketPricesRepo } from '../repo.js';
import type { TicketPriceKey } from '../types.js';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'migrations');
const MIGRATION_TARGET = '0065_ticket_prices.sql';

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
  db.public.none(sql);
}

describe('TicketPricesRepo.readBook (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: any;
  let repo: TicketPricesRepo;

  const today = '2026-10-25';
  const horizon = '2027-10-25';

  beforeEach(async () => {
    db = buildPgMemDatabase();
    for (const name of migrationNames().filter((n) => n <= MIGRATION_TARGET)) {
      applyMigration(db, name);
    }
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool();
    repo = createTicketPricesRepo(pool);
  });

  it('a set with rows on 40 dates returns all 40 for the key and not only the exact start_date', async () => {
    // Seed set
    await pool.query(
      `INSERT INTO ticket_price_sets (discount_group, num_days, as_of, horizon_date, row_count, window_days)
       VALUES ('std-gst', 4, now(), $1::date, 40, 40)`,
      [horizon],
    );

    // Seed 40 rows across 40 dates
    for (let i = 0; i < 40; i++) {
      const d = addDays(today, i);
      await pool.query(
        `INSERT INTO ticket_prices (discount_group, num_days, age_group, option_code, park, start_date, price_cents, tax_cents, valid_end_date, product_id)
         VALUES ('std-gst', 4, 'adult', 'base', 'any', $1::date, $2, 3000, $3::date, 'prod_id')`,
        [d, 50000 + i * 100, addDays(d, 7)],
      );
    }

    const key: TicketPriceKey = {
      discountGroup: 'std-gst',
      numDays: 4,
      ageGroup: 'adult',
      optionCode: 'base',
    };

    const book = await repo.readBook([key], today);
    expect(book.rows).toHaveLength(40);
    expect(book.sets).toHaveLength(1);
    expect(book.sets[0]?.numDays).toBe(4);
    expect(book.control).not.toBeNull();
  });

  it('rows before today and after horizon_date are excluded', async () => {
    await pool.query(
      `INSERT INTO ticket_price_sets (discount_group, num_days, as_of, horizon_date, row_count, window_days)
       VALUES ('std-gst', 4, now(), '2026-11-10'::date, 5, 5)`,
    );

    // 1 row before today
    await pool.query(
      `INSERT INTO ticket_prices (discount_group, num_days, age_group, option_code, park, start_date, price_cents, tax_cents, valid_end_date, product_id)
       VALUES ('std-gst', 4, 'adult', 'base', 'any', '2026-10-24'::date, 50000, 3000, '2026-10-31'::date, 'prod_past')`,
    );

    // 1 row on today
    await pool.query(
      `INSERT INTO ticket_prices (discount_group, num_days, age_group, option_code, park, start_date, price_cents, tax_cents, valid_end_date, product_id)
       VALUES ('std-gst', 4, 'adult', 'base', 'any', '2026-10-25'::date, 50000, 3000, '2026-10-31'::date, 'prod_today')`,
    );

    // 1 row within horizon
    await pool.query(
      `INSERT INTO ticket_prices (discount_group, num_days, age_group, option_code, park, start_date, price_cents, tax_cents, valid_end_date, product_id)
       VALUES ('std-gst', 4, 'adult', 'base', 'any', '2026-11-05'::date, 50000, 3000, '2026-11-12'::date, 'prod_within')`,
    );

    // 1 row after horizon (2026-11-15 > 2026-11-10)
    await pool.query(
      `INSERT INTO ticket_prices (discount_group, num_days, age_group, option_code, park, start_date, price_cents, tax_cents, valid_end_date, product_id)
       VALUES ('std-gst', 4, 'adult', 'base', 'any', '2026-11-15'::date, 50000, 3000, '2026-11-22'::date, 'prod_beyond')`,
    );

    const key: TicketPriceKey = {
      discountGroup: 'std-gst',
      numDays: 4,
      ageGroup: 'adult',
      optionCode: 'base',
    };

    const book = await repo.readBook([key], today);
    expect(book.rows).toHaveLength(2);
    expect(book.rows.map((r) => r.startDate).sort()).toEqual(['2026-10-25', '2026-11-05']);
  });

  it('1-day base rows are filtered to requested park codes (mk, ep when requested; all 4 when unparked)', async () => {
    await pool.query(
      `INSERT INTO ticket_price_sets (discount_group, num_days, as_of, horizon_date, row_count, window_days)
       VALUES ('std-gst', 1, now(), '2026-12-31'::date, 4, 4)`,
    );

    const parks = ['mk', 'ep', 'hs', 'ak'] as const;
    for (const p of parks) {
      await pool.query(
        `INSERT INTO ticket_prices (discount_group, num_days, age_group, option_code, park, start_date, price_cents, tax_cents, valid_end_date, product_id)
         VALUES ('std-gst', 1, 'adult', 'base', $1, '2026-11-01'::date, 15000, 1000, '2026-11-01'::date, 'prod_1d')`,
        [p],
      );
    }

    // Specific park requested: mk only
    const mkKey: TicketPriceKey = {
      discountGroup: 'std-gst',
      numDays: 1,
      ageGroup: 'adult',
      optionCode: 'base',
      park: 'mk',
    };
    const bookMk = await repo.readBook([mkKey], today);
    expect(bookMk.rows).toHaveLength(1);
    expect(bookMk.rows[0]?.park).toBe('mk');

    // Unparked key: returns all 4 parks
    const unparkedKey: TicketPriceKey = {
      discountGroup: 'std-gst',
      numDays: 1,
      ageGroup: 'adult',
      optionCode: 'base',
    };
    const bookAll = await repo.readBook([unparkedKey], today);
    expect(bookAll.rows).toHaveLength(4);
    expect(bookAll.rows.map((r) => r.park).sort()).toEqual(['ak', 'ep', 'hs', 'mk']);
  });

  it('a key whose set has no horizon_date loads nothing', async () => {
    // Set exists but horizon_date is NULL
    await pool.query(
      `INSERT INTO ticket_price_sets (discount_group, num_days, as_of, horizon_date, row_count, window_days)
       VALUES ('std-gst', 5, now(), NULL, NULL, NULL)`,
    );

    await pool.query(
      `INSERT INTO ticket_prices (discount_group, num_days, age_group, option_code, park, start_date, price_cents, tax_cents, valid_end_date, product_id)
       VALUES ('std-gst', 5, 'adult', 'base', 'any', '2026-11-01'::date, 60000, 4000, '2026-11-08'::date, 'prod_5d')`,
    );

    const key: TicketPriceKey = {
      discountGroup: 'std-gst',
      numDays: 5,
      ageGroup: 'adult',
      optionCode: 'base',
    };

    const book = await repo.readBook([key], today);
    expect(book.rows).toHaveLength(0);
  });
});
