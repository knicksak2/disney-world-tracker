/**
 * Migration test for `0073_trip_lodging_stays.sql` (pg-mem), plus a pg-mem run of the data-only backfill
 * `0074_trip_stays_backfill.sql` (the real-Postgres coverage of the backfill is `migration0074.livedb.test.ts`).
 *
 * Validates: trip-lodging-stays Requirements 1.1, 1.2, 1.7, 6.3, 10.1, 10.2, 10.3, 10.4, 10.5, 11.1
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

const DDL_FILE = '0073_trip_lodging_stays.sql';
const BACKFILL_FILE = '0074_trip_stays_backfill.sql';
const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'migrations');

function jsonbTypeof(val: unknown): string {
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
  if (typeof parsed === 'string') return 'string';
  if (typeof parsed === 'number') return 'number';
  if (typeof parsed === 'boolean') return 'boolean';
  return 'null';
}

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
  // Exactly the functions accountDeletion/__tests__/helpers.ts registers: 0073 must need nothing more.
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
  db.public.registerFunction({
    name: 'jsonb_typeof',
    args: [DataType.jsonb],
    returns: DataType.text,
    implementation: jsonbTypeof,
  });
  return db;
}

function migrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((n) => /^\d{4}_.*\.sql$/u.test(n))
    .sort((a, b) => a.localeCompare(b));
}

function applyMigration(db: IMemoryDb, name: string): void {
  // Pure data backfills 0070 and 0071 need correlated subqueries that pg-mem cannot evaluate.
  if (/^00(70|71)_backfill/u.test(name)) return;
  let sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

interface Pool {
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>>; rowCount?: number | null }>;
}

describe('migration 0073_trip_lodging_stays (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: Pool;
  let userId: string;
  let tripId: string;
  let resortId: string;

  async function insertStay(overrides: Record<string, unknown> = {}): Promise<string> {
    const row: Record<string, unknown> = {
      id: randomUUID(),
      trip_id: tripId,
      lodging_kind: 'resort',
      resort_id: resortId,
      ...overrides,
    };
    const cols = Object.keys(row);
    await pool.query(
      `INSERT INTO trip_stays (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
      cols.map((c) => row[c]),
    );
    return row['id'] as string;
  }

  async function expectRejected(overrides: Record<string, unknown>): Promise<void> {
    await expect(insertStay(overrides)).rejects.toThrow();
  }

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    // Everything before 0073, then 0073 itself.
    for (const name of migrationNames().filter((n) => n <= DDL_FILE)) {
      applyMigration(db, name);
    }

    userId = randomUUID();
    await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ('${userId}', 'stays@example.com', 'hash')`);
    tripId = randomUUID();
    await pool.query(
      `INSERT INTO trips (id, creator_id, name, description, start_date, end_date)
       VALUES ('${tripId}', '${userId}', 'Test', '', '2027-03-10', '2027-03-17')`,
    );
    resortId = randomUUID();
    await pool.query(
      `INSERT INTO resorts (id, upstream_entity_id, name) VALUES ('${resortId}', 'res-${resortId}', 'Pop Century')`,
    );
  });

  describe('table and constraints', () => {
    it('accepts a dated resort stay, an undated resort stay, a dated off-site stay and party keys', async () => {
      await insertStay({ check_in: '2027-03-10', check_out: '2027-03-14' });
      await insertStay({}); // undated
      await insertStay({
        lodging_kind: 'offsite',
        resort_id: null,
        place_name: 'Hampton Inn',
        check_in: '2027-03-14',
        check_out: '2027-03-17',
      });
      await insertStay({ party_keys: JSON.stringify(['m:abc', 'g:def']) });
      const res = await pool.query(`SELECT count(*) AS n FROM trip_stays`);
      expect(Number(res.rows[0]?.['n'])).toBe(4);
    });

    it('applies the column defaults', async () => {
      const id = await insertStay({});
      const res = await pool.query(`SELECT position, check_in, check_out, party_keys, created_at FROM trip_stays WHERE id = $1`, [id]);
      expect(res.rows[0]).toMatchObject({ position: 0, check_in: null, check_out: null, party_keys: null });
      expect(res.rows[0]?.['created_at']).toBeTruthy();
    });

    it('rejects a resort stay without a resort id, or with a place name', async () => {
      await expectRejected({ resort_id: null });
      await expectRejected({ place_name: 'Room 4412' });
    });

    it('rejects an off-site or partner stay with a resort id, or without a place name', async () => {
      await expectRejected({ lodging_kind: 'offsite', place_name: 'Hampton Inn' }); // resort_id still set
      await expectRejected({ lodging_kind: 'offsite', resort_id: null }); // no place_name
      await expectRejected({ lodging_kind: 'partner_hotel', resort_id: null, place_name: '   ' }); // blank after trim
    });

    it('rejects a lodging kind outside the set and a position outside 0..7', async () => {
      await expectRejected({ lodging_kind: 'cruise', resort_id: null, place_name: 'Ship' });
      await expectRejected({ position: 8 });
      await expectRejected({ position: -1 });
    });

    it('rejects a single date, equal dates and inverted dates', async () => {
      await expectRejected({ check_in: '2027-03-10' });
      await expectRejected({ check_out: '2027-03-14' });
      await expectRejected({ check_in: '2027-03-10', check_out: '2027-03-10' });
      await expectRejected({ check_in: '2027-03-14', check_out: '2027-03-10' });
    });

    it('rejects party keys that are not a JSON array', async () => {
      await expectRejected({ party_keys: JSON.stringify({ m: 'abc' }) });
      await expectRejected({ party_keys: JSON.stringify('m:abc') });
    });

    it('rejects a stay for a trip that does not exist', async () => {
      await expectRejected({ trip_id: randomUUID() });
    });

    it('stores a place name of exactly 100 characters and rejects 101', async () => {
      await insertStay({ lodging_kind: 'offsite', resort_id: null, place_name: 'x'.repeat(100) });
      await expectRejected({ lodging_kind: 'offsite', resort_id: null, place_name: 'x'.repeat(101) });
    });
  });

  describe('references', () => {
    it('deletes a trip together with its stays', async () => {
      await insertStay({});
      await insertStay({ lodging_kind: 'offsite', resort_id: null, place_name: 'Hampton Inn' });
      await pool.query(`DELETE FROM trips WHERE id = $1`, [tripId]);
      const res = await pool.query(`SELECT count(*) AS n FROM trip_stays`);
      expect(Number(res.rows[0]?.['n'])).toBe(0);
    });

    it('blocks deleting a resort that a stay references', async () => {
      await insertStay({});
      await expect(pool.query(`DELETE FROM resorts WHERE id = $1`, [resortId])).rejects.toThrow();
      const res = await pool.query(`SELECT count(*) AS n FROM resorts WHERE id = $1`, [resortId]);
      expect(Number(res.rows[0]?.['n'])).toBe(1);
    });

    it('allows deleting a resort that no stay references', async () => {
      await insertStay({ lodging_kind: 'offsite', resort_id: null, place_name: 'Hampton Inn' });
      await pool.query(`DELETE FROM resorts WHERE id = $1`, [resortId]);
      const res = await pool.query(`SELECT count(*) AS n FROM resorts WHERE id = $1`, [resortId]);
      expect(Number(res.rows[0]?.['n'])).toBe(0);
    });
  });

  describe('pg-mem compatibility guards', () => {
    it('returns rows whose resort_id and dates are NULL to an unpredicated select', async () => {
      // A non-unique partial index (WHERE col IS NOT NULL) makes pg-mem hide these rows; 0073 uses plain indexes.
      const offsite = await insertStay({ lodging_kind: 'offsite', resort_id: null, place_name: 'Hampton Inn' });
      const undated = await insertStay({});
      const res = await pool.query(`SELECT id FROM trip_stays`);
      const ids = res.rows.map((r) => r['id']);
      expect(ids).toContain(offsite);
      expect(ids).toContain(undated);
      const byResortNull = await pool.query(`SELECT id FROM trip_stays WHERE resort_id IS NULL`);
      expect(byResortNull.rows.map((r) => r['id'])).toEqual([offsite]);
    });

    it('is idempotent: applying the file again changes nothing and loses no row', async () => {
      const id = await insertStay({});
      applyMigration(db, DDL_FILE);
      const res = await pool.query(`SELECT id FROM trip_stays`);
      expect(res.rows.map((r) => r['id'])).toEqual([id]);
    });

    it('uses no SQL function the shared pg-mem harness does not register', () => {
      const sql = readFileSync(resolve(MIGRATIONS_DIR, DDL_FILE), 'utf8')
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');
      expect(sql).not.toMatch(/jsonb_array_length/iu);
      expect(sql).not.toMatch(/NULLS\s+(FIRST|LAST)/iu);
      // No non-unique partial index.
      expect(sql).not.toMatch(/CREATE\s+INDEX[^;]*\bWHERE\b/iu);
      expect(sql).not.toMatch(/REFERENCES\s+users\b/iu); // person keys are plain text (account deletion needs no entry)
    });
  });

  describe('0074 backfill on pg-mem', () => {
    it('uses no construct pg-mem ignores or lacks (HAVING, window functions, substr, correlated lookups)', () => {
      const sql = readFileSync(resolve(MIGRATIONS_DIR, BACKFILL_FILE), 'utf8')
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');
      expect(sql).not.toMatch(/\bHAVING\b/iu); // pg-mem silently drops HAVING
      expect(sql).not.toMatch(/\bOVER\s*\(/iu);
      expect(sql).not.toMatch(/\bsubstr\s*\(/iu);
    });

    async function seedResort(name: string): Promise<string> {
      const id = randomUUID();
      await pool.query(`INSERT INTO resorts (id, upstream_entity_id, name) VALUES ('${id}', 'res-${id}', '${name}')`);
      return id;
    }

    async function seedTrip(start: string, end: string): Promise<string> {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO trips (id, creator_id, name, description, start_date, end_date)
         VALUES ('${id}', '${userId}', 'Trip', '', '${start}', '${end}')`,
      );
      return id;
    }

    function runBackfill(): void {
      db.public.none(readFileSync(resolve(MIGRATIONS_DIR, BACKFILL_FILE), 'utf8'));
    }

    it('applies cleanly to an empty database', () => {
      expect(() => runBackfill()).not.toThrow();
    });

    it('backfills a single-resort trip, a multi-resort trip, ignores a trip with no resort, and is idempotent', async () => {
      const single = await seedTrip('2027-04-01', '2027-04-08');
      await pool.query(`INSERT INTO trip_resorts (trip_id, resort_id) VALUES ('${single}', '${resortId}')`);

      const multi = await seedTrip('2027-05-01', '2027-05-08');
      const beach = await seedResort('Beach Club');
      const allStar = await seedResort('All-Star Movies');
      await pool.query(`INSERT INTO trip_resorts (trip_id, resort_id) VALUES ('${multi}', '${beach}'), ('${multi}', '${allStar}')`);

      const none = await seedTrip('2027-06-01', '2027-06-08');

      runBackfill();

      const singleRows = await pool.query(
        `SELECT lodging_kind, resort_id, check_in, check_out FROM trip_stays WHERE trip_id = '${single}'`,
      );
      expect(singleRows.rows).toHaveLength(1);
      expect(singleRows.rows[0]).toMatchObject({ lodging_kind: 'resort', resort_id: resortId });
      // pg-mem returns DATE columns as Date objects at UTC midnight; compare calendar dates in UTC.
      const ymd = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
      expect(ymd(singleRows.rows[0]?.['check_in'])).toBe('2027-04-01');
      expect(ymd(singleRows.rows[0]?.['check_out'])).toBe('2027-04-08');

      const multiRows = await pool.query(
        `SELECT resort_id, position, check_in FROM trip_stays WHERE trip_id = '${multi}' ORDER BY position`,
      );
      expect(multiRows.rows.map((r) => r['resort_id'])).toEqual([allStar, beach]);
      expect(multiRows.rows.map((r) => r['position'])).toEqual([0, 1]);
      expect(multiRows.rows.every((r) => r['check_in'] === null)).toBe(true);

      const noneRows = await pool.query(`SELECT id FROM trip_stays WHERE trip_id = '${none}'`);
      expect(noneRows.rows).toHaveLength(0);

      const before = await pool.query(`SELECT id, trip_id, position, resort_id FROM trip_stays ORDER BY id`);
      runBackfill();
      const after = await pool.query(`SELECT id, trip_id, position, resort_id FROM trip_stays ORDER BY id`);
      expect(after.rows).toEqual(before.rows);
      expect(after.rows).toHaveLength(3);
    });
  });
});
