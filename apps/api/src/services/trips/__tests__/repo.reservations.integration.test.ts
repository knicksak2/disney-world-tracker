/**
 * Integration tests for the Reservation booking facet on the REAL
 * `createTripRepo`, against an in-memory Postgres (`pg-mem`). Exercises the real
 * SQL in `addPlannedItem` (kind → timing derivation + the widened INSERT),
 * `editPlannedItem` (the anchored-Reservation invariant + the reservation
 * columns), `updatePlannedItemTimes` (Booked_Time preservation), and
 * `listPlannedItems` / `selectPlannedItem` (the widened read projection).
 *
 * Every rule guarded here lives in SQL or in repo logic, so a route test with a
 * mocked repo would pass regardless of whether the query is right. In
 * particular the Booked_Time test below FAILS against the pre-fix
 * `updatePlannedItemTimes`, which wrote `planned_time = $1` unconditionally.
 *
 * Validates: trip-reservations Requirements 1.4, 1.6, 1.7, 4.4, 4.5, 5.1, 7.1
 * (Correctness Properties 1, 2, 3, and the storage half of 6)
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppError } from '../../../errors/AppError.js';
import type { DbPool } from '../../../db/pool.js';
import { createTripRepo, type TripRepo, type TripRepoDeps } from '../repo.js';

// ---------------------------------------------------------------------------
// pg-mem setup (mirrors repo.optimizationResult.integration.test.ts)
// ---------------------------------------------------------------------------

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
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

function withForUpdateCompat(base: DbPool): DbPool {
  const raw = base as unknown as {
    query: (text: string, params?: unknown[]) => Promise<unknown>;
    connect: () => Promise<{
      query: (text: string, params?: unknown[]) => Promise<unknown>;
      release: () => void;
    }>;
  };
  const strip = (text: string): string => text.replace(/\bFOR UPDATE(?:\s+OF\s+\w+)?/gi, '');
  return {
    query: (text: string, params?: unknown[]) => raw.query(strip(text), params),
    async connect() {
      const client = await raw.connect();
      return {
        query: (text: string, params?: unknown[]) => client.query(strip(text), params),
        release: () => client.release(),
      };
    },
  } as unknown as DbPool;
}

const NOOP_DEPS = {
  completions: {},
  ratings: {},
} as unknown as TripRepoDeps;

async function seedUser(pool: DbPool, name: string): Promise<string> {
  const id = randomUUID();
  await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)`, [
    id,
    `${id}@example.com`,
    'argon2id$seeded',
  ]);
  await pool.query(`INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)`, [id, name]);
  return id;
}

async function seedExperience(
  pool: DbPool,
  name: string,
  category = 'Ride',
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
     VALUES ($1, $2, $3, 'Magic Kingdom', $4)`,
    [id, `up-${id}`, name, category],
  );
  return id;
}

interface Fixture {
  pool: DbPool;
  repo: TripRepo;
}

function makeFixture(): Fixture {
  const db = buildPgMemDatabase();
  const { Pool: PgMemPool } = db.adapters.createPg();
  const rawPool = new PgMemPool() as unknown as DbPool;

  applyMigration(db, '0001_init.sql');
  db.public.none(
    "ALTER TABLE experiences ADD COLUMN IF NOT EXISTS meal_periods JSONB NOT NULL DEFAULT '[]';",
  );
  applyMigration(db, '0015_trips.sql');
  applyMigration(db, '0019_planned_item_scheduling.sql');
  applyMigration(db, '0022_planned_item_ride_options.sql');
  applyMigration(db, '0023_trip_touring_hours.sql');
  applyMigration(db, '0024_planned_item_optimization_result.sql');
  applyMigration(db, '0027_planned_items_soft_windows.sql');
  applyMigration(db, '0028_planned_items_meal_period_snack.sql');
  applyMigration(db, '0031_planned_item_reservations.sql');

  const pool = withForUpdateCompat(rawPool);
  const repo = createTripRepo(pool, NOOP_DEPS);
  return { pool, repo };
}

const VALID_TRIP = {
  name: 'WDW 2026',
  description: '',
  startDate: '2026-10-01',
  endDate: '2026-10-05',
} as const;

const BOOKED_AT = '2026-10-01T22:00:00.000Z';

/** Read the raw row so assertions run against stored columns, not just the DTO. */
async function readRow(pool: DbPool, itemId: string): Promise<Record<string, unknown>> {
  const res = await pool.query(
    `SELECT planned_date, planned_time, is_fixed, is_lightning_lane,
            window_start_minutes, window_end_minutes, meal_period,
            reservation_kind, confirmation_number, party_size,
            predicted_wait_minutes, travel_from_prev_minutes, travel_from_prev_kind,
            optimized_at
       FROM planned_items WHERE id = $1`,
    [itemId],
  );
  return (res as unknown as { rows: Record<string, unknown>[] }).rows[0]!;
}

// ---------------------------------------------------------------------------
// Property 1: Reservation kind determines the timing mode (R1.7, R4.2)
// ---------------------------------------------------------------------------

describe('Reservation kind determines the timing mode (Property 1)', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
  });

  it('stores a dining reservation as fixed, not Lightning Lane, with no soft window', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const expId = await seedExperience(fx.pool, 'Be Our Guest', 'Restaurant');
    const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });

    const item = await fx.repo.addPlannedItem(trip.id, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
      plannedTime: BOOKED_AT,
      reservationKind: 'dining',
      confirmationNumber: 'ABC123456',
      partySize: 4,
    });

    expect(item.reservationKind).toBe('dining');
    expect(item.confirmationNumber).toBe('ABC123456');
    expect(item.partySize).toBe(4);
    expect(item.isFixed).toBe(true);
    expect(item.isLightningLane).toBe(false);
    expect(item.windowStartMinutes).toBeNull();
    expect(item.windowEndMinutes).toBeNull();
    expect(item.mealPeriod).toBeNull();

    const row = await readRow(fx.pool, item.id);
    expect(row.reservation_kind).toBe('dining');
    expect(row.is_fixed).toBe(true);
    expect(row.is_lightning_lane).toBe(false);
    expect(row.party_size).toBe(4);
  });

  it('stores a lightning_lane reservation as a return window: LL true, fixed false', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const expId = await seedExperience(fx.pool, 'Space Mountain');
    const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });

    const item = await fx.repo.addPlannedItem(trip.id, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
      plannedTime: BOOKED_AT,
      reservationKind: 'lightning_lane',
    });

    expect(item.reservationKind).toBe('lightning_lane');
    expect(item.isLightningLane).toBe(true);
    expect(item.isFixed).toBe(false);
    expect(item.plannedTime).not.toBeNull();
  });

  it.each(['activity', 'other'] as const)(
    'stores a %s reservation as a fixed anchor',
    async (kind) => {
      const user = await seedUser(fx.pool, 'Organizer');
      // `Ride` is in the original `experiences_category_chk` vocabulary from
      // migration 0001; the later categories (Tour, Spa, …) arrive in a
      // migration this fixture does not apply.
      const expId = await seedExperience(fx.pool, 'Keys to the Kingdom', 'Ride');
      const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });

      const item = await fx.repo.addPlannedItem(trip.id, user, {
        experienceId: expId,
        plannedDate: '2026-10-01',
        plannedTime: BOOKED_AT,
        reservationKind: kind,
      });

      expect(item.reservationKind).toBe(kind);
      expect(item.isFixed).toBe(true);
      expect(item.isLightningLane).toBe(false);
    },
  );

  it('ignores client timing flags that contradict the kind', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const expId = await seedExperience(fx.pool, 'Ohana', 'Restaurant');
    const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });

    // A hostile/buggy client claims Lightning Lane AND a soft window on a
    // dining booking. The kind wins on every one of them (R1.7).
    const item = await fx.repo.addPlannedItem(trip.id, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
      plannedTime: BOOKED_AT,
      reservationKind: 'dining',
      isLightningLane: true,
      isFixed: false,
      windowStartMinutes: 600,
      windowEndMinutes: 700,
      mealPeriod: 'dinner',
    });

    expect(item.isFixed).toBe(true);
    expect(item.isLightningLane).toBe(false);
    expect(item.windowStartMinutes).toBeNull();
    expect(item.windowEndMinutes).toBeNull();
    expect(item.mealPeriod).toBeNull();
  });

  it('leaves an ordinary planned item unchanged: null facet, existing timing rules', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const expId = await seedExperience(fx.pool, 'Haunted Mansion');
    const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });

    // A self-pinned time with no kind is still fixed, but is NOT a Reservation.
    const item = await fx.repo.addPlannedItem(trip.id, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
      plannedTime: BOOKED_AT,
    });

    expect(item.reservationKind).toBeNull();
    expect(item.confirmationNumber).toBeNull();
    expect(item.partySize).toBeNull();
    expect(item.isFixed).toBe(true);
  });

  it('re-derives the timing mode when an edit changes the kind', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const expId = await seedExperience(fx.pool, 'Tron');
    const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });

    const item = await fx.repo.addPlannedItem(trip.id, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
      plannedTime: BOOKED_AT,
      reservationKind: 'dining',
    });
    expect(item.isFixed).toBe(true);

    const toLL = await fx.repo.editPlannedItem(trip.id, item.id, {
      reservationKind: 'lightning_lane',
    });
    expect(toLL.reservationKind).toBe('lightning_lane');
    expect(toLL.isLightningLane).toBe(true);
    expect(toLL.isFixed).toBe(false);

    const backToDining = await fx.repo.editPlannedItem(trip.id, item.id, {
      reservationKind: 'dining',
    });
    expect(backToDining.isFixed).toBe(true);
    expect(backToDining.isLightningLane).toBe(false);
  });

  it('demotes a reservation back to an ordinary planned item on an explicit null kind', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const expId = await seedExperience(fx.pool, 'Splash');
    const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });

    const item = await fx.repo.addPlannedItem(trip.id, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
      plannedTime: BOOKED_AT,
      reservationKind: 'dining',
      confirmationNumber: 'ABC123',
      partySize: 2,
    });

    const demoted = await fx.repo.editPlannedItem(trip.id, item.id, {
      reservationKind: null,
      confirmationNumber: null,
      partySize: null,
    });

    expect(demoted.reservationKind).toBeNull();
    expect(demoted.confirmationNumber).toBeNull();
    expect(demoted.partySize).toBeNull();

    // Now that it is no longer a Reservation, clearing the anchor is allowed.
    const cleared = await fx.repo.editPlannedItem(trip.id, item.id, { plannedDate: null });
    expect(cleared.plannedDate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Property 2: A Reservation always keeps a date and a time (R1.5, R1.6)
// ---------------------------------------------------------------------------

describe('A Reservation always keeps a date and a time (Property 2)', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
  });

  async function seedReservation(): Promise<{ tripId: string; itemId: string }> {
    const user = await seedUser(fx.pool, 'Organizer');
    const expId = await seedExperience(fx.pool, 'Cinderella Royal Table', 'Restaurant');
    const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });
    const item = await fx.repo.addPlannedItem(trip.id, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
      plannedTime: BOOKED_AT,
      reservationKind: 'dining',
      confirmationNumber: 'CONF-1',
      partySize: 5,
    });
    return { tripId: trip.id, itemId: item.id };
  }

  it('rejects clearing plannedDate and leaves the row untouched', async () => {
    const { tripId, itemId } = await seedReservation();
    const before = await readRow(fx.pool, itemId);

    await expect(
      fx.repo.editPlannedItem(tripId, itemId, { plannedDate: null }),
    ).rejects.toMatchObject({ code: 'trip_validation_failed' });

    expect(await readRow(fx.pool, itemId)).toEqual(before);
  });

  it('rejects clearing plannedTime and leaves the row untouched', async () => {
    const { tripId, itemId } = await seedReservation();
    const before = await readRow(fx.pool, itemId);

    await expect(
      fx.repo.editPlannedItem(tripId, itemId, { plannedTime: null }),
    ).rejects.toMatchObject({ code: 'trip_validation_failed' });

    expect(await readRow(fx.pool, itemId)).toEqual(before);
  });

  it('rejects promoting an unanchored item to a reservation', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const expId = await seedExperience(fx.pool, 'Jungle Cruise');
    const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });
    // No date, no time.
    const item = await fx.repo.addPlannedItem(trip.id, user, { experienceId: expId });
    const before = await readRow(fx.pool, item.id);

    await expect(
      fx.repo.editPlannedItem(trip.id, item.id, { reservationKind: 'dining' }),
    ).rejects.toMatchObject({ code: 'trip_validation_failed' });

    expect(await readRow(fx.pool, item.id)).toEqual(before);
  });

  it('accepts promoting an item to a reservation when the edit supplies the anchor', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const expId = await seedExperience(fx.pool, 'Sci-Fi Dine-In', 'Restaurant');
    const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });
    const item = await fx.repo.addPlannedItem(trip.id, user, { experienceId: expId });

    const promoted = await fx.repo.editPlannedItem(trip.id, item.id, {
      reservationKind: 'dining',
      plannedDate: '2026-10-02',
      plannedTime: '2026-10-02T23:30:00.000Z',
      partySize: 3,
    });

    expect(promoted.reservationKind).toBe('dining');
    expect(promoted.plannedDate).toBe('2026-10-02');
    expect(promoted.plannedTime).not.toBeNull();
    expect(promoted.isFixed).toBe(true);
    expect(promoted.partySize).toBe(3);
  });

  it('surfaces a validation error, not an internal error, when the anchor rule is hit', async () => {
    const { tripId, itemId } = await seedReservation();
    // The DB CHECK is a backstop only: the repo must reject first, so the caller
    // sees `trip_validation_failed` with a field pointer rather than a raw 23514
    // mapped to `internal_error`.
    await expect(
      fx.repo.editPlannedItem(tripId, itemId, { plannedDate: null }),
    ).rejects.toBeInstanceOf(AppError);

    try {
      await fx.repo.editPlannedItem(tripId, itemId, { plannedDate: null });
      expect.unreachable('edit should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('trip_validation_failed');
    }
  });

  it('allows editing only the booking metadata without touching the anchor', async () => {
    const { tripId, itemId } = await seedReservation();
    const before = await readRow(fx.pool, itemId);

    const edited = await fx.repo.editPlannedItem(tripId, itemId, {
      confirmationNumber: 'CONF-2',
      partySize: 8,
    });

    expect(edited.confirmationNumber).toBe('CONF-2');
    expect(edited.partySize).toBe(8);
    const after = await readRow(fx.pool, itemId);
    expect(after.planned_date).toEqual(before.planned_date);
    expect(after.planned_time).toEqual(before.planned_time);
    expect(after.reservation_kind).toBe('dining');
  });
});

// ---------------------------------------------------------------------------
// Property 3: Optimization never rewrites a Booked_Time (R4.4, R4.5)
// ---------------------------------------------------------------------------

describe('Optimization never rewrites a Booked_Time (Property 3)', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
  });

  it('preserves a reservation planned_time while still persisting wait, travel, and optimizedAt', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const expId = await seedExperience(fx.pool, 'Ohana', 'Restaurant');
    const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });

    const item = await fx.repo.addPlannedItem(trip.id, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
      plannedTime: BOOKED_AT,
      reservationKind: 'dining',
      confirmationNumber: 'CONF-9',
      partySize: 6,
    });
    const bookedTime = (await readRow(fx.pool, item.id)).planned_time;

    // The optimizer, on an infeasible day, returns an arrival LATER than the
    // booking. Pre-fix this was written straight back over planned_time, moving
    // a real 6:00 PM dinner to 6:12 PM.
    await fx.repo.updatePlannedItemTimes(trip.id, [
      {
        itemId: item.id,
        plannedTime: '2026-10-01T22:12:00.000Z',
        predictedWaitMinutes: 0,
        travelFromPrev: { kind: 'walk', minutes: 12 },
      },
    ]);

    const row = await readRow(fx.pool, item.id);
    expect(row.planned_time).toEqual(bookedTime);

    // ...and the rest of the optimizer result still landed.
    expect(row.predicted_wait_minutes).toBe(0);
    expect(row.travel_from_prev_minutes).toBe(12);
    expect(row.travel_from_prev_kind).toBe('walk');
    expect(row.optimized_at).not.toBeNull();

    const [read] = await fx.repo.listPlannedItems(trip.id);
    expect(read!.plannedTime).toBe(BOOKED_AT);
    expect(read!.predictedWaitMinutes).toBe(0);
    expect(read!.travelFromPrev).toEqual({ kind: 'walk', minutes: 12 });
    expect(read!.optimizedAt).not.toBeNull();
  });

  it('preserves a lightning_lane reservation return-window start too', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const expId = await seedExperience(fx.pool, 'Rise of the Resistance');
    const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });

    const item = await fx.repo.addPlannedItem(trip.id, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
      plannedTime: BOOKED_AT,
      reservationKind: 'lightning_lane',
    });
    const bookedTime = (await readRow(fx.pool, item.id)).planned_time;

    await fx.repo.updatePlannedItemTimes(trip.id, [
      {
        itemId: item.id,
        plannedTime: '2026-10-01T23:59:00.000Z',
        predictedWaitMinutes: 10,
        travelFromPrev: null,
      },
    ]);

    expect((await readRow(fx.pool, item.id)).planned_time).toEqual(bookedTime);
    expect((await readRow(fx.pool, item.id)).predicted_wait_minutes).toBe(10);
  });

  it('STILL overwrites planned_time for a non-reservation item (existing behavior preserved)', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const expId = await seedExperience(fx.pool, 'Space Mountain');
    const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });

    const item = await fx.repo.addPlannedItem(trip.id, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
    });

    await fx.repo.updatePlannedItemTimes(trip.id, [
      {
        itemId: item.id,
        plannedTime: '2026-10-01T14:00:00.000Z',
        predictedWaitMinutes: 35,
        travelFromPrev: { kind: 'walk', minutes: 5 },
      },
    ]);

    const [read] = await fx.repo.listPlannedItems(trip.id);
    expect(read!.plannedTime).toBe('2026-10-01T14:00:00.000Z');
    expect(read!.predictedWaitMinutes).toBe(35);
  });

  it('handles a mixed day: the reservation holds, the flexible item moves', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const diningId = await seedExperience(fx.pool, 'Le Cellier', 'Restaurant');
    const rideId = await seedExperience(fx.pool, 'Test Track');
    const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });

    const reservation = await fx.repo.addPlannedItem(trip.id, user, {
      experienceId: diningId,
      plannedDate: '2026-10-01',
      plannedTime: BOOKED_AT,
      reservationKind: 'dining',
    });
    const flexible = await fx.repo.addPlannedItem(trip.id, user, {
      experienceId: rideId,
      plannedDate: '2026-10-01',
    });

    await fx.repo.updatePlannedItemTimes(trip.id, [
      { itemId: reservation.id, plannedTime: '2026-10-01T23:00:00.000Z', predictedWaitMinutes: 0 },
      { itemId: flexible.id, plannedTime: '2026-10-01T15:30:00.000Z', predictedWaitMinutes: 40 },
    ]);

    const items = await fx.repo.listPlannedItems(trip.id);
    const readReservation = items.find((i) => i.id === reservation.id)!;
    const readFlexible = items.find((i) => i.id === flexible.id)!;

    expect(readReservation.plannedTime).toBe(BOOKED_AT);
    expect(readFlexible.plannedTime).toBe('2026-10-01T15:30:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// Property 6 (storage half): a Non_Catalog_Reservation stays break-typed (R5.1)
// ---------------------------------------------------------------------------

describe('A Non_Catalog_Reservation stays break-typed (Property 6, storage)', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
  });

  it('stores an off-property dining booking as a break with a custom title', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });

    const item = await fx.repo.addPlannedItem(trip.id, user, {
      experienceId: null,
      itemType: 'break',
      customTitle: 'Off-property steakhouse',
      plannedDate: '2026-10-03',
      plannedTime: '2026-10-03T23:00:00.000Z',
      reservationKind: 'dining',
      confirmationNumber: 'OP-77',
      partySize: 2,
    });

    expect(item.experienceId).toBeNull();
    expect(item.itemType).toBe('break');
    expect(item.customTitle).toBe('Off-property steakhouse');
    expect(item.reservationKind).toBe('dining');
    expect(item.park).toBeNull();
    expect(item.isFixed).toBe(true);

    // It is readable through the list projection with the facet intact.
    const [read] = await fx.repo.listPlannedItems(trip.id);
    expect(read!.reservationKind).toBe('dining');
    expect(read!.confirmationNumber).toBe('OP-77');
    expect(read!.partySize).toBe(2);
    expect(read!.itemType).toBe('break');
  });

  it('refuses to move an unlocated reservation away from break', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });
    const item = await fx.repo.addPlannedItem(trip.id, user, {
      experienceId: null,
      itemType: 'break',
      customTitle: 'Off-property steakhouse',
      plannedDate: '2026-10-03',
      plannedTime: '2026-10-03T23:00:00.000Z',
      reservationKind: 'dining',
    });

    await expect(
      fx.repo.editPlannedItem(trip.id, item.id, { itemType: 'experience' }),
    ).rejects.toMatchObject({ code: 'trip_validation_failed' });
  });
});
