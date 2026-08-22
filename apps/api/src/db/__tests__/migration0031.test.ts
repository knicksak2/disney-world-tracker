import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

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

  return db;
}

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

const BASE_MIGRATIONS = [
  '0001_init.sql',
  '0015_trips.sql',
  '0019_planned_item_scheduling.sql',
  '0024_planned_item_optimization_result.sql',
  '0027_planned_items_soft_windows.sql',
  '0028_planned_items_meal_period_snack.sql',
  '0031_planned_item_reservations.sql',
];

/** A valid Reservation row: anchored to both a date and a time. */
function insertReservation(
  db: IMemoryDb,
  tripId: string,
  userId: string,
  columns: Record<string, string>,
): string {
  const itemId = randomUUID();
  const base: Record<string, string> = {
    id: `'${itemId}'`,
    trip_id: `'${tripId}'`,
    added_by: `'${userId}'`,
    experience_id: 'NULL',
    item_type: `'break'`,
    planned_date: `'2026-10-02'`,
    planned_time: `'2026-10-02T22:00:00Z'`,
    ...columns,
  };
  const names = Object.keys(base).join(', ');
  const values = Object.values(base).join(', ');
  db.public.none(`INSERT INTO planned_items (${names}) VALUES (${values});`);
  return itemId;
}

describe('migration 0031_planned_item_reservations', () => {
  let db: IMemoryDb;
  let tripId: string;
  let userId: string;

  beforeEach(() => {
    db = buildPgMemDatabase();
    for (const name of BASE_MIGRATIONS) {
      applyMigration(db, name);
    }

    userId = randomUUID();
    tripId = randomUUID();

    db.public.none(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${userId}', 'alice@example.com', 'hash123');
      INSERT INTO profiles (user_id, display_name)
      VALUES ('${userId}', 'Alice');
    `);

    db.public.none(`
      INSERT INTO trips (id, creator_id, name, start_date, end_date)
      VALUES ('${tripId}', '${userId}', 'Family Trip', '2026-10-01', '2026-10-05');
    `);
  });

  // -------------------------------------------------------------------------
  // Columns (R1.1, R1.4)
  // -------------------------------------------------------------------------

  it('adds reservation_kind, confirmation_number, and party_size and round-trips them', () => {
    const itemId = insertReservation(db, tripId, userId, {
      custom_title: `'Ohana'`,
      reservation_kind: `'dining'`,
      confirmation_number: `'ABC123456'`,
      party_size: '4',
    });

    const row = db.public.one(
      `SELECT reservation_kind, confirmation_number, party_size
         FROM planned_items WHERE id = '${itemId}'`
    ) as any;
    expect(row.reservation_kind).toBe('dining');
    expect(row.confirmation_number).toBe('ABC123456');
    expect(row.party_size).toBe(4);
  });

  it('leaves the three columns NULL by default so no existing item becomes a reservation (R1.3)', () => {
    const itemId = randomUUID();
    db.public.none(`
      INSERT INTO planned_items (id, trip_id, added_by, experience_id, item_type)
      VALUES ('${itemId}', '${tripId}', '${userId}', NULL, 'break');
    `);

    const row = db.public.one(
      `SELECT reservation_kind, confirmation_number, party_size
         FROM planned_items WHERE id = '${itemId}'`
    ) as any;
    expect(row.reservation_kind).toBeNull();
    expect(row.confirmation_number).toBeNull();
    expect(row.party_size).toBeNull();
  });

  // -------------------------------------------------------------------------
  // chk_planned_items_reservation_kind (R1.2)
  // -------------------------------------------------------------------------

  it('accepts every kind in the vocabulary', () => {
    for (const kind of ['dining', 'lightning_lane', 'activity', 'other']) {
      const itemId = insertReservation(db, tripId, userId, {
        custom_title: `'Booking'`,
        reservation_kind: `'${kind}'`,
      });
      const row = db.public.one(
        `SELECT reservation_kind FROM planned_items WHERE id = '${itemId}'`
      ) as any;
      expect(row.reservation_kind).toBe(kind);
    }
  });

  it('rejects a kind outside the vocabulary via chk_planned_items_reservation_kind', () => {
    for (const invalid of ['DINING', 'lightninglane', 'adr', 'genie', '']) {
      expect(() =>
        insertReservation(db, tripId, userId, {
          custom_title: `'Booking'`,
          reservation_kind: `'${invalid}'`,
        })
      ).toThrow();
    }
  });

  // -------------------------------------------------------------------------
  // chk_planned_items_party_size (R1.4)
  // -------------------------------------------------------------------------

  it('accepts party_size at both bounds and NULL', () => {
    for (const size of ['1', '50', 'NULL']) {
      const itemId = insertReservation(db, tripId, userId, {
        custom_title: `'Booking'`,
        reservation_kind: `'dining'`,
        party_size: size,
      });
      const row = db.public.one(
        `SELECT party_size FROM planned_items WHERE id = '${itemId}'`
      ) as any;
      expect(row.party_size).toBe(size === 'NULL' ? null : Number(size));
    }
  });

  it('rejects a party_size outside 1-50 via chk_planned_items_party_size', () => {
    for (const size of ['0', '51', '-1']) {
      expect(() =>
        insertReservation(db, tripId, userId, {
          custom_title: `'Booking'`,
          reservation_kind: `'dining'`,
          party_size: size,
        })
      ).toThrow();
    }
  });

  // -------------------------------------------------------------------------
  // chk_planned_items_reservation_anchored (R1.5, R1.6)
  // -------------------------------------------------------------------------

  it('rejects a reservation with a NULL planned_date', () => {
    expect(() =>
      insertReservation(db, tripId, userId, {
        custom_title: `'Booking'`,
        reservation_kind: `'dining'`,
        planned_date: 'NULL',
      })
    ).toThrow();
  });

  it('rejects a reservation with a NULL planned_time', () => {
    expect(() =>
      insertReservation(db, tripId, userId, {
        custom_title: `'Booking'`,
        reservation_kind: `'dining'`,
        planned_time: 'NULL',
      })
    ).toThrow();
  });

  it('rejects clearing planned_date on an existing reservation', () => {
    const itemId = insertReservation(db, tripId, userId, {
      custom_title: `'Booking'`,
      reservation_kind: `'dining'`,
    });

    expect(() => {
      db.public.none(
        `UPDATE planned_items SET planned_date = NULL WHERE id = '${itemId}'`
      );
    }).toThrow();
  });

  it('still accepts a NON-reservation item with a NULL planned_date and planned_time', () => {
    const itemId = randomUUID();
    expect(() => {
      db.public.none(`
        INSERT INTO planned_items (id, trip_id, added_by, experience_id, item_type, planned_date, planned_time)
        VALUES ('${itemId}', '${tripId}', '${userId}', NULL, 'break', NULL, NULL);
      `);
    }).not.toThrow();

    const row = db.public.one(
      `SELECT planned_date, planned_time, reservation_kind FROM planned_items WHERE id = '${itemId}'`
    ) as any;
    expect(row.planned_date).toBeNull();
    expect(row.planned_time).toBeNull();
    expect(row.reservation_kind).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Idempotence on reapply
  // -------------------------------------------------------------------------

  it('is a no-op when reapplied and preserves existing reservation rows', () => {
    const itemId = insertReservation(db, tripId, userId, {
      custom_title: `'Ohana'`,
      reservation_kind: `'dining'`,
      confirmation_number: `'ABC123456'`,
      party_size: '4',
    });

    expect(() => applyMigration(db, '0031_planned_item_reservations.sql')).not.toThrow();

    const row = db.public.one(
      `SELECT reservation_kind, confirmation_number, party_size
         FROM planned_items WHERE id = '${itemId}'`
    ) as any;
    expect(row.reservation_kind).toBe('dining');
    expect(row.confirmation_number).toBe('ABC123456');
    expect(row.party_size).toBe(4);

    // The constraints are still in force after the reapply.
    expect(() =>
      insertReservation(db, tripId, userId, {
        custom_title: `'Booking'`,
        reservation_kind: `'not_a_kind'`,
      })
    ).toThrow();
  });
});
