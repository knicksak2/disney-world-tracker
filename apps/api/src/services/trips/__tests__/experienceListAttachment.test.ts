/**
 * Property/integration tests for the Trip Experience_List Attachment Bridge
 * (Requirement 14, experience-lists spec, task 18.8).
 *
 * Mirrors `tripFoodLists.prop.test.ts`'s structure exactly, adapted to
 * Experience_Lists.
 *
 * Validates:
 *   - Property 16: Trip Attachment Eligibility and Idempotency
 *   - Property 17: Trip Attachment Is View-Access Only, Never a Scheduling Action
 *   - Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.8, 14.9
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
  createExperienceListRepo,
  createExperienceListShareRepo,
  type ExperienceListRepo,
  type ExperienceListShareRepo,
} from '../../experienceLists/repo.js';
import {
  createTripRepo,
  type TripRepo,
  type TripRepoDeps,
} from '../repo.js';

// ---------------------------------------------------------------------------
// pg-mem setup (copied verbatim from tripFoodLists.prop.test.ts — pure infra)
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

describe('Trip Experience Lists — Properties 16 & 17', { timeout: 120_000 }, () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let tripRepo: TripRepo;
  let experienceListRepo: ExperienceListRepo;
  let experienceListShareRepo: ExperienceListShareRepo;

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
    db.public.none(
      "ALTER TABLE experiences ADD COLUMN IF NOT EXISTS meal_periods JSONB NOT NULL DEFAULT '[]';",
    );
    applyMigration(db, '0022_planned_item_ride_options.sql');
    applyMigration(db, '0023_trip_touring_hours.sql');
    applyMigration(db, '0024_planned_item_optimization_result.sql');
    applyMigration(db, '0027_planned_items_soft_windows.sql');
    applyMigration(db, '0028_planned_items_meal_period_snack.sql');
    applyMigration(db, '0031_planned_item_reservations.sql');
    applyMigration(db, '0045_trip_walk_wait_weighting.sql');
    applyMigration(db, '0050_experience_lists.sql');
    applyMigration(db, '0053_experience_list_pinning.sql');
    applyMigration(db, '0051_trip_experience_lists.sql');

    const rawPool = db.adapters.createPg().Pool;
    pool = withForUpdateCompat(new rawPool() as unknown as DbPool);

    experienceListRepo = createExperienceListRepo(pool);
    experienceListShareRepo = createExperienceListShareRepo(pool);

    tripRepo = createTripRepo(pool, {
      completions: fakeCompletions,
      ratings: fakeRatings,
      // Mirrors the `resolveExperienceList` port wired into
      // `composeServices.ts` (task 18.7) exactly.
      resolveExperienceList: async (experienceListId: string) => {
        const res = await pool.query<{
          id: string;
          owner_id: string;
          visibility: 'private' | 'public';
          name: string;
          item_count: number;
          owner_display_name: string;
        }>(
          `SELECT
             el.id,
             el.owner_id,
             el.visibility,
             el.name,
             COALESCE(ic.item_count, 0)::int AS item_count,
             COALESCE(p.display_name, 'User') AS owner_display_name
           FROM experience_lists el
           LEFT JOIN profiles p ON p.user_id = el.owner_id
           LEFT JOIN (
             SELECT experience_list_id, COUNT(*)::int AS item_count
             FROM experience_lists_items
             GROUP BY experience_list_id
           ) ic ON ic.experience_list_id = el.id
          WHERE el.id = $1`,
          [experienceListId],
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

  async function seedExperience(
    name: string,
    category: string = 'Ride',
  ): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
       VALUES ($1, $2, $3, 'Magic Kingdom', $4)`,
      [id, `up-${id}`, name, category],
    );
    return id;
  }

  // -------------------------------------------------------------------------
  // Property 16: Trip Attachment Eligibility and Idempotency
  // -------------------------------------------------------------------------

  // Feature: experience-lists, Property 16: For any Trip and any Experience_List, an attach request succeeds and records exactly one `trip_experience_lists` row if and only if the requesting Trip_Member owns the Experience_List or its `visibility` is `public`; a repeat attach request for an already-linked pair changes nothing and still returns success (no error, no duplicate row); a request where the caller neither owns nor the list is public is rejected with `trip_experience_list_ineligible` and creates no row.
  it('Property 16: Trip Attachment Eligibility and Idempotency', async () => {
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
          const listA = await experienceListRepo.createList(userA, {
            name: "Alice's Thrill Rides",
          });

          // UserC creates listC
          const listC = await experienceListRepo.createList(userC, {
            name: "Charlie's Picks",
          });
          if (listCVisibility === 'public') {
            await experienceListRepo.setVisibility(listC.id, userC, 'public');
          } else {
            // Share listC with userB
            await experienceListShareRepo.shareWithFriend(
              listC.id,
              userC,
              userB,
              shareRole,
            );
          }

          // --- Part (a): Eligibility-gated attach ---
          // 1. UserB tries to attach listA (owned by userA, private) -> ineligible
          await expect(
            tripRepo.attachExperienceList(trip.id, userB, listA.id),
          ).rejects.toSatisfy(
            (err: unknown) =>
              err instanceof AppError &&
              err.code === 'trip_experience_list_ineligible',
          );

          // 2. UserB tries to attach listC:
          // If listC is private (even though userB has viewer/editor share), attachment is rejected!
          // If listC is public, attachment succeeds.
          if (listCVisibility === 'private') {
            await expect(
              tripRepo.attachExperienceList(trip.id, userB, listC.id),
            ).rejects.toSatisfy(
              (err: unknown) =>
                err instanceof AppError &&
                err.code === 'trip_experience_list_ineligible',
            );
          } else {
            await tripRepo.attachExperienceList(trip.id, userB, listC.id);
            // Verify link written — exactly one row.
            const checkC = await pool.query(
              `SELECT 1 FROM trip_experience_lists WHERE trip_id = $1 AND experience_list_id = $2`,
              [trip.id, listC.id],
            );
            expect(checkC.rows).toHaveLength(1);
          }

          // 3. UserA (owner) attaches listA -> SUCCEEDS
          await tripRepo.attachExperienceList(trip.id, userA, listA.id);
          const checkAAfterFirstAttach = await pool.query(
            `SELECT 1 FROM trip_experience_lists WHERE trip_id = $1 AND experience_list_id = $2`,
            [trip.id, listA.id],
          );
          expect(checkAAfterFirstAttach.rows).toHaveLength(1);

          // 4. Repeat attach of listA by userA -> no-op success, exactly one row still
          await expect(
            tripRepo.attachExperienceList(trip.id, userA, listA.id),
          ).resolves.not.toThrow();
          const checkAAfterRepeatAttach = await pool.query(
            `SELECT 1 FROM trip_experience_lists WHERE trip_id = $1 AND experience_list_id = $2`,
            [trip.id, listA.id],
          );
          expect(checkAAfterRepeatAttach.rows).toHaveLength(1);

          // 5. Attach non-existent list -> experience_list_not_found (the
          // attach-target lookup failing; confirmed no `trip_experience_list_not_found`
          // code exists — this is the same code used for the detach-not-found case).
          await expect(
            tripRepo.attachExperienceList(trip.id, userA, randomUUID()),
          ).rejects.toSatisfy(
            (err: unknown) =>
              err instanceof AppError &&
              err.code === 'experience_list_not_found',
          );

          // --- Part (b): Trip-derived access resolving true for a current member ---
          // UserB has no share row in experience_list_shares for listA.
          const sharesForListA = await pool.query(
            `SELECT 1 FROM experience_list_shares WHERE experience_list_id = $1 AND shared_with_user_id = $2`,
            [listA.id, userB],
          );
          expect(sharesForListA.rows).toHaveLength(0);

          // UserB can view listA solely via Trip membership
          const detailForB = await experienceListRepo.getListDetail(
            listA.id,
            userB,
          );
          expect(detailForB.id).toBe(listA.id);
          expect(detailForB.name).toBe("Alice's Thrill Rides");

          // Projection on Trip shows listA as available
          const tripDetail = await tripRepo.getTripForMember(trip.id);
          expect(tripDetail).not.toBeNull();
          const attachedListA = tripDetail!.experienceLists.find(
            (el) => el.experienceListId === listA.id,
          );
          expect(attachedListA).toBeDefined();
          expect(attachedListA!.available).toBe(true);

          // --- Part (c): Access reverts to false immediately on membership end or detach ---
          // Non-member UserD cannot view listA
          await expect(
            experienceListRepo.getListDetail(listA.id, userD),
          ).rejects.toSatisfy(
            (err: unknown) =>
              err instanceof AppError &&
              err.code === 'experience_list_not_found',
          );

          // Detach listA:
          // Third-party UserB cannot detach listA (added by userA, userB is member, not organizer)
          await expect(
            tripRepo.detachExperienceList(trip.id, userB, 'member', listA.id),
          ).rejects.toSatisfy(
            (err: unknown) =>
              err instanceof AppError && err.code === 'trip_forbidden',
          );

          // Detach by adder userA (adder-or-organizer detach gate)
          const detached = await tripRepo.detachExperienceList(
            trip.id,
            userA,
            'organizer',
            listA.id,
          );
          expect(detached).toBe(true);

          // Immediately, UserB loses view access to listA
          await expect(
            experienceListRepo.getListDetail(listA.id, userB),
          ).rejects.toSatisfy(
            (err: unknown) =>
              err instanceof AppError &&
              err.code === 'experience_list_not_found',
          );

          // But Owner UserA still has access (independent ownership exception)
          const detailForA = await experienceListRepo.getListDetail(
            listA.id,
            userA,
          );
          expect(detailForA.id).toBe(listA.id);

          // Detaching an already-detached (or never-attached) pair returns false.
          const detachAgain = await tripRepo.detachExperienceList(
            trip.id,
            userA,
            'organizer',
            listA.id,
          );
          expect(detachAgain).toBe(false);

          // Re-attach listA for membership removal test
          await tripRepo.attachExperienceList(trip.id, userA, listA.id);
          expect(
            (await experienceListRepo.getListDetail(listA.id, userB)).id,
          ).toBe(listA.id);

          // End UserB's membership on the Trip
          await pool.query(
            `DELETE FROM trip_memberships WHERE trip_id = $1 AND user_id = $2`,
            [trip.id, userB],
          );

          // UserB immediately loses access upon membership end
          await expect(
            experienceListRepo.getListDetail(listA.id, userB),
          ).rejects.toSatisfy(
            (err: unknown) =>
              err instanceof AppError &&
              err.code === 'experience_list_not_found',
          );

          // --- Part (d): Visibility flip to private does not retract Trip-derived access ---
          // UserA creates public listPub and attaches it to Trip
          const listPub = await experienceListRepo.createList(userA, {
            name: "Alice's Public Rides",
          });
          await experienceListRepo.setVisibility(listPub.id, userA, 'public');
          await tripRepo.attachExperienceList(trip.id, userA, listPub.id);

          // Add Dana (userD) to Trip
          await pool.query(
            `INSERT INTO trip_memberships (trip_id, user_id, role)
             VALUES ($1, $2, 'member')`,
            [trip.id, userD],
          );
          expect(
            (await experienceListRepo.getListDetail(listPub.id, userD)).id,
          ).toBe(listPub.id);

          // UserA flips visibility of listPub to 'private'
          await experienceListRepo.setVisibility(
            listPub.id,
            userA,
            'private',
          );

          // Dana (userD) still retains view access via the Trip attachment!
          const detailAfterFlip = await experienceListRepo.getListDetail(
            listPub.id,
            userD,
          );
          expect(detailAfterFlip.id).toBe(listPub.id);
          expect(detailAfterFlip.name).toBe("Alice's Public Rides");

          // Clean up for next iteration
          await pool.query(`DELETE FROM trips WHERE id = $1`, [trip.id]);
          await pool.query(
            `DELETE FROM experience_lists WHERE id IN ($1, $2, $3)`,
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

  // -------------------------------------------------------------------------
  // Property 17: Trip Attachment Is View-Access Only, Never a Scheduling Action
  // -------------------------------------------------------------------------

  async function snapshotPlannedItems(
    tripId: string,
  ): Promise<ReadonlyArray<Record<string, unknown>>> {
    const res = await pool.query<Record<string, unknown>>(
      `SELECT id, trip_id, experience_id, planned_date, item_type, priority
         FROM planned_items
        WHERE trip_id = $1
        ORDER BY id ASC`,
      [tripId],
    );
    return res.rows;
  }

  // Feature: experience-lists, Property 17: For any Trip and any Experience_List, attaching or detaching that list (Requirement 14) never creates, modifies, or deletes any `planned_items` row for that Trip — the set of `planned_items` rows belonging to a Trip immediately before and immediately after an attach/detach operation is identical.
  it('Property 17: attach/detach never touches planned_items', async () => {
    const owner = randomUUID();
    const organizer = randomUUID();
    await seedUser(owner, 'Owner');
    await seedUser(organizer, 'Organizer');

    const trip = await tripRepo.createTrip(organizer, {
      name: 'Property 17 Trip',
      startDate: '2026-11-01',
      endDate: '2026-11-05',
    });
    await pool.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [trip.id, owner],
    );

    // Seed the Trip with at least one real planned_items row referencing a
    // real Experience, via the existing `addPlannedItem` path.
    const plannedExperienceId = await seedExperience('Space Mountain', 'Ride');
    const plannedItem = await tripRepo.addPlannedItem(trip.id, organizer, {
      experienceId: plannedExperienceId,
      plannedDate: '2026-11-01',
    });
    expect(plannedItem).toBeDefined();

    const before = await snapshotPlannedItems(trip.id);
    expect(before).toHaveLength(1);

    // Create and attach an Experience_List owned by `owner`.
    const list = await experienceListRepo.createList(owner, {
      name: 'Property 17 List',
    });

    await tripRepo.attachExperienceList(trip.id, owner, list.id);

    const afterAttach = await snapshotPlannedItems(trip.id);
    expect(afterAttach).toEqual(before);
    expect(afterAttach).toHaveLength(1);

    // Detach it.
    const detached = await tripRepo.detachExperienceList(
      trip.id,
      organizer,
      'organizer',
      list.id,
    );
    expect(detached).toBe(true);

    const afterDetach = await snapshotPlannedItems(trip.id);
    expect(afterDetach).toEqual(before);
    expect(afterDetach).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Unavailable-entry projection: resolve-failure path (not a dangling FK,
  // since `experience_list_id` is ON DELETE CASCADE per R14.7 — a stale link
  // cannot exist via direct row deletion). Simulated via a port that throws
  // for one specific listId.
  // -------------------------------------------------------------------------

  it('projects available: false when the resolveExperienceList port throws for an attached list', async () => {
    const owner = randomUUID();
    await seedUser(owner, 'Owner');

    const trip = await tripRepo.createTrip(owner, {
      name: 'Unavailable Projection Trip',
      startDate: '2026-12-01',
      endDate: '2026-12-05',
    });

    const list = await experienceListRepo.createList(owner, {
      name: 'Transiently Unresolvable List',
    });

    // Build a second TripRepo instance whose `resolveExperienceList` port
    // throws for this specific list id, mirroring
    // `selectTripExperienceListsByTrip`'s catch-and-mark-unavailable behavior
    // (task 18.4) for a genuine transient read failure, distinct from the
    // cascade-deletion case.
    const flakyTripRepo = createTripRepo(pool, {
      completions: fakeCompletions,
      ratings: fakeRatings,
      resolveExperienceList: async (experienceListId: string) => {
        if (experienceListId === list.id) {
          throw new Error('simulated transient resolve failure');
        }
        return null;
      },
    });

    // Attach using the healthy repo (so the link row exists), then read the
    // projection back using the flaky repo.
    await tripRepo.attachExperienceList(trip.id, owner, list.id);

    const tripDetail = await flakyTripRepo.getTripForMember(trip.id);
    expect(tripDetail).not.toBeNull();
    const entry = tripDetail!.experienceLists.find(
      (el) => el.experienceListId === list.id,
    );
    expect(entry).toBeDefined();
    expect(entry).toEqual({
      available: false,
      experienceListId: list.id,
    });

    // The underlying link row still exists (this is a resolve failure, not a
    // deletion — the link survives, only the projection degrades).
    const linkRow = await pool.query(
      `SELECT 1 FROM trip_experience_lists WHERE trip_id = $1 AND experience_list_id = $2`,
      [trip.id, list.id],
    );
    expect(linkRow.rows).toHaveLength(1);
  });
});
