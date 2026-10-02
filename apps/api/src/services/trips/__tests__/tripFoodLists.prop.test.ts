/**
 * Property tests for Trip-attached Food_Lists (R22, Property 27).
 *
 * Validates:
 *   - Property 27: Trip-derived Food_List access tracks membership live and is eligibility-gated at attach time
 *   - Requirements: 22.1, 22.2, 22.3, 22.4, 22.5, 22.7, 22.8, 22.9, 22.10
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import {
  createFoodListRepo,
  createFoodListShareRepo,
  type FoodListRepo,
  type FoodListShareRepo,
} from '../../foodLists/repo.js';
import {
  createTripRepo,
  type TripRepo,
  type TripRepoDeps,
} from '../repo.js';

// ---------------------------------------------------------------------------
// pg-mem setup
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
    implementation: (s: unknown): number =>
      typeof s === 'string' ? s.length : 0,
  });
  pub.registerFunction({
    name: 'lower',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string =>
      typeof s === 'string' ? s.toLowerCase() : '',
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

function withForUpdateCompat(base: DbPool): DbPool {
  const raw = base as unknown as {
    query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
    connect(): Promise<{
      query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
      release(): void;
    }>;
  };
  const strip = (t: string): string =>
    t.replace(/\s+FOR\s+UPDATE(\s+OF\s+\w+)?/giu, '');
  return {
    query(text: string, params?: ReadonlyArray<unknown>) {
      return raw.query(strip(text), params);
    },
    async connect() {
      const client = await raw.connect();
      return {
        query(text: string, params?: ReadonlyArray<unknown>) {
          return client.query(strip(text), params);
        },
        release() {
          client.release();
        },
      };
    },
  } as unknown as DbPool;
}

const fakeCompletions = {} as TripRepoDeps['completions'];
const fakeRatings = {} as TripRepoDeps['ratings'];

describe('Trip Food Lists — Property 27', { timeout: 120_000 }, () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let tripRepo: TripRepo;
  let foodListRepo: FoodListRepo;
  let foodListShareRepo: FoodListShareRepo;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    applyMigration(db, '0001_init.sql');
    db.public.none(`
      CREATE TABLE resorts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE
      );
    `);
    applyMigration(db, '0015_trips.sql');
    applyMigration(db, '0016_trip_resorts.sql');
    applyMigration(db, '0019_planned_item_scheduling.sql');
    applyMigration(db, '0023_trip_touring_hours.sql');
    applyMigration(db, '0045_trip_walk_wait_weighting.sql');
    applyMigration(db, '0040_food_item_logging.sql');
    applyMigration(db, '0041_food_lists.sql');
    applyMigration(db, '0042_trip_food_lists.sql');
    applyMigration(db, '0047_food_list_checklist.sql');
    applyMigration(db, '0052_food_list_pinning.sql');

    const rawPool = db.adapters.createPg().Pool;
    pool = withForUpdateCompat(new rawPool() as unknown as DbPool);

    foodListRepo = createFoodListRepo(pool);
    foodListShareRepo = createFoodListShareRepo(pool);

    tripRepo = createTripRepo(pool, {
      completions: fakeCompletions,
      ratings: fakeRatings,
      resolveFoodList: async (foodListId: string) => {
        const res = await pool.query<{
          id: string;
          owner_id: string;
          visibility: 'private' | 'public';
          name: string;
          item_count: number;
          owner_display_name: string;
        }>(
          `SELECT fl.id, fl.owner_id, fl.visibility, fl.name,
                  COALESCE(ic.item_count, 0)::int AS item_count,
                  COALESCE(p.display_name, 'User') AS owner_display_name
             FROM food_lists fl
             LEFT JOIN profiles p ON p.user_id = fl.owner_id
             LEFT JOIN (
               SELECT food_list_id, COUNT(*)::int AS item_count
                 FROM food_lists_items
                GROUP BY food_list_id
             ) ic ON ic.food_list_id = fl.id
            WHERE fl.id = $1`,
          [foodListId],
        );
        if (res.rows.length === 0) return null;
        const r = res.rows[0]!;
        return {
          id: r.id,
          ownerId: r.owner_id,
          visibility: r.visibility,
          name: r.name,
          itemCount: r.item_count,
          ownerDisplayName: r.owner_display_name,
        };
      },
    });
  });

  async function seedUser(id: string, name: string): Promise<void> {
    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, $2, 'hash')
       ON CONFLICT (id) DO NOTHING`,
      [id, `${name.toLowerCase()}-${id.slice(0, 8)}@test.com`],
    );
    await pool.query(
      `INSERT INTO profiles (user_id, display_name)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET display_name = $2`,
      [id, name],
    );
  }

  // Feature: trips, Property 27: Trip-derived Food_List access tracks membership live and is eligibility-gated at attach time
  it('Property 27: Trip-derived Food_List access tracks membership live and is eligibility-gated at attach time', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<'private' | 'public'>('private', 'public'),
        fc.constantFrom<'viewer' | 'editor'>('viewer', 'editor'),
        async (listCVisibility, shareRole) => {
          const userA = randomUUID();
          const userB = randomUUID();
          const userC = randomUUID();
          const userD = randomUUID();

          await seedUser(userA, 'Alice');
          await seedUser(userB, 'Bob');
          await seedUser(userC, 'Charlie');
          await seedUser(userD, 'Dana');

          // Establish friendship between C and B so C can share with B
          await pool.query(
            `INSERT INTO friendships (user_lo_id, user_hi_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            userB < userC ? [userB, userC] : [userC, userB],
          );

          // UserA creates a Trip (organizer). UserB is added as member.
          const trip = await tripRepo.createTrip(userA, {
            name: 'EPCOT Trip',
            startDate: '2026-10-01',
            endDate: '2026-10-05',
          });
          await pool.query(
            `INSERT INTO trip_memberships (trip_id, user_id, role)
             VALUES ($1, $2, 'member')`,
            [trip.id, userB],
          );

          // UserA creates listA (private by default)
          const listA = await foodListRepo.createList(userA, { name: "Alice's Snacks" });

          // UserC creates listC
          const listC = await foodListRepo.createList(userC, { name: "Charlie's Picks" });
          if (listCVisibility === 'public') {
            await foodListRepo.setVisibility(listC.id, userC, 'public');
          } else {
            // Share listC with userB
            await foodListShareRepo.shareWithFriend(listC.id, userC, userB, shareRole);
          }

          // --- Part (a): Eligibility-gated attach ---
          // 1. UserB tries to attach listA (owned by userA, private) -> ineligible
          await expect(
            tripRepo.attachFoodList(trip.id, userB, listA.id),
          ).rejects.toSatisfy(
            (err: unknown) =>
              err instanceof AppError && err.code === 'trip_food_list_ineligible',
          );

          // 2. UserB tries to attach listC:
          // If listC is private (even though userB has viewer/editor share), attachment is rejected!
          // If listC is public, attachment succeeds.
          if (listCVisibility === 'private') {
            await expect(
              tripRepo.attachFoodList(trip.id, userB, listC.id),
            ).rejects.toSatisfy(
              (err: unknown) =>
                err instanceof AppError &&
                err.code === 'trip_food_list_ineligible',
            );
          } else {
            await tripRepo.attachFoodList(trip.id, userB, listC.id);
            // Verify link written
            const checkC = await pool.query(
              `SELECT 1 FROM trip_food_lists WHERE trip_id = $1 AND food_list_id = $2`,
              [trip.id, listC.id],
            );
            expect(checkC.rows).toHaveLength(1);
          }

          // 3. UserA (owner) attaches listA -> SUCCEEDS
          await tripRepo.attachFoodList(trip.id, userA, listA.id);

          // 4. Repeat attach of listA by userA -> no-op success
          await expect(
            tripRepo.attachFoodList(trip.id, userA, listA.id),
          ).resolves.not.toThrow();

          // 5. Attach non-existent list -> trip_food_list_not_found
          await expect(
            tripRepo.attachFoodList(trip.id, userA, randomUUID()),
          ).rejects.toSatisfy(
            (err: unknown) =>
              err instanceof AppError &&
              err.code === 'trip_food_list_not_found',
          );

          // --- Part (b): Trip-derived access resolving true for a current member ---
          // UserB has no share row in food_list_shares for listA.
          const sharesForListA = await pool.query(
            `SELECT 1 FROM food_list_shares WHERE food_list_id = $1 AND shared_with_user_id = $2`,
            [listA.id, userB],
          );
          expect(sharesForListA.rows).toHaveLength(0);

          // UserB can view listA solely via Trip membership
          const detailForB = await foodListRepo.getListDetail(listA.id, userB);
          expect(detailForB.id).toBe(listA.id);
          expect(detailForB.name).toBe("Alice's Snacks");

          // Projection on Trip shows listA as available
          const tripDetail = await tripRepo.getTripForMember(trip.id);
          expect(tripDetail).not.toBeNull();
          const attachedListA = tripDetail!.foodLists.find(
            (fl) => fl.foodListId === listA.id,
          );
          expect(attachedListA).toBeDefined();
          expect(attachedListA!.available).toBe(true);

          // --- Part (c): Access reverts to false immediately on membership end or detach ---
          // Non-member UserD cannot view listA
          await expect(
            foodListRepo.getListDetail(listA.id, userD),
          ).rejects.toSatisfy(
            (err: unknown) =>
              err instanceof AppError && err.code === 'food_list_not_found',
          );

          // Detach listA:
          // Third-party UserB cannot detach listA (added by userA, userB is member, not organizer)
          await expect(
            tripRepo.detachFoodList(trip.id, userB, 'member', listA.id),
          ).rejects.toSatisfy(
            (err: unknown) =>
              err instanceof AppError && err.code === 'trip_forbidden',
          );

          // Detach by adder userA
          const detached = await tripRepo.detachFoodList(
            trip.id,
            userA,
            'organizer',
            listA.id,
          );
          expect(detached).toBe(true);

          // Immediately, UserB loses view access to listA
          await expect(
            foodListRepo.getListDetail(listA.id, userB),
          ).rejects.toSatisfy(
            (err: unknown) =>
              err instanceof AppError && err.code === 'food_list_not_found',
          );

          // But Owner UserA still has access (independent ownership exception)
          const detailForA = await foodListRepo.getListDetail(listA.id, userA);
          expect(detailForA.id).toBe(listA.id);

          // Re-attach listA for membership removal test
          await tripRepo.attachFoodList(trip.id, userA, listA.id);
          expect((await foodListRepo.getListDetail(listA.id, userB)).id).toBe(
            listA.id,
          );

          // End UserB's membership on the Trip
          await pool.query(
            `DELETE FROM trip_memberships WHERE trip_id = $1 AND user_id = $2`,
            [trip.id, userB],
          );

          // UserB immediately loses access upon membership end
          await expect(
            foodListRepo.getListDetail(listA.id, userB),
          ).rejects.toSatisfy(
            (err: unknown) =>
              err instanceof AppError && err.code === 'food_list_not_found',
          );

          // --- Part (d): Visibility flip to private does not retract Trip-derived access ---
          // UserA creates public listPub and attaches it to Trip
          const listPub = await foodListRepo.createList(userA, {
            name: "Alice's Public Treats",
          });
          await foodListRepo.setVisibility(listPub.id, userA, 'public');
          await tripRepo.attachFoodList(trip.id, userA, listPub.id);

          // Add Dana (userD) to Trip
          await pool.query(
            `INSERT INTO trip_memberships (trip_id, user_id, role)
             VALUES ($1, $2, 'member')`,
            [trip.id, userD],
          );
          expect((await foodListRepo.getListDetail(listPub.id, userD)).id).toBe(
            listPub.id,
          );

          // UserA flips visibility of listPub to 'private'
          await foodListRepo.setVisibility(listPub.id, userA, 'private');

          // Dana (userD) still retains view access via the Trip attachment!
          const detailAfterFlip = await foodListRepo.getListDetail(
            listPub.id,
            userD,
          );
          expect(detailAfterFlip.id).toBe(listPub.id);
          expect(detailAfterFlip.name).toBe("Alice's Public Treats");

          // Clean up for next iteration
          await pool.query(`DELETE FROM trips WHERE id = $1`, [trip.id]);
          await pool.query(
            `DELETE FROM food_lists WHERE id IN ($1, $2, $3)`,
            [listA.id, listC.id, listPub.id],
          );
          await pool.query(
            `DELETE FROM users WHERE id IN ($1, $2, $3, $4)`,
            [userA, userB, userC, userD],
          );
        },
      ),
      { numRuns: 100 },
    );
  }, 240000);
});
