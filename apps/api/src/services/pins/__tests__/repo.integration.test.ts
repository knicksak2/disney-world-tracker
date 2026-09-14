/**
 * Integration tests for the Pin_Service repository against a real pg-mem
 * database running the actual migration SQL. These exercise the snapshot
 * queries, the two data-adjacent predicates (`isRealRestaurant`,
 * `isDisneyOwnedResort`), the board projection, and the idempotent award insert
 * end to end — not a mock in sight, because the repo's whole job is SQL + the
 * fold into the pure evaluator.
 *
 * Validates: Requirements 2.1, 2.4, 3.1, 3.2, 10.1, 16.1 (Properties 1, 12)
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import { PINS } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { evaluateCriteria } from '../evaluator.js';
import { buildSnapshot, createPinRepo, type PinRepo } from '../repo.js';

// ---------------------------------------------------------------------------
// pg-mem harness
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

/** Migrations that create every table/column the Pin snapshot reads. */
const MIGRATIONS = [
  '0001_init.sql', // users, experiences (base), completions, ratings, notes
  '0006_experience_land.sql', // experiences.land
  '0008_experience_facet_enrichment.sql', // experiences.grouped_facets
  '0014_experience_world_showcase_country.sql', // experiences.world_showcase_country
  '0015_trips.sql', // trips, trip_memberships, trip_log_entries, rode_with_tags
  '0032_experience_category_taxonomy.sql', // widens category CHECK (Resort/Walkthrough/PlayArea)
  '0034_experience_logs.sql', // experience_logs (+ trip_log_entries.log_id)
  '0035_pins_and_challenges.sql', // user_pins
  '0036_pin_claiming.sql', // user_pins.claimed_at
  '0039_experience_festival_tags.sql', // experience_festival_tags
];

interface Fixture {
  readonly pool: DbPool;
  readonly repo: PinRepo;
}

function setup(): Fixture {
  const db = buildPgMemDatabase();
  for (const name of MIGRATIONS) applyMigration(db, name);
  const { Pool } = db.adapters.createPg();
  const pool = new Pool() as unknown as DbPool;
  return { pool, repo: createPinRepo(pool) };
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

interface SeedExperienceOpts {
  readonly category: string;
  readonly park?: string;
  readonly land?: string | null;
  readonly worldShowcaseCountry?: string | null;
  readonly facets?: Record<string, ReadonlyArray<{ id: string; name: string }>>;
  readonly name?: string;
  readonly upstreamId?: string;
}

async function seedUser(pool: DbPool): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'h')`,
    [id, `${id}@example.com`],
  );
  return id;
}

async function seedExperience(pool: DbPool, opts: SeedExperienceOpts): Promise<string> {
  const id = randomUUID();
  const upstream = opts.upstreamId ?? `up-${id}`;
  await pool.query(
    `INSERT INTO experiences
       (id, upstream_entity_id, name, park, category, land, world_showcase_country, grouped_facets)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      id,
      upstream,
      opts.name ?? 'Experience',
      opts.park ?? 'Magic Kingdom',
      opts.category,
      opts.land ?? null,
      opts.worldShowcaseCountry ?? null,
      JSON.stringify(opts.facets ?? {}),
    ],
  );
  return upstream;
}

async function complete(pool: DbPool, userId: string, upstreamId: string): Promise<void> {
  await pool.query(
    `INSERT INTO completions (user_id, experience_id, completed_on, user_tz)
     SELECT $1, e.id, '2026-01-02'::date, 'America/New_York'
       FROM experiences e WHERE e.upstream_entity_id = $2`,
    [userId, upstreamId],
  );
}

async function addLog(
  pool: DbPool,
  userId: string,
  upstreamId: string,
  visitedOn: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO experience_logs (user_id, experience_id, visited_on, user_tz)
     SELECT $1, e.id, $3::date, 'America/New_York'
       FROM experiences e WHERE e.upstream_entity_id = $2`,
    [userId, upstreamId, visitedOn],
  );
}

async function seedRating(pool: DbPool, userId: string, upstreamId: string): Promise<void> {
  await pool.query(
    `INSERT INTO ratings (user_id, experience_id, value)
     SELECT $1, e.id, 8 FROM experiences e WHERE e.upstream_entity_id = $2`,
    [userId, upstreamId],
  );
}

/** Seed a trip owned by `userId`, a member row, a log entry, and a confirmed rode-with tag. */
async function seedConfirmedFriendRide(
  pool: DbPool,
  userId: string,
  upstreamId: string,
): Promise<void> {
  const tripId = randomUUID();
  const logEntryId = randomUUID();
  const logId = randomUUID();
  await pool.query(
    `INSERT INTO trips (id, creator_id, name, start_date, end_date)
     VALUES ($1, $2, 'T', '2026-01-01', '2026-01-05')`,
    [tripId, userId],
  );
  await pool.query(
    `INSERT INTO trip_memberships (trip_id, user_id, role) VALUES ($1, $2, 'organizer')`,
    [tripId, userId],
  );
  // trip_log_entries.log_id is NOT NULL (FK -> experience_logs), so seed the
  // backing log row first and link it.
  await pool.query(
    `INSERT INTO experience_logs (id, user_id, experience_id, visited_on, user_tz)
     SELECT $1, $2, e.id, '2026-01-02'::date, 'America/New_York'
       FROM experiences e WHERE e.upstream_entity_id = $3`,
    [logId, userId, upstreamId],
  );
  await pool.query(
    `INSERT INTO trip_log_entries (id, trip_id, member_id, experience_id, log_id)
     SELECT $1, $2, $3, e.id, $5 FROM experiences e WHERE e.upstream_entity_id = $4`,
    [logEntryId, tripId, userId, upstreamId, logId],
  );
  await pool.query(
    `INSERT INTO rode_with_tags (log_entry_id, tagged_member_id, state)
     VALUES ($1, $2, 'confirmed')`,
    [logEntryId, userId],
  );
}

async function seedTag(
  pool: DbPool,
  upstreamId: string,
  festivalSlug: string,
  festivalYear = 2026,
): Promise<void> {
  await pool.query(
    `INSERT INTO experience_festival_tags (experience_id, festival_slug, festival_year)
     SELECT e.id, $2, $3::int FROM experiences e WHERE e.upstream_entity_id = $1`,
    [upstreamId, festivalSlug, festivalYear],
  );
}

async function setExperienceActive(
  pool: DbPool,
  upstreamId: string,
  active: boolean,
): Promise<void> {
  await pool.query(
    `UPDATE experiences SET active = $2 WHERE upstream_entity_id = $1`,
    [upstreamId, active],
  );
}

const RIDE = { category: 'Ride' as const };
const REAL_RESTAURANT_FACETS = { tableService: [{ id: 'casual-dining', name: 'Casual Dining' }] };
const FESTIVAL_FACETS = { quickService: [{ id: 'festival-kiosk', name: 'Festival Kiosk' }] };
const SNACK_FACETS = { quickService: [{ id: 'snack', name: 'Snack' }] };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PinRepo (pg-mem)', () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = setup();
  });

  it('awardNewly awards count-ladder + starter pins and is idempotent', async () => {
    const user = await seedUser(fx.pool);
    for (let i = 0; i < 5; i += 1) {
      const up = await seedExperience(fx.pool, {
        ...RIDE,
        park: 'Magic Kingdom',
        land: 'Tomorrowland',
        name: `Ride ${i}`,
      });
      await complete(fx.pool, user, up);
    }

    const awarded = await fx.repo.awardNewly(user);
    expect(awarded).toContain('bronze_centurion_5'); // 5 attractions
    expect(awarded).toContain('bronze_park_starter_magic_kingdom'); // first in park
    expect(awarded).toContain('bronze_land_starter_tomorrowland'); // first in land
    expect(awarded).not.toContain('bronze_centurion_15'); // only 5 done

    // Idempotent: re-evaluating awards nothing new (Property 1).
    expect(await fx.repo.awardNewly(user)).toEqual([]);

    // The awards are durable in user_pins.
    const rows = await fx.pool.query<{ pin_id: string }>(
      `SELECT pin_id FROM user_pins WHERE user_id = $1`,
      [user],
    );
    expect(rows.rows.map((r) => r.pin_id)).toContain('bronze_centurion_5');
  });

  it('getBoard reports unlocked awards and clamped progress for locked pins', async () => {
    const user = await seedUser(fx.pool);
    for (let i = 0; i < 3; i += 1) {
      const up = await seedExperience(fx.pool, { ...RIDE, park: 'Magic Kingdom', name: `R${i}` });
      await complete(fx.pool, user, up);
    }
    await fx.repo.awardNewly(user); // unlocks the MK park starter (met)

    const board = await fx.repo.getBoard(user);

    const starter = board.pins.find((p) => p.pinId === 'bronze_park_starter_magic_kingdom');
    expect(starter?.unlocked).toBe(true);
    expect(starter?.awardedAt).not.toBeNull();
    expect(starter?.percentComplete).toBeNull();

    const centurion5 = board.pins.find((p) => p.pinId === 'bronze_centurion_5');
    expect(centurion5?.unlocked).toBe(false);
    expect(centurion5?.currentValue).toBe(3);
    expect(centurion5?.targetValue).toBe(5);
    expect(centurion5?.percentComplete).toBe(60); // 3/5, clamped in [0,99]

    // Totals + tier summary describe the whole roster (R3.2).
    expect(board.totalPins).toBe(PINS.length);
    expect(board.pins).toHaveLength(PINS.length);
    const bronze = board.tierSummary.find((t) => t.tier === 'bronze');
    expect(bronze?.total).toBe(PINS.filter((p) => p.tier === 'bronze').length);
    expect(bronze?.unlocked).toBeGreaterThanOrEqual(1);
    expect(board.overallPercent).toBe(
      Math.floor((board.totalUnlocked / board.totalPins) * 100),
    );
  });

  it('classifies real restaurants, festival booths, and snacks (R10.1)', async () => {
    const user = await seedUser(fx.pool);
    const real = await seedExperience(fx.pool, {
      category: 'Restaurant',
      park: 'EPCOT',
      facets: REAL_RESTAURANT_FACETS,
    });
    const festival = await seedExperience(fx.pool, {
      category: 'Restaurant',
      park: 'EPCOT',
      facets: FESTIVAL_FACETS,
    });
    const snack = await seedExperience(fx.pool, {
      category: 'Restaurant',
      park: 'EPCOT',
      facets: SNACK_FACETS,
    });
    for (const up of [real, festival, snack]) await complete(fx.pool, user, up);

    const snap = await buildSnapshot(fx.pool, user);
    const byId = new Map(snap.catalog.map((e) => [e.upstreamId, e]));
    expect(byId.get(real)?.isRealRestaurant).toBe(true);
    expect(byId.get(festival)?.isRealRestaurant).toBe(false);
    expect(byId.get(snack)?.isRealRestaurant).toBe(false);
    // The flattened facet names survive for the evaluator's facet matching.
    expect(byId.get(real)?.facets.tableService).toContain('Casual Dining');

    // Each dining track counts its own bucket, independently (R10.1, R10.5).
    expect(evaluateCriteria({ kind: 'count', metric: 'restaurants', threshold: 1 }, snap).current).toBe(1);
    expect(evaluateCriteria({ kind: 'count', metric: 'festivalBooths', threshold: 1 }, snap).current).toBe(1);
    expect(evaluateCriteria({ kind: 'count', metric: 'snacks', threshold: 1 }, snap).current).toBe(1);
  });

  it('counts a completed, since-deactivated, tagged booth toward festivalBooths (R4.1)', async () => {
    const user = await seedUser(fx.pool);
    const booth = await seedExperience(fx.pool, {
      category: 'Restaurant',
      park: 'EPCOT',
      facets: FESTIVAL_FACETS,
    });
    await complete(fx.pool, user, booth);
    await seedTag(fx.pool, booth, 'food-and-wine', 2026);
    // Deactivate the booth (simulating festival end / catalog sync soft-delete)
    await setExperienceActive(fx.pool, booth, false);

    const snap = await buildSnapshot(fx.pool, user);
    expect(snap.festivalTaggedCompletedIds.has(booth)).toBe(true);
    expect(evaluateCriteria({ kind: 'count', metric: 'festivalBooths', threshold: 1 }, snap).current).toBe(1);
  });

  it('counts a completed, active, untagged booth toward festivalBooths (pre-tag grace window, R4.2)', async () => {
    const user = await seedUser(fx.pool);
    const booth = await seedExperience(fx.pool, {
      category: 'Restaurant',
      park: 'EPCOT',
      facets: FESTIVAL_FACETS,
    });
    await complete(fx.pool, user, booth);
    // Active booth, but untagged yet (pre-tag grace window)

    const snap = await buildSnapshot(fx.pool, user);
    expect(snap.festivalTaggedCompletedIds.has(booth)).toBe(false);
    expect(evaluateCriteria({ kind: 'count', metric: 'festivalBooths', threshold: 1 }, snap).current).toBe(1);
  });

  it('does NOT count a completed, deactivated, untagged booth toward festivalBooths (regression guard)', async () => {
    const user = await seedUser(fx.pool);
    const booth = await seedExperience(fx.pool, {
      category: 'Restaurant',
      park: 'EPCOT',
      facets: FESTIVAL_FACETS,
    });
    await complete(fx.pool, user, booth);
    // Deactivate without tagging
    await setExperienceActive(fx.pool, booth, false);

    const snap = await buildSnapshot(fx.pool, user);
    expect(snap.festivalTaggedCompletedIds.has(booth)).toBe(false);
    expect(evaluateCriteria({ kind: 'count', metric: 'festivalBooths', threshold: 1 }, snap).current).toBe(0);
  });

  it('counts only Disney-owned resorts (R16.1)', async () => {
    const user = await seedUser(fx.pool);
    const gf = await seedExperience(fx.pool, {
      category: 'Resort',
      park: 'Magic Kingdom',
      name: "Disney's Grand Floridian Resort & Spa",
    });
    const swan = await seedExperience(fx.pool, {
      category: 'Resort',
      park: 'EPCOT',
      name: 'Walt Disney World Swan Hotel',
    });
    await complete(fx.pool, user, gf);
    await complete(fx.pool, user, swan);

    const snap = await buildSnapshot(fx.pool, user);
    const byId = new Map(snap.catalog.map((e) => [e.upstreamId, e]));
    expect(byId.get(gf)?.isDisneyResort).toBe(true);
    expect(byId.get(swan)?.isDisneyResort).toBe(false);
    expect(evaluateCriteria({ kind: 'count', metric: 'resorts', threshold: 1 }, snap).current).toBe(1);
  });

  it('groups experience_logs by day for single-day feats', async () => {
    const user = await seedUser(fx.pool);
    const mk = await seedExperience(fx.pool, { ...RIDE, park: 'Magic Kingdom' });
    const ep = await seedExperience(fx.pool, { ...RIDE, park: 'EPCOT' });
    // Both logged on the SAME day → Two Parks in One Day.
    await addLog(fx.pool, user, mk, '2026-01-02');
    await addLog(fx.pool, user, ep, '2026-01-02');

    const awarded = await fx.repo.awardNewly(user);
    expect(awarded).toContain('bronze_two_parks');
  });

  it('feeds friend-ride, review, and trip metrics from their own tables', async () => {
    const user = await seedUser(fx.pool);
    const ride = await seedExperience(fx.pool, { ...RIDE, park: 'Magic Kingdom' });
    await seedConfirmedFriendRide(fx.pool, user, ride); // friendRides = 1, trips = 1
    await complete(fx.pool, user, ride);
    await seedRating(fx.pool, user, ride); // reviews = 1

    const awarded = await fx.repo.awardNewly(user);
    expect(awarded).toContain('bronze_squad_1'); // 1 confirmed friend ride
    expect(awarded).toContain('bronze_organizer_1'); // 1 trip membership
    expect(awarded).toContain('bronze_critic_1'); // 1 review
  });

  it('awardNewly returns only pins newly inserted by this call', async () => {
    const user = await seedUser(fx.pool);
    const ride = await seedExperience(fx.pool, { ...RIDE, park: 'Magic Kingdom' });
    await complete(fx.pool, user, ride);

    // Pre-insert the park starter as if a prior call already awarded it.
    await fx.pool.query(
      `INSERT INTO user_pins (user_id, pin_id) VALUES ($1, 'bronze_park_starter_magic_kingdom')`,
      [user],
    );

    const awarded = await fx.repo.awardNewly(user);
    expect(awarded).not.toContain('bronze_park_starter_magic_kingdom');
  });

  // -------------------------------------------------------------------------
  // claimPin (Requirement 20.3, 20.4; Property 13)
  // -------------------------------------------------------------------------

  it('claimPin sets claimed_at for an awarded pin and reports "claimed"', async () => {
    const user = await seedUser(fx.pool);
    const ride = await seedExperience(fx.pool, { ...RIDE, park: 'Magic Kingdom' });
    await complete(fx.pool, user, ride);
    await fx.repo.awardNewly(user); // awards bronze_park_starter_magic_kingdom, unclaimed

    const result = await fx.repo.claimPin(user, 'bronze_park_starter_magic_kingdom');
    expect(result.status).toBe('claimed');
    if (result.status === 'claimed') expect(result.claimedAt).toBeTruthy();

    const row = await fx.pool.query<{ claimed_at: Date | string | null }>(
      `SELECT claimed_at FROM user_pins WHERE user_id = $1 AND pin_id = $2`,
      [user, 'bronze_park_starter_magic_kingdom'],
    );
    expect(row.rows[0]?.claimed_at).not.toBeNull();
  });

  it('claimPin reports "not_awarded" for a pin with no user_pins row, and creates nothing', async () => {
    const user = await seedUser(fx.pool);
    const result = await fx.repo.claimPin(user, 'bronze_centurion_5');
    expect(result.status).toBe('not_awarded');

    const row = await fx.pool.query(
      `SELECT 1 FROM user_pins WHERE user_id = $1 AND pin_id = $2`,
      [user, 'bronze_centurion_5'],
    );
    expect(row.rows).toHaveLength(0);
  });

  it('claimPin is idempotent: claiming an already-claimed pin is a no-op returning the existing claimedAt', async () => {
    const user = await seedUser(fx.pool);
    const ride = await seedExperience(fx.pool, { ...RIDE, park: 'Magic Kingdom' });
    await complete(fx.pool, user, ride);
    await fx.repo.awardNewly(user);

    const first = await fx.repo.claimPin(user, 'bronze_park_starter_magic_kingdom');
    expect(first.status).toBe('claimed');
    const firstClaimedAt = first.status === 'claimed' ? first.claimedAt : null;

    const second = await fx.repo.claimPin(user, 'bronze_park_starter_magic_kingdom');
    expect(second.status).toBe('already_claimed');
    if (second.status === 'already_claimed') expect(second.claimedAt).toBe(firstClaimedAt);
  });

  it('getBoard totals and tier summary are identical whether an awarded pin is claimed or not (Property 14)', async () => {
    const user = await seedUser(fx.pool);
    const ride = await seedExperience(fx.pool, { ...RIDE, park: 'Magic Kingdom' });
    await complete(fx.pool, user, ride);
    await fx.repo.awardNewly(user);

    const before = await fx.repo.getBoard(user);
    await fx.repo.claimPin(user, 'bronze_park_starter_magic_kingdom');
    const after = await fx.repo.getBoard(user);

    expect(after.totalUnlocked).toBe(before.totalUnlocked);
    expect(after.overallPercent).toBe(before.overallPercent);
    expect(after.tierSummary).toEqual(before.tierSummary);
    // The pin itself did change state (claimedAt), confirming the summary
    // fields above are genuinely unaffected rather than the claim not landing.
    const starterBefore = before.pins.find((p) => p.pinId === 'bronze_park_starter_magic_kingdom');
    const starterAfter = after.pins.find((p) => p.pinId === 'bronze_park_starter_magic_kingdom');
    expect(starterBefore?.claimedAt).toBeNull();
    expect(starterAfter?.claimedAt).not.toBeNull();
    expect(starterAfter?.unlocked).toBe(starterBefore?.unlocked);
  });

  // -------------------------------------------------------------------------
  // reconcileAll (Requirement 21.2; Property 15)
  // -------------------------------------------------------------------------

  it('reconcileAll awards every user\'s met-but-unawarded pins, leaving them unclaimed', async () => {
    const userA = await seedUser(fx.pool);
    const userB = await seedUser(fx.pool);
    const rideA = await seedExperience(fx.pool, { ...RIDE, park: 'Magic Kingdom', name: 'A' });
    const rideB = await seedExperience(fx.pool, { ...RIDE, park: 'EPCOT', name: 'B' });
    await complete(fx.pool, userA, rideA);
    await complete(fx.pool, userB, rideB);
    // Neither user has had awardNewly run yet — simulates the historical-completion bug.

    const result = await fx.repo.reconcileAll();
    expect(result.usersProcessed).toBe(2);
    expect(result.pinsAwarded).toBeGreaterThan(0);

    const boardA = await fx.repo.getBoard(userA);
    const starterA = boardA.pins.find((p) => p.pinId === 'bronze_park_starter_magic_kingdom');
    expect(starterA?.unlocked).toBe(true);
    expect(starterA?.claimedAt).toBeNull(); // ready to claim, not silently claimed

    const boardB = await fx.repo.getBoard(userB);
    const starterB = boardB.pins.find((p) => p.pinId === 'bronze_park_starter_epcot');
    expect(starterB?.unlocked).toBe(true);
    expect(starterB?.claimedAt).toBeNull();
  });

  it('reconcileAll never duplicates an award, run repeatedly or after a synchronous award (Property 15)', async () => {
    const user = await seedUser(fx.pool);
    const ride = await seedExperience(fx.pool, { ...RIDE, park: 'Magic Kingdom' });
    await complete(fx.pool, user, ride);

    await fx.repo.awardNewly(user); // synchronous award happens first
    await fx.repo.reconcileAll(); // reconcile runs afterward — nothing left to award
    await fx.repo.reconcileAll(); // running it again is still a no-op

    const rows = await fx.pool.query<{ n: string | number }>(
      `SELECT count(*)::int AS n FROM user_pins WHERE user_id = $1 AND pin_id = 'bronze_park_starter_magic_kingdom'`,
      [user],
    );
    expect(Number(rows.rows[0]?.n)).toBe(1);
  });
});
