import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import { createPhotosRepo } from '../repo.js';
import { createRecapAlbumWorld } from './recapAlbumHarness.js';
import { seedMyPhotos, type SeedMyPhotoRow } from './myPhotosSeed.js';

describe('PhotosRepo.listAllMine (real SQL via pg-mem, Requirement 29.4-29.8, 29.10)', () => {
  let world: ReturnType<typeof createRecapAlbumWorld>;

  beforeEach(() => {
    world = createRecapAlbumWorld();
  });

  it('returns empty array when user has no photos', async () => {
    const repo = createPhotosRepo(world.pool);
    const rows = await repo.listAllMine(world.strangerId, undefined, 40);
    expect(rows).toEqual([]);
  });

  it('isolates photos by owner_id, excludes deleted rows, and includes all non-deleted statuses and both target kinds', async () => {
    const repo = createPhotosRepo(world.pool);
    const aliceId = world.aliceId;
    const bobId = world.bobId;
    const senderId = world.senderId;

    const targetLogId = randomUUID();
    const targetTripId = world.tripId;

    // Seed photos across all seven statuses and both target kinds for Alice
    const statuses = [
      'uploading',
      'pending',
      'approved',
      'rejected',
      'needs_review',
      'hidden',
      'deleted',
    ] as const;

    const alicePhotos: SeedMyPhotoRow[] = statuses.map((status, index) => ({
      id: randomUUID(),
      ownerId: aliceId,
      targetKind: index % 2 === 0 ? 'food_log' : 'trip',
      targetId: index % 2 === 0 ? targetLogId : targetTripId,
      scopeId: index % 2 === 0 ? randomUUID() : targetTripId,
      status,
      createdAt: new Date(Date.UTC(2026, 4, 1, 10, index, 0)).toISOString(),
    }));

    // Seed other photos for Bob, Sender, and null owner
    const otherPhotos: SeedMyPhotoRow[] = [
      {
        id: randomUUID(),
        ownerId: bobId,
        targetKind: 'trip',
        targetId: targetTripId,
        scopeId: targetTripId,
        status: 'approved',
        createdAt: new Date(Date.UTC(2026, 4, 1, 12, 0, 0)).toISOString(),
      },
      {
        id: randomUUID(),
        ownerId: senderId,
        targetKind: 'food_log',
        targetId: targetLogId,
        scopeId: randomUUID(),
        status: 'approved',
        createdAt: new Date(Date.UTC(2026, 4, 1, 13, 0, 0)).toISOString(),
      },
      {
        id: randomUUID(),
        ownerId: null,
        targetKind: 'trip',
        targetId: targetTripId,
        scopeId: targetTripId,
        status: 'approved',
        createdAt: new Date(Date.UTC(2026, 4, 1, 14, 0, 0)).toISOString(),
      },
    ];

    seedMyPhotos(world.db, [...alicePhotos, ...otherPhotos]);

    const result = await repo.listAllMine(aliceId, undefined, 40);

    // Should return 6 photos for Alice (all except 'deleted')
    expect(result).toHaveLength(6);

    // Every returned row must belong to Alice
    for (const row of result) {
      expect(row.owner_id).toBe(aliceId);
      expect(row.status).not.toBe('deleted');
    }

    // Verify all 6 non-deleted statuses are present
    const returnedStatuses = new Set(result.map((r) => r.status));
    expect(returnedStatuses).toEqual(
      new Set(['uploading', 'pending', 'approved', 'rejected', 'needs_review', 'hidden'])
    );

    // Verify both target kinds are present
    const returnedKinds = new Set(result.map((r) => r.target_kind));
    expect(returnedKinds).toEqual(new Set(['food_log', 'trip']));

    // Verify ordering: created_at desc, id desc
    for (let i = 0; i < result.length - 1; i++) {
      const a = result[i]!;
      const b = result[i + 1]!;
      const timeA = a.created_at.getTime();
      const timeB = b.created_at.getTime();
      if (timeA === timeB) {
        expect(a.id > b.id).toBe(true);
      } else {
        expect(timeA > timeB).toBe(true);
      }
    }
  });

  it('paginates correctly across created_at ties without duplicates or gaps', async () => {
    const repo = createPhotosRepo(world.pool);
    const aliceId = world.aliceId;
    const tiedTimestamp = new Date(Date.UTC(2026, 5, 10, 15, 30, 0, 0)).toISOString();
    const earlierTimestamp = new Date(Date.UTC(2026, 5, 10, 15, 20, 0, 0)).toISOString();
    const laterTimestamp = new Date(Date.UTC(2026, 5, 10, 15, 40, 0, 0)).toISOString();

    // 1 later photo, 14 photos sharing the identical tiedTimestamp (batch upload tie), and 2 earlier photos = 17 total photos
    const laterPhoto: SeedMyPhotoRow = {
      id: randomUUID(),
      ownerId: aliceId,
      targetKind: 'trip',
      targetId: world.tripId,
      scopeId: world.tripId,
      status: 'approved',
      createdAt: laterTimestamp,
    };

    const tiedPhotos: SeedMyPhotoRow[] = Array.from({ length: 14 }, () => ({
      id: randomUUID(),
      ownerId: aliceId,
      targetKind: 'food_log',
      targetId: randomUUID(),
      scopeId: randomUUID(),
      status: 'approved',
      createdAt: tiedTimestamp,
    }));

    const earlierPhotos: SeedMyPhotoRow[] = Array.from({ length: 2 }, () => ({
      id: randomUUID(),
      ownerId: aliceId,
      targetKind: 'trip',
      targetId: world.tripId,
      scopeId: world.tripId,
      status: 'approved',
      createdAt: earlierTimestamp,
    }));

    const allSeeded = [laterPhoto, ...tiedPhotos, ...earlierPhotos];
    seedMyPhotos(world.db, allSeeded);

    // Page 1 with limit 10: will take laterPhoto + 9 of the tied photos
    const page1 = await repo.listAllMine(aliceId, undefined, 10);
    expect(page1).toHaveLength(10);
    expect(page1[0]!.id).toBe(laterPhoto.id);

    // Page 2 using cursor from last row of page 1
    const lastPage1 = page1[page1.length - 1]!;
    const page2 = await repo.listAllMine(
      aliceId,
      { createdAt: lastPage1.created_at, id: lastPage1.id },
      10
    );
    // Remaining: 5 tied photos + 2 earlier photos = 7 photos
    expect(page2).toHaveLength(7);

    // Assert no row is skipped or duplicated across page 1 and page 2
    const allReturnedIds = [...page1.map((r) => r.id), ...page2.map((r) => r.id)];
    expect(allReturnedIds).toHaveLength(17);
    expect(new Set(allReturnedIds).size).toBe(17);

    const seededIds = new Set(allSeeded.map((r) => r.id));
    expect(new Set(allReturnedIds)).toEqual(seededIds);

    // Page 3 using cursor from last row of page 2 should be empty
    const lastPage2 = page2[page2.length - 1]!;
    const page3 = await repo.listAllMine(
      aliceId,
      { createdAt: lastPage2.created_at, id: lastPage2.id },
      10
    );
    expect(page3).toEqual([]);
  });
});
