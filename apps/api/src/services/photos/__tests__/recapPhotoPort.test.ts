/**
 * pg-mem tests for the real SQL behind DefaultRecapPhotoPort.albumPage / isAlbumPhoto (decision D35).
 *
 * Implements: Task 21.6
 * Validates: Requirements 15.27, 15.29, 16.10, decisions D32, D35
 */

import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';

import type { RecapShareAccess } from '../../sharing/ports.js';
import { photoKeys } from '../domain/objectKeys.js';
import { DefaultRecapPhotoPort } from '../recapPhotoPort.js';
import {
  createRecapAlbumWorld,
  insertPhotos,
  storeWithServingObjects,
  type RecapAlbumWorld,
  type SeedPhotoStatus,
} from './recapAlbumHarness.js';
import type { FakeObjectStore } from './fakes.js';

const ALL_STATUSES: readonly SeedPhotoStatus[] = [
  'uploading',
  'pending',
  'approved',
  'rejected',
  'needs_review',
  'hidden',
  'deleted',
];

describe('DefaultRecapPhotoPort album SQL (pg-mem)', () => {
  let world: RecapAlbumWorld;
  let store: FakeObjectStore;
  let port: DefaultRecapPhotoPort;
  let access: RecapShareAccess;
  const statusPhotoIds = new Map<SeedPhotoStatus, string>();
  let approvedId: string;
  let otherTripPhotoId: string;
  let blockedByRecipientPhotoId: string;
  let blockedRecipientPhotoId: string;

  beforeEach(() => {
    world = createRecapAlbumWorld();
    statusPhotoIds.clear();

    const seeds = ALL_STATUSES.map((status, i) => {
      const id = randomUUID();
      statusPhotoIds.set(status, id);
      return {
        id,
        ownerId: world.aliceId,
        tripId: world.tripId,
        status,
        sortAt: `2026-10-20T10:0${i}:00.000Z`,
      };
    });
    approvedId = statusPhotoIds.get('approved')!;
    otherTripPhotoId = randomUUID();
    blockedByRecipientPhotoId = randomUUID();
    blockedRecipientPhotoId = randomUUID();
    insertPhotos(world.db, [
      ...seeds,
      { id: otherTripPhotoId, ownerId: world.carolId, tripId: world.otherTripId, status: 'approved', sortAt: '2026-10-21T10:00:00.000Z' },
      { id: blockedByRecipientPhotoId, ownerId: world.bobId, tripId: world.tripId, status: 'approved', sortAt: '2026-10-22T10:00:00.000Z' },
      { id: blockedRecipientPhotoId, ownerId: world.senderId, tripId: world.tripId, status: 'approved', sortAt: '2026-10-23T10:00:00.000Z' },
    ]);

    store = storeWithServingObjects([
      approvedId,
      otherTripPhotoId,
      blockedByRecipientPhotoId,
      blockedRecipientPhotoId,
    ]);
    port = new DefaultRecapPhotoPort({ pool: world.pool, store, urlTtlSeconds: 3600 });
    access = {
      tripId: world.tripId,
      sharerId: world.senderId,
      includePhotos: true,
      tripAvailable: true,
    };
  });

  describe('isAlbumPhoto', () => {
    it('is true for an approved photo of the share Trip', async () => {
      await expect(port.isAlbumPhoto(access, world.recipientId, approvedId)).resolves.toBe(true);
    });

    it('is false for a photo of another Trip', async () => {
      await expect(port.isAlbumPhoto(access, world.recipientId, otherTripPhotoId)).resolves.toBe(false);
    });

    it.each(ALL_STATUSES.filter((s) => s !== 'approved'))('is false for a %s photo', async (status) => {
      const id = statusPhotoIds.get(status)!;
      await expect(port.isAlbumPhoto(access, world.recipientId, id)).resolves.toBe(false);
    });

    it('is false when the recipient blocked the uploader', async () => {
      world.db.public.none(
        `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('${world.recipientId}', '${world.bobId}')`,
      );
      await expect(port.isAlbumPhoto(access, world.recipientId, blockedByRecipientPhotoId)).resolves.toBe(false);
      // an unrelated uploader stays reportable
      await expect(port.isAlbumPhoto(access, world.recipientId, approvedId)).resolves.toBe(true);
    });

    it('is false when the uploader blocked the recipient', async () => {
      world.db.public.none(
        `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('${world.senderId}', '${world.recipientId}')`,
      );
      await expect(port.isAlbumPhoto(access, world.recipientId, blockedRecipientPhotoId)).resolves.toBe(false);
      await expect(port.isAlbumPhoto(access, world.recipientId, approvedId)).resolves.toBe(true);
    });

    it('is false and runs no query when includePhotos is false', async () => {
      const before = world.queryLog.length;
      await expect(port.isAlbumPhoto({ ...access, includePhotos: false }, world.recipientId, approvedId)).resolves.toBe(false);
      expect(world.queryLog.length).toBe(before);
    });

    it('is false and runs no query when the Trip is unavailable', async () => {
      const before = world.queryLog.length;
      await expect(port.isAlbumPhoto({ ...access, tripAvailable: false }, world.recipientId, approvedId)).resolves.toBe(false);
      expect(world.queryLog.length).toBe(before);
    });
  });

  describe('albumPage', () => {
    it('rejects a malformed cursor with validation_failed', async () => {
      for (const cursor of ['!!!', Buffer.from('{"s":"x","i":"y"}').toString('base64url'), 'bm90LWpzb24']) {
        await expect(port.albumPage(access, world.recipientId, { cursor, limit: 10 })).rejects.toMatchObject({
          code: 'validation_failed',
        });
      }
    });

    it('runs no query and mints nothing when includePhotos is false or the Trip is unavailable', async () => {
      const before = world.queryLog.length;
      await expect(
        port.albumPage({ ...access, includePhotos: false }, world.recipientId, { limit: 10 }),
      ).resolves.toEqual({ photos: [], nextCursor: null });
      await expect(
        port.albumPage({ ...access, tripAvailable: false }, world.recipientId, { limit: 10 }),
      ).resolves.toEqual({ photos: [], nextCursor: null });
      expect(world.queryLog.length).toBe(before);
      expect(store.presignedGets).toEqual([]);
    });

    it('returns only approved photos of the Trip newest first, with serving-key URLs and the six literal keys', async () => {
      const page = await port.albumPage(access, world.recipientId, { limit: 10 });
      // approved: Alice's, the blocked-candidate Bob photo and the sender photo (no blocks yet)
      expect(page.photos.map((p) => p.id)).toEqual([blockedRecipientPhotoId, blockedByRecipientPhotoId, approvedId]);
      expect(page.nextCursor).toBeNull();
      for (const photo of page.photos) {
        expect(Object.keys(photo).sort()).toEqual(['height', 'id', 'sortAt', 'thumbUrl', 'url', 'width']);
      }
      const keys = photoKeys(approvedId);
      const alicePhoto = page.photos.find((p) => p.id === approvedId)!;
      expect(alicePhoto.url).toContain(keys.full);
      expect(alicePhoto.thumbUrl).toContain(keys.thumb);
      expect(store.missingGetKeys()).toEqual([]);
      expect(store.mintedGetKeys().every((k) => k.startsWith('p/'))).toBe(true);
    });

    it('excludes uploaders blocked in either direction', async () => {
      world.db.public.none(`
        INSERT INTO user_blocks (blocker_id, blocked_id)
        VALUES ('${world.recipientId}', '${world.bobId}'),
               ('${world.senderId}', '${world.recipientId}');
      `);
      const page = await port.albumPage(access, world.recipientId, { limit: 10 });
      expect(page.photos.map((p) => p.id)).toEqual([approvedId]);
    });

    it('pages with limit+1 lookahead: nextCursor only when more rows exist, and the next page continues after it', async () => {
      const first = await port.albumPage(access, world.recipientId, { limit: 2 });
      expect(first.photos.map((p) => p.id)).toEqual([blockedRecipientPhotoId, blockedByRecipientPhotoId]);
      expect(first.nextCursor).not.toBeNull();
      const second = await port.albumPage(access, world.recipientId, {
        limit: 2,
        ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
      });
      expect(second.photos.map((p) => p.id)).toEqual([approvedId]);
      expect(second.nextCursor).toBeNull();
    });
  });
});
