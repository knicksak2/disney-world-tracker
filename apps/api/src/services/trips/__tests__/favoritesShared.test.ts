// Feature: experience-favorites, Property 9: Group Favorites Reflects Only Current Trip Membership, Computed at Read Time
// Feature: experience-favorites, Property 10: Group Favorites Requires a Strict Majority-of-Two Overlap and Excludes Singletons
// Feature: experience-favorites, Property 11: Trip Membership Gate Collapses Non-Member and Non-Existent Trip Identically

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { GroupFavoriteDTO } from '@dwt/shared';
import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import {
  createTripRepo,
  type TripRepo,
  type TripRepoDeps,
} from '../repo.js';
import { tripRoutes } from '../routes.js';

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
  const strip = (t: string): string => {
    let s = t.replace(/\s+FOR\s+UPDATE(\s+OF\s+\w+)?/giu, '');
    if (s.includes('HAVING count(*) >= 2')) {
      s = `SELECT * FROM (${s.replace('HAVING count(*) >= 2', '')}) sub WHERE favoriting_count >= 2`;
    }
    return s;
  };
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

const NOOP_DEPS: TripRepoDeps = {
  completions: {} as any,
  ratings: {} as any,
};

describe('Trip Group Favorites', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let tripRepo: TripRepo;

  beforeEach(() => {
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
    applyMigration(db, '0054_experience_favorites.sql');

    const rawPool = db.adapters.createPg().Pool;
    pool = withForUpdateCompat(new rawPool() as unknown as DbPool);
    tripRepo = createTripRepo(pool, NOOP_DEPS);
  });

  async function createUser(displayName: string): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, $2, 'hash')`,
      [id, `${id}@example.com`],
    );
    await pool.query(
      `INSERT INTO profiles (user_id, display_name)
       VALUES ($1, $2)`,
      [id, displayName],
    );
    return id;
  }

  async function createExperience(name: string, active = true): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO experiences (id, name, category, park, active, upstream_entity_id)
       VALUES ($1, $2, 'Ride', 'Magic Kingdom', $3, $4)`,
      [id, name, active, `upstream-${id}`],
    );
    return id;
  }

  async function createTrip(organizerId: string, name = 'WDW Vacation'): Promise<string> {
    const trip = await tripRepo.createTrip(organizerId, {
      name,
      description: 'Trip description',
      startDate: '2026-10-10',
      endDate: '2026-10-15',
    });
    return trip.id;
  }

  async function addMember(tripId: string, userId: string): Promise<void> {
    await pool.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [tripId, userId],
    );
  }

  async function removeMember(tripId: string, userId: string): Promise<void> {
    await pool.query(
      `DELETE FROM trip_memberships WHERE trip_id = $1 AND user_id = $2`,
      [tripId, userId],
    );
  }

  async function addFavorite(userId: string, experienceId: string): Promise<void> {
    await pool.query(
      `INSERT INTO experience_favorites (user_id, experience_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [userId, experienceId],
    );
  }

  // Feature: experience-favorites, Property 9: Group Favorites Reflects Only Current Trip Membership, Computed at Read Time
  it('Property 9: Departed member favorite is excluded immediately on read', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10 }), async () => {
        const u1 = await createUser('Alice');
        const u2 = await createUser('Bob');
        const tripId = await createTrip(u1);
        await addMember(tripId, u2);

        const expId = await createExperience(`Exp-${randomUUID()}`);
        await addFavorite(u1, expId);
        await addFavorite(u2, expId);

        // Before departure: both Alice and Bob are members, count = 2
        let groupFavs = await tripRepo.getGroupFavorites(tripId, u1);
        expect(groupFavs).toHaveLength(1);
        expect(groupFavs[0]!.experienceId).toBe(expId);
        expect(groupFavs[0]!.favoritingCount).toBe(2);
        expect(groupFavs[0]!.favoritingDisplayNames).toEqual(['Alice', 'Bob']);

        // Bob leaves trip
        await removeMember(tripId, u2);

        // Immediately on read: Bob is excluded, now only 1 member has it -> excluded from group favorites
        groupFavs = await tripRepo.getGroupFavorites(tripId, u1);
        expect(groupFavs).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: experience-favorites, Property 10: Group Favorites Requires a Strict Majority-of-Two Overlap and Excludes Singletons
  it('Property 10: Requires >= 2 overlap, excludes singletons and inactive experiences', async () => {
    const u1 = await createUser('Alice');
    const u2 = await createUser('Bob');
    const u3 = await createUser('Charlie');
    const tripId = await createTrip(u1);
    await addMember(tripId, u2);
    await addMember(tripId, u3);

    const members = [
      { id: u1, name: 'Alice' },
      { id: u2, name: 'Bob' },
      { id: u3, name: 'Charlie' },
    ];

    await fc.assert(
      fc.asyncProperty(
        fc.subarray([0, 1, 2]),
        fc.boolean(),
        async (favoritingMemberIndices, isActive) => {
          const expName = `Exp-${randomUUID()}`;
          const expId = await createExperience(expName, isActive);

          for (const idx of favoritingMemberIndices) {
            await addFavorite(members[idx]!.id, expId);
          }

          const groupFavs = await tripRepo.getGroupFavorites(tripId, u1);
          const found = groupFavs.find((f) => f.experienceId === expId);

          if (!isActive || favoritingMemberIndices.length < 2) {
            expect(found).toBeUndefined();
          } else {
            expect(found).toBeDefined();
            expect(found!.favoritingCount).toBe(favoritingMemberIndices.length);
            const expectedNames = favoritingMemberIndices
              .map((i) => members[i]!.name)
              .sort();
            expect(found!.favoritingDisplayNames).toEqual(expectedNames);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: experience-favorites, Property 11: Trip Membership Gate Collapses Non-Member and Non-Existent Trip Identically
  it('Property 11: Non-member and non-existent trip collapse to identical 403 trip_forbidden', async () => {
    const u1 = await createUser('Alice');
    const outsider = await createUser('Outsider');
    const tripId = await createTrip(u1);

    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (useNonExistentTrip) => {
        const targetTripId = useNonExistentTrip ? randomUUID() : tripId;

        let err: unknown;
        try {
          await tripRepo.getGroupFavorites(targetTripId, outsider);
        } catch (e) {
          err = e;
        }

        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('trip_forbidden');
      }),
      { numRuns: 100 },
    );
  });

  describe('Route server.inject tests for GET /trips/:id/favorites/shared', () => {
    let app: FastifyInstance;
    let memberId: string;
    let outsiderId: string;
    let tripId: string;
    let expId: string;

    beforeEach(async () => {
      memberId = await createUser('Alice');
      const member2 = await createUser('Bob');
      outsiderId = await createUser('Dave');
      tripId = await createTrip(memberId);
      await addMember(tripId, member2);

      expId = await createExperience('Space Mountain', true);
      await addFavorite(memberId, expId);
      await addFavorite(member2, expId);

      app = Fastify();
      registerErrorHandler(app);

      let currentUserId: string | undefined;
      const requireSession = async (req: any) => {
        if (currentUserId) {
          req.userId = currentUserId;
        }
      };

      app.decorate('setCurrentUser', (uid?: string) => {
        currentUserId = uid;
      });

      void app.register(
        tripRoutes({
          repo: tripRepo,
          pool,
          requireSession,
        }),
      );

      await app.ready();
    });

    it('returns 401 unauthorized when unauthenticated', async () => {
      (app as any).setCurrentUser(undefined);
      const res = await app.inject({
        method: 'GET',
        url: `/trips/${tripId}/favorites/shared`,
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error?.code).toBe('unauthorized');
    });

    it('returns 403 trip_forbidden when caller is not a member', async () => {
      (app as any).setCurrentUser(outsiderId);
      const res = await app.inject({
        method: 'GET',
        url: `/trips/${tripId}/favorites/shared`,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error?.code).toBe('trip_forbidden');
    });

    it('returns 403 trip_forbidden when trip does not exist', async () => {
      (app as any).setCurrentUser(memberId);
      const nonExistent = randomUUID();
      const res = await app.inject({
        method: 'GET',
        url: `/trips/${nonExistent}/favorites/shared`,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error?.code).toBe('trip_forbidden');
    });

    it('returns 200 with GroupFavoritesResponseDTO when caller is a member', async () => {
      (app as any).setCurrentUser(memberId);
      const res = await app.inject({
        method: 'GET',
        url: `/trips/${tripId}/favorites/shared`,
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data).toHaveProperty('items');
      expect(data.items).toHaveLength(1);
      const item: GroupFavoriteDTO = data.items[0];
      expect(item.experienceId).toBe(expId);
      expect(item.experienceName).toBe('Space Mountain');
      expect(item.favoritingCount).toBe(2);
      expect(item.favoritingDisplayNames).toEqual(['Alice', 'Bob']);
    });
  });
});
