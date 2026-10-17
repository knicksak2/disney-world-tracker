import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  STARTER_PACKING_LIST,
  type PackingItemDTO,
  type PackingListDTO,
} from '@dwt/shared';
import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { createTripBookingRepo } from '../repo.js';
import { tripBookingRoutes } from '../routes.js';
import { setupTestDb } from './testDb.js';

describe('tripBooking routes: packing items', () => {
  let pool: DbPool;
  let testNow: Date;
  let activeUserId: string | null = null;
  let app: FastifyInstance;

  const ORGANIZER_ID = '11111111-1111-1111-1111-111111111111';
  const ADDER_MEMBER_ID = '22222222-2222-2222-2222-222222222222';
  const OTHER_MEMBER_ID = '33333333-3333-3333-3333-333333333333';
  const NON_MEMBER_ID = '44444444-4444-4444-4444-444444444444';
  const TRIP_ID = '55555555-5555-5555-5555-555555555555';
  const OTHER_TRIP_ID = '66666666-6666-6666-6666-666666666666';

  beforeEach(async () => {
    testNow = new Date('2026-08-01T12:00:00.000Z');
    activeUserId = ADDER_MEMBER_ID;

    const setup = setupTestDb();
    pool = setup.pool as unknown as DbPool;

    // Seed users and profiles
    const userSeeds: [string, string][] = [
      [ORGANIZER_ID, 'Alice Organizer'],
      [ADDER_MEMBER_ID, 'Bob Adder'],
      [OTHER_MEMBER_ID, 'Charlie Other'],
      [NON_MEMBER_ID, 'Dave Stranger'],
    ];
    for (const [uid, name] of userSeeds) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash')`,
        [uid, `${name.toLowerCase().replace(' ', '')}@example.com`],
      );
      await pool.query(
        `INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)`,
        [uid, name],
      );
    }

    // Seed two trips
    await pool.query(
      `INSERT INTO trips (id, name, start_date, end_date, creator_id)
       VALUES ($1, 'Main Trip', '2026-10-01', '2026-10-10', $3),
              ($2, 'Other Trip', '2026-11-01', '2026-11-10', $3)`,
      [TRIP_ID, OTHER_TRIP_ID, ORGANIZER_ID],
    );

    // Seed memberships for TRIP_ID
    await pool.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role)
       VALUES ($1, $2, 'organizer'),
              ($1, $3, 'member'),
              ($1, $4, 'member')`,
      [TRIP_ID, ORGANIZER_ID, ADDER_MEMBER_ID, OTHER_MEMBER_ID],
    );

    // Seed membership for OTHER_TRIP_ID (organizer only)
    await pool.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role)
       VALUES ($1, $2, 'organizer')`,
      [OTHER_TRIP_ID, ORGANIZER_ID],
    );

    const repo = createTripBookingRepo(pool);

    app = Fastify();
    registerErrorHandler(app);

    const requireSession: preHandlerHookHandler = async (request) => {
      if (activeUserId === null) {
        throw new AppError('unauthorized', 'Authentication is required.');
      }
      request.userId = activeUserId;
    };

    await app.register(
      tripBookingRoutes({
        repo,
        pool,
        requireSession,
        now: () => testNow,
      }),
    );
    await app.ready();
  });

  describe('GET /trips/:id/packing-items', () => {
    it('returns empty list for trip with no items', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/trips/${TRIP_ID}/packing-items`,
      });
      expect(res.statusCode).toBe(200);
      const data: PackingListDTO = res.json();
      expect(data).toEqual({
        items: [],
        totalCount: 0,
        packedCount: 0,
      });
    });

    it('rejects non-member with 403 trip_forbidden', async () => {
      activeUserId = NON_MEMBER_ID;
      const res = await app.inject({
        method: 'GET',
        url: `/trips/${TRIP_ID}/packing-items`,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('trip_forbidden');
    });

    it('orders items by category vocabulary then creation time', async () => {
      // Add items across different categories out of order
      activeUserId = ADDER_MEMBER_ID;
      await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/packing-items`,
        payload: { name: 'Sunscreen', category: 'toiletries' },
      });
      await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/packing-items`,
        payload: { name: 'Passport', category: 'documents' },
      });
      await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/packing-items`,
        payload: { name: 'Shirt', category: 'clothing' },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/trips/${TRIP_ID}/packing-items`,
      });
      expect(res.statusCode).toBe(200);
      const data: PackingListDTO = res.json();
      expect(data.totalCount).toBe(3);
      expect(data.packedCount).toBe(0);
      // Vocabulary order: documents, clothing, toiletries, health, tech, park_gear, kids, other
      expect(data.items.map((i) => i.name)).toEqual(['Passport', 'Shirt', 'Sunscreen']);
    });
  });

  describe('POST /trips/:id/packing-items', () => {
    it('creates item with trimmed name, default quantity 1, and unpacked state', async () => {
      activeUserId = ADDER_MEMBER_ID;
      const res = await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/packing-items`,
        payload: {
          name: '  Magic Band+  ',
          category: 'tech',
          assigneeId: OTHER_MEMBER_ID,
        },
      });
      expect(res.statusCode).toBe(201);
      const item: PackingItemDTO = res.json();
      expect(item.name).toBe('Magic Band+');
      expect(item.category).toBe('tech');
      expect(item.quantity).toBe(1);
      expect(item.packed).toBe(false);
      expect(item.packedAt).toBeNull();
      expect(item.packedByDisplayName).toBeNull();
      expect(item.addedById).toBe(ADDER_MEMBER_ID);
      expect(item.addedByDisplayName).toBe('Bob Adder');
      expect(item.assigneeId).toBe(OTHER_MEMBER_ID);
      expect(item.assigneeDisplayName).toBe('Charlie Other');
    });

    it('rejects whitespace-only name with 400 trip_validation_failed', async () => {
      activeUserId = ADDER_MEMBER_ID;
      const res = await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/packing-items`,
        payload: { name: '     ', category: 'clothing' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('trip_validation_failed');
    });

    it('rejects non-member assignee with 400 trip_validation_failed', async () => {
      activeUserId = ADDER_MEMBER_ID;
      const res = await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/packing-items`,
        payload: { name: 'Hat', category: 'park_gear', assigneeId: NON_MEMBER_ID },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('trip_validation_failed');
    });

    it('rejects when 300 cap is reached', async () => {
      activeUserId = ORGANIZER_ID;
      // Bulk insert 300 rows directly
      for (let i = 0; i < 300; i++) {
        await pool.query(
          `INSERT INTO trip_packing_items (trip_id, name, category, quantity, added_by)
           VALUES ($1, $2, 'clothing', 1, $3)`,
          [TRIP_ID, `Item ${i}`, ORGANIZER_ID],
        );
      }

      const res = await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/packing-items`,
        payload: { name: 'Item 301', category: 'clothing' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('trip_validation_failed');
    });
  });

  describe('POST /trips/:id/packing-items/starter', () => {
    it('adds starter items idempotently (21 on first run, 0 on second)', async () => {
      activeUserId = ADDER_MEMBER_ID;
      const res1 = await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/packing-items/starter`,
      });
      expect(res1.statusCode).toBe(200);
      expect(res1.json()).toEqual({ added: STARTER_PACKING_LIST.length });
      expect(res1.json().added).toBe(21);

      const res2 = await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/packing-items/starter`,
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json()).toEqual({ added: 0 });
    });
  });

  describe('Property 35 (route half): Only adder or organizer edits/removes; any member may toggle packed', () => {
    let itemId: string;

    beforeEach(async () => {
      // Bob adds an item
      activeUserId = ADDER_MEMBER_ID;
      const res = await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/packing-items`,
        payload: { name: 'Camera', category: 'tech', quantity: 1 },
      });
      itemId = res.json().id;
    });

    it('rejects a third member from modifying or deleting someone elses item', async () => {
      activeUserId = OTHER_MEMBER_ID;

      // Charlie attempts PATCH
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/trips/${TRIP_ID}/packing-items/${itemId}`,
        payload: { name: 'My Camera Now' },
      });
      expect(patchRes.statusCode).toBe(403);
      expect(patchRes.json().error.code).toBe('trip_forbidden');

      // Charlie attempts DELETE
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/trips/${TRIP_ID}/packing-items/${itemId}`,
      });
      expect(deleteRes.statusCode).toBe(403);
      expect(deleteRes.json().error.code).toBe('trip_forbidden');

      // Row is unchanged
      const rows = await pool.query(
        `SELECT name FROM trip_packing_items WHERE id = $1`,
        [itemId],
      );
      expect(rows.rows[0]?.name).toBe('Camera');
    });

    it('allows adder to update and delete their own item', async () => {
      activeUserId = ADDER_MEMBER_ID;

      // Bob updates name and quantity
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/trips/${TRIP_ID}/packing-items/${itemId}`,
        payload: { name: 'DSLR Camera', quantity: 2 },
      });
      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().name).toBe('DSLR Camera');
      expect(patchRes.json().quantity).toBe(2);

      // Bob deletes
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/trips/${TRIP_ID}/packing-items/${itemId}`,
      });
      expect(deleteRes.statusCode).toBe(204);

      // Verify removed
      const rows = await pool.query(
        `SELECT count(*) as c FROM trip_packing_items WHERE id = $1`,
        [itemId],
      );
      expect(Number(rows.rows[0]?.c)).toBe(0);
    });

    it('allows organizer to update and delete an item added by someone else', async () => {
      activeUserId = ORGANIZER_ID;

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/trips/${TRIP_ID}/packing-items/${itemId}`,
        payload: { quantity: 3 },
      });
      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().quantity).toBe(3);

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/trips/${TRIP_ID}/packing-items/${itemId}`,
      });
      expect(deleteRes.statusCode).toBe(204);
    });

    it('after adder leaves the trip, only an organizer can edit/remove', async () => {
      // Bob leaves the trip
      await pool.query(
        `DELETE FROM trip_memberships WHERE trip_id = $1 AND user_id = $2`,
        [TRIP_ID, ADDER_MEMBER_ID],
      );

      // Charlie (regular member) cannot edit
      activeUserId = OTHER_MEMBER_ID;
      const charliePatch = await app.inject({
        method: 'PATCH',
        url: `/trips/${TRIP_ID}/packing-items/${itemId}`,
        payload: { name: 'Adopting item' },
      });
      expect(charliePatch.statusCode).toBe(403);
      expect(charliePatch.json().error.code).toBe('trip_forbidden');

      // Alice (organizer) can edit
      activeUserId = ORGANIZER_ID;
      const alicePatch = await app.inject({
        method: 'PATCH',
        url: `/trips/${TRIP_ID}/packing-items/${itemId}`,
        payload: { name: 'Adopted by Organizer' },
      });
      expect(alicePatch.statusCode).toBe(200);
      expect(alicePatch.json().name).toBe('Adopted by Organizer');
    });

    it('any member may toggle packed state', async () => {
      // Charlie (not the adder) toggles packed to true
      activeUserId = OTHER_MEMBER_ID;
      const packRes = await app.inject({
        method: 'PUT',
        url: `/trips/${TRIP_ID}/packing-items/${itemId}/packed`,
        payload: { packed: true },
      });
      expect(packRes.statusCode).toBe(200);
      const packed: PackingItemDTO = packRes.json();
      expect(packed.packed).toBe(true);
      expect(packed.packedByDisplayName).toBe('Charlie Other');
      expect(packed.packedAt).toBeTruthy();

      // Alice (organizer) toggles packed to false
      activeUserId = ORGANIZER_ID;
      const unpackRes = await app.inject({
        method: 'PUT',
        url: `/trips/${TRIP_ID}/packing-items/${itemId}/packed`,
        payload: { packed: false },
      });
      expect(unpackRes.statusCode).toBe(200);
      const unpacked: PackingItemDTO = unpackRes.json();
      expect(unpacked.packed).toBe(false);
      expect(unpacked.packedByDisplayName).toBeNull();
      expect(unpacked.packedAt).toBeNull();
    });

    it('returns 404 trip_not_found for an item belonging to another trip', async () => {
      activeUserId = ORGANIZER_ID;
      const res = await app.inject({
        method: 'PATCH',
        url: `/trips/${OTHER_TRIP_ID}/packing-items/${itemId}`,
        payload: { name: 'Hijack' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('trip_not_found');
    });

    it('returns 404 trip_not_found for an unknown item ID', async () => {
      activeUserId = ORGANIZER_ID;
      const unknownId = randomUUID();
      const res = await app.inject({
        method: 'PATCH',
        url: `/trips/${TRIP_ID}/packing-items/${unknownId}`,
        payload: { name: 'Phantom' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('trip_not_found');
    });
  });
});
