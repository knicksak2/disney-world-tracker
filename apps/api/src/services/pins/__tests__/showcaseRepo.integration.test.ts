/**
 * Integration tests for PinShowcaseRepo against a real pg-mem database.
 *
 * Validates: Requirements 24.1, 24.2, 24.3, 24.4, 24.5, 24.8, 24.11;
 *            Properties 18, 19, 20, 22
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  SHOWCASE_MAX_PINS,
  SHOWCASE_REFERENCE_SIZE,
} from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { createPinShowcaseRepo, type PinShowcaseRepo } from '../showcaseRepo.js';

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

const MIGRATIONS = [
  '0001_init.sql',
  '0035_pins_and_challenges.sql',
  '0036_pin_claiming.sql',
  '0037_pin_showcase.sql',
];

interface Fixture {
  readonly pool: DbPool;
  readonly repo: PinShowcaseRepo;
}

function setup(): Fixture {
  const db = buildPgMemDatabase();
  for (const name of MIGRATIONS) applyMigration(db, name);
  const { Pool } = db.adapters.createPg();
  const pool = new Pool() as unknown as DbPool;
  return { pool, repo: createPinShowcaseRepo(pool) };
}

async function seedUser(pool: DbPool): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'x')`,
    [id, `${id}@example.com`],
  );
  return id;
}

async function awardAndClaimPin(pool: DbPool, userId: string, pinId: string): Promise<void> {
  await pool.query(
    `INSERT INTO user_pins (user_id, pin_id, awarded_at, claimed_at)
     VALUES ($1, $2, now(), now())`,
    [userId, pinId],
  );
}

async function awardUnclaimedPin(pool: DbPool, userId: string, pinId: string): Promise<void> {
  await pool.query(
    `INSERT INTO user_pins (user_id, pin_id, awarded_at, claimed_at)
     VALUES ($1, $2, now(), NULL)`,
    [userId, pinId],
  );
}

describe('PinShowcaseRepo Integration (pg-mem)', () => {
  let pool: DbPool;
  let repo: PinShowcaseRepo;
  let userA: string;

  beforeEach(async () => {
    const fix = setup();
    pool = fix.pool;
    repo = fix.repo;
    userA = await seedUser(pool);
  });

  it('places a claimed pin and reads back exact coordinates and zIndex', async () => {
    await awardAndClaimPin(pool, userA, 'gold_coaster_royalty');

    const placed = await repo.placePin(userA, 'gold_coaster_royalty', 0.25, 0.75);
    expect(placed.pinId).toBe('gold_coaster_royalty');
    expect(placed.posX).toBeCloseTo(0.25);
    expect(placed.posY).toBeCloseTo(0.75);
    expect(placed.zIndex).toBe(0);

    const showcase = await repo.getShowcase(userA);
    expect(showcase.ownerId).toBe(userA);
    expect(showcase.placements).toHaveLength(1);
    expect(showcase.placements[0]?.pinId).toBe('gold_coaster_royalty');
    expect(showcase.placements[0]?.posX).toBeCloseTo(0.25);
    expect(showcase.placements[0]?.posY).toBeCloseTo(0.75);
    expect(showcase.placements[0]?.zIndex).toBe(0);
    expect(showcase.unplaced).toEqual([]);
  });

  // Property 18: Placement Requires Current Ownership
  it('rejects placement of an unclaimed or non-awarded pin with pin_not_eligible (Property 18)', async () => {
    // 1. Completely unearned pin
    await expect(
      repo.placePin(userA, 'gold_coaster_royalty', 0.1, 0.1),
    ).rejects.toMatchObject({
      code: 'pin_not_eligible',
    });

    // 2. Awarded but NOT claimed pin
    await awardUnclaimedPin(pool, userA, 'silver_squad_10');
    await expect(
      repo.placePin(userA, 'silver_squad_10', 0.1, 0.1),
    ).rejects.toMatchObject({
      code: 'pin_not_eligible',
    });

    // Verify no rows were inserted
    const rows = await pool.query(`SELECT count(*)::int AS n FROM pin_showcase_placements WHERE user_id = $1`, [userA]);
    expect(rows.rows[0]?.['n']).toBe(0);
  });

  // Property 19: Placement Upsert Idempotency
  it('updates position and bumps zIndex when re-placing already-placed pin (Property 19)', async () => {
    await awardAndClaimPin(pool, userA, 'pin_first');
    await awardAndClaimPin(pool, userA, 'pin_second');

    // Place pin_first at z=0
    await repo.placePin(userA, 'pin_first', 0.1, 0.1);
    // Place pin_second at z=1
    await repo.placePin(userA, 'pin_second', 0.5, 0.5);

    // Re-place pin_first at new coordinates (z should become max(0, 1) + 1 = 2)
    const updated = await repo.placePin(userA, 'pin_first', 0.8, 0.8);
    expect(updated.posX).toBeCloseTo(0.8);
    expect(updated.posY).toBeCloseTo(0.8);
    expect(updated.zIndex).toBe(2);

    // Verify exactly 2 rows exist
    const rows = await pool.query(`SELECT count(*)::int AS n FROM pin_showcase_placements WHERE user_id = $1`, [userA]);
    expect(rows.rows[0]?.['n']).toBe(2);

    const showcase = await repo.getShowcase(userA);
    expect(showcase.placements.map((p) => p.pinId)).toEqual(['pin_second', 'pin_first']);
  });

  // Property 20: Showcase Capacity Invariant
  it('rejects placement exceeding SHOWCASE_MAX_PINS with showcase_full (Property 20)', async () => {
    // Fill up to capacity (SHOWCASE_MAX_PINS = 24)
    for (let i = 0; i < SHOWCASE_MAX_PINS; i++) {
      const pinId = `pin_${i}`;
      await awardAndClaimPin(pool, userA, pinId);
      // Place non-overlapping coordinates in a grid
      const col = i % 4;
      const row = Math.floor(i / 4);
      const posX = 0.1 + col * 0.25;
      const posY = 0.05 + row * 0.15;
      await repo.placePin(userA, pinId, posX, posY);
    }

    const countBefore = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pin_showcase_placements WHERE user_id = $1`,
      [userA],
    );
    expect(countBefore.rows[0]?.n).toBe(SHOWCASE_MAX_PINS);

    // Attempt to place a 25th new pin
    const extraPin = 'pin_extra_25';
    await awardAndClaimPin(pool, userA, extraPin);

    await expect(
      repo.placePin(userA, extraPin, 0.01, 0.01),
    ).rejects.toMatchObject({
      code: 'showcase_full',
    });

    const countAfter = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pin_showcase_placements WHERE user_id = $1`,
      [userA],
    );
    expect(countAfter.rows[0]?.n).toBe(SHOWCASE_MAX_PINS);

    // But moving an ALREADY-placed pin at capacity still succeeds!
    await expect(
      repo.placePin(userA, 'pin_0', 0.12, 0.05),
    ).resolves.toBeDefined();
  });

  // Property 22: No Two Placements Overlap
  it('enforces non-overlap center-to-center distance >= SHOWCASE_MIN_PIN_CLEARANCE (Property 22)', async () => {
    await awardAndClaimPin(pool, userA, 'pin_center');
    await awardAndClaimPin(pool, userA, 'pin_close');
    await awardAndClaimPin(pool, userA, 'pin_far');

    // Place pin_center at (0.5, 0.5) -> (180px, 320px) in 360x640 space
    await repo.placePin(userA, 'pin_center', 0.5, 0.5);

    // Clearance is 46px.
    // 30px delta X is (30 / 360) = 0.0833... -> distance 30px < 46px -> OVERLAP!
    const tooCloseX = 0.5 + 30 / SHOWCASE_REFERENCE_SIZE.width;
    await expect(
      repo.placePin(userA, 'pin_close', tooCloseX, 0.5),
    ).rejects.toMatchObject({
      code: 'showcase_position_overlap',
    });

    // 60px delta X is (60 / 360) = 0.1666... -> distance 60px >= 46px -> SUCCEEDS!
    const clearX = 0.5 + 60 / SHOWCASE_REFERENCE_SIZE.width;
    const placedFar = await repo.placePin(userA, 'pin_far', clearX, 0.5);
    expect(placedFar.pinId).toBe('pin_far');

    // Self-move to slightly shifted valid position does not collide with itself
    await expect(
      repo.placePin(userA, 'pin_center', 0.51, 0.5),
    ).resolves.toBeDefined();
  });

  it('removes a placement and allows subsequent re-placement', async () => {
    await awardAndClaimPin(pool, userA, 'pin_remove');
    await repo.placePin(userA, 'pin_remove', 0.3, 0.3);

    // Remove
    await repo.removePin(userA, 'pin_remove');

    const showcaseAfterRemove = await repo.getShowcase(userA);
    expect(showcaseAfterRemove.placements).toHaveLength(0);
    expect(showcaseAfterRemove.unplaced).toContain('pin_remove');

    // Re-place succeeds
    await expect(
      repo.placePin(userA, 'pin_remove', 0.4, 0.4),
    ).resolves.toBeDefined();
  });

  it('distinguishes owner read (with unplaced) from friend read (unplaced omitted)', async () => {
    await awardAndClaimPin(pool, userA, 'placed_pin');
    await awardAndClaimPin(pool, userA, 'unplaced_pin');

    await repo.placePin(userA, 'placed_pin', 0.2, 0.2);

    const ownerView = await repo.getShowcase(userA);
    expect(ownerView.placements).toHaveLength(1);
    expect(ownerView.placements[0]?.pinId).toBe('placed_pin');
    expect(ownerView.unplaced).toEqual(['unplaced_pin']);

    const friendView = await repo.getFriendShowcase(userA);
    expect(friendView.placements).toHaveLength(1);
    expect(friendView.placements[0]?.pinId).toBe('placed_pin');
    expect(friendView.unplaced).toBeUndefined();
  });
});
