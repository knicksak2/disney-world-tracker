/**
 * Property 45: Recap album completeness, exact key set and serving keys (server half).
 *
 * Pages through the real album route (server.inject + pg-mem) and compares against an
 * in-memory oracle (filter + sort of the generated rows).
 *
 * Implements: Task 21.6
 * Validates: Requirements 15.27, 15.28, 15.29, 9.4, decision D35
 */

import fc from 'fast-check';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerErrorHandler } from '../../../errors/index.js';
import { DefaultRecapShareGate } from '../../sharing/tripRecapGate.js';
import { registerTripRecapRoutes } from '../../sharing/tripRecapRoutes.js';
import { photoKeys } from '../domain/objectKeys.js';
import { DefaultRecapPhotoPort } from '../recapPhotoPort.js';
import { FakeObjectStore } from './fakes.js';
import {
  SENTINEL_UPLOADER_ALICE,
  SENTINEL_UPLOADER_BOB,
  createCountingTripShareFacts,
  createRecapAlbumWorld,
  insertPhotos,
  type RecapAlbumWorld,
  type SeedPhoto,
  type SeedPhotoStatus,
} from './recapAlbumHarness.js';

const STATUSES: readonly SeedPhotoStatus[] = [
  'uploading',
  'pending',
  'approved',
  'rejected',
  'needs_review',
  'hidden',
  'deleted',
];

// A SMALL pool of timestamps forces many sort_at ties, so the id tiebreak is exercised.
const SORT_AT_POOL = [
  '2026-10-20T10:00:00.000Z',
  '2026-10-20T10:00:01.000Z',
  '2026-10-21T15:30:00.000Z',
  '2026-10-22T03:00:00.000Z',
  '2026-10-22T03:00:01.000Z',
];

type Owner = 'sender' | 'alice' | 'bob';
type TripChoice = 'main' | 'other';

// Weighted so most generated rows are eligible-looking (approved, main Trip): otherwise ties and
// multi-page runs would be rare and the property would barely exercise ordering and paging.
const rowArb = fc.record({
  id: fc.uuid(),
  status: fc.oneof(
    { weight: 6, arbitrary: fc.constant<SeedPhotoStatus>('approved') },
    { weight: 2, arbitrary: fc.constantFrom(...STATUSES) },
  ),
  sortAtIdx: fc.integer({ min: 0, max: SORT_AT_POOL.length - 1 }),
  owner: fc.constantFrom<Owner>('sender', 'alice', 'bob'),
  trip: fc.oneof(
    { weight: 5, arbitrary: fc.constant<TripChoice>('main') },
    { weight: 1, arbitrary: fc.constant<TripChoice>('other') },
  ),
});

const scenarioArb = fc.record({
  rows: fc.array(rowArb, { maxLength: 40 }),
  recipientBlocksBob: fc.boolean(),
  aliceBlocksRecipient: fc.boolean(),
  // Weighted toward small limits so most non-trivial runs span several pages (a uniform 1..100
  // limit against at most 40 rows would rarely page, making the multi-page counter flaky).
  limit: fc.oneof(
    { weight: 4, arbitrary: fc.integer({ min: 1, max: 6 }) },
    { weight: 1, arbitrary: fc.integer({ min: 1, max: 100 }) },
  ),
});

describe('Property 45: recap album completeness, exact key set and serving keys', () => {
  let world: RecapAlbumWorld;
  let app: FastifyInstance;
  const store = new FakeObjectStore();
  // Coverage counters: prove the generator really drove ties and multi-page runs.
  const stats = { multiPageRuns: 0, tieRuns: 0, nonEmptyRuns: 0 };

  beforeAll(async () => {
    world = createRecapAlbumWorld();
    const { facts } = createCountingTripShareFacts(world.pool);
    const gate = new DefaultRecapShareGate({ pool: world.pool, tripShareFacts: facts });
    const port = new DefaultRecapPhotoPort({ pool: world.pool, store, urlTtlSeconds: 3600 });
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    registerTripRecapRoutes(app, {
      requireSession: async (req) => {
        (req as any).user = { id: world.recipientId };
      },
      recapShareGate: gate,
      tripShareFacts: facts,
      recapPhotoPort: port,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // Feature: photo-uploads, Property 45: Recap album completeness, exact key set and serving keys
  it('following nextCursor returns exactly the approved, not-blocked photos of the share Trip, once each, in (sort_at desc, id desc) order, with exact key sets and serving keys only', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        // --- arrange: unique ids, owners, blocks
        const seen = new Set<string>();
        const rows = scenario.rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
        const ownerId = (o: Owner): string =>
          o === 'sender' ? world.senderId : o === 'alice' ? world.aliceId : world.bobId;
        const seeds: SeedPhoto[] = rows.map((r) => ({
          id: r.id,
          ownerId: ownerId(r.owner),
          tripId: r.trip === 'main' ? world.tripId : world.otherTripId,
          status: r.status,
          sortAt: SORT_AT_POOL[r.sortAtIdx]!,
        }));

        world.db.public.none('DELETE FROM photos');
        world.db.public.none('DELETE FROM user_blocks');
        if (scenario.recipientBlocksBob) {
          world.db.public.none(
            `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('${world.recipientId}', '${world.bobId}')`,
          );
        }
        if (scenario.aliceBlocksRecipient) {
          world.db.public.none(
            `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('${world.aliceId}', '${world.recipientId}')`,
          );
        }
        insertPhotos(world.db, seeds);

        store.objects.clear();
        store.presignedGets.length = 0;
        for (const s of seeds) {
          store.put(photoKeys(s.id).full, new Uint8Array([1]));
          store.put(photoKeys(s.id).thumb, new Uint8Array([2]));
        }

        // --- oracle
        const blockedOwners = new Set<string>();
        if (scenario.recipientBlocksBob) blockedOwners.add(world.bobId);
        if (scenario.aliceBlocksRecipient) blockedOwners.add(world.aliceId);
        const expected = seeds
          .filter((s) => s.tripId === world.tripId && s.status === 'approved' && !blockedOwners.has(s.ownerId))
          .sort((a, b) => {
            if (a.sortAt !== b.sortAt) return a.sortAt < b.sortAt ? 1 : -1;
            return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
          })
          .map((s) => s.id);

        // --- act: page through the real route
        const got: string[] = [];
        const pageSizes: number[] = [];
        const cursors: Array<string | null> = [];
        let cursor: string | null = null;
        let pages = 0;
        do {
          const query: string = `?limit=${scenario.limit}${cursor ? `&cursor=${cursor}` : ''}`;
          const res = await app.inject({
            method: 'GET',
            url: `/me/inbox/${world.shareId}/trip-recap/photos${query}`,
          });
          expect(res.statusCode).toBe(200);
          const body = res.json() as { access: string; photos: Array<Record<string, unknown>>; nextCursor: string | null };

          // exact key sets
          expect(Object.keys(body).sort()).toEqual(['access', 'nextCursor', 'photos']);
          expect(body.access).toBe('granted');
          for (const item of body.photos) {
            expect(Object.keys(item).sort()).toEqual(['height', 'id', 'sortAt', 'thumbUrl', 'url', 'width']);
          }
          // no identity or storage detail anywhere in the serialized page
          const serialized = JSON.stringify(body);
          for (const forbidden of [
            world.senderId,
            world.aliceId,
            world.bobId,
            world.recipientId,
            world.tripId,
            SENTINEL_UPLOADER_ALICE,
            SENTINEL_UPLOADER_BOB,
            'object_key',
            'thumb_key',
            'u/',
            'bucket',
          ]) {
            expect(serialized).not.toContain(forbidden);
          }

          for (const item of body.photos) got.push(item.id as string);
          pageSizes.push(body.photos.length);
          cursors.push(body.nextCursor);
          cursor = body.nextCursor;
          pages++;
          expect(pages).toBeLessThanOrEqual(expected.length + 2);
        } while (cursor);

        if (expected.length > 0) stats.nonEmptyRuns++;
        if (pages > 1) stats.multiPageRuns++;
        const eligibleSortAts = seeds
          .filter((s) => s.tripId === world.tripId && s.status === 'approved' && !blockedOwners.has(s.ownerId))
          .map((s) => s.sortAt);
        if (new Set(eligibleSortAts).size < eligibleSortAts.length) stats.tieRuns++;

        // --- assert: completeness, order, uniqueness
        expect(got).toEqual(expected);
        expect(new Set(got).size).toBe(got.length);

        // every page except the last has `limit` items; nextCursor is null exactly on the last page
        for (let i = 0; i < pageSizes.length - 1; i++) {
          expect(pageSizes[i]).toBe(scenario.limit);
          expect(cursors[i]).not.toBeNull();
        }
        expect(cursors[cursors.length - 1]).toBeNull();
        expect(pageSizes[pageSizes.length - 1]!).toBeLessThanOrEqual(scenario.limit);

        // --- assert: serving keys only, all present, exactly the returned photos
        const minted = store.mintedGetKeys();
        for (const key of minted) {
          expect(key).toMatch(/^p\/[0-9a-f-]{36}\/(full|thumb)\.jpg$/);
        }
        expect(store.missingGetKeys()).toEqual([]);
        const expectedKeys = expected.flatMap((id) => [photoKeys(id).full, photoKeys(id).thumb]).sort();
        expect([...minted].sort()).toEqual(expectedKeys);
      }),
      { numRuns: 100 },
    );

    // The run was not vacuous: ties on sort_at and multi-page paging were both actually exercised.
    expect(stats.nonEmptyRuns).toBeGreaterThan(20);
    expect(stats.tieRuns).toBeGreaterThan(10);
    expect(stats.multiPageRuns).toBeGreaterThan(5);
  }, 120_000);
});
