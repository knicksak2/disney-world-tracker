/**
 * Task 12.2, photos (account-deletion R5.5, Property 19): while an account is pending its photos are not served on
 * any read path (dish and restaurant galleries, Trip Album, recap, feed post slots), NO photo row changes status, the
 * Blocked-users list omits the person, and everything is served again after Restoration.
 */
import { randomUUID } from 'node:crypto';

import { DataType } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { DefaultFeedPhotoPort } from '../../photos/feedPhotoPort.js';
import { DefaultRecapPhotoPort } from '../../photos/recapPhotoPort.js';
import { createPhotosRepo } from '../../photos/repo.js';
import { createReportsRepo } from '../../photos/reportsRepo.js';
import { FakeObjectStore } from '../../photos/__tests__/fakes.js';
import {
  insertFeedPost,
  insertPhotos,
  storeWithServingObjects,
  withPgMemCompat,
} from '../../photos/__tests__/recapAlbumHarness.js';
import {
  befriend,
  BOB,
  CAROL,
  createWorld,
  makePending,
  makePurging,
  restore,
  SUBJECT,
  type World,
} from './visibility.harness.js';

let w: World;
let pool: DbPool;

beforeEach(async () => {
  w = await createWorld();
  try {
    w.db.public.registerFunction({
      name: 'nullif',
      args: [DataType.text, DataType.text],
      returns: DataType.text,
      implementation: (a: unknown, b: unknown): string | null => (a === b ? null : (a as string)),
    });
  } catch {
    /* already registered on the shared base database */
  }
  pool = withPgMemCompat(w.pool);
  await makePending(w, SUBJECT.id);
});

const statuses = async (): Promise<string> =>
  JSON.stringify((await w.pool.query(`SELECT id, status FROM photos ORDER BY id`)).rows);

async function seedFoodPhotos(): Promise<{ scopeId: string; subjectPhoto: string; carolPhoto: string }> {
  const experience = await w.seeder.insertRow('experiences');
  const item = await w.seeder.insertRow('food_items', { experience_id: experience.id });
  const photo = async (owner: string): Promise<string> =>
    String(
      (
        await w.seeder.insertRow('photos', {
          owner_id: owner,
          target_kind: 'food_log',
          target_id: randomUUID(),
          scope_id: item.id,
          status: 'approved',
          harm_verdict: 'pass',
          vision_verdict: 'pass',
          full_etag: 'f',
          thumb_etag: 't',
        })
      ).id,
    );
  return { scopeId: String(item.id), subjectPhoto: await photo(SUBJECT.id), carolPhoto: await photo(CAROL.id) };
}

async function seedTripWithPhotos(): Promise<{ tripId: string; subjectPhoto: string; carolPhoto: string }> {
  const trip = await w.seeder.insertRow('trips', { creator_id: BOB.id });
  const tripId = String(trip.id);
  for (const [u, role] of [[BOB.id, 'organizer'], [CAROL.id, 'member'], [SUBJECT.id, 'member']] as const) {
    await w.seeder.insertRow('trip_memberships', { trip_id: tripId, user_id: u, role });
  }
  const subjectPhoto = randomUUID();
  const carolPhoto = randomUUID();
  insertPhotos(w.db, [
    { id: subjectPhoto, ownerId: SUBJECT.id, tripId, status: 'approved', sortAt: '2026-03-01T10:00:00.000Z' },
    { id: carolPhoto, ownerId: CAROL.id, tripId, status: 'approved', sortAt: '2026-03-01T11:00:00.000Z' },
  ]);
  return { tripId, subjectPhoto, carolPhoto };
}

describe('food galleries', () => {
  it('a pending owner\'s photos are absent from the dish gallery and the experience gallery, no status changes, and they are served again after restore (Property 19)', async () => {
    const { scopeId, subjectPhoto, carolPhoto } = await seedFoodPhotos();
    const experienceId = String(
      ((await w.pool.query(`SELECT experience_id FROM food_items WHERE id = $1`, [scopeId])).rows[0] as { experience_id: string })
        .experience_id,
    );
    const repo = createPhotosRepo(pool);
    const before = await statuses();

    const dish = await repo.listFoodByScope({ scopeId, viewerId: BOB.id, limit: 10 });
    const restaurant = await repo.listFoodByExperience({ experienceId, viewerId: BOB.id, limit: 10 });
    expect(dish.map((p) => p.id)).toEqual([carolPhoto]);
    expect(restaurant.map((p) => p.id)).toEqual([carolPhoto]);
    expect(JSON.stringify([dish, restaurant])).not.toContain(SUBJECT.displayName);
    expect(await statuses()).toBe(before);

    await makePurging(w); // purging is just as invisible
    expect((await repo.listFoodByScope({ scopeId, viewerId: BOB.id, limit: 10 })).map((p) => p.id)).toEqual([carolPhoto]);

    await w.pool.query(`UPDATE users SET deletion_state = 'pending_deletion' WHERE id = $1`, [SUBJECT.id]);
    await restore(w);
    const after = await repo.listFoodByScope({ scopeId, viewerId: BOB.id, limit: 10 });
    expect(after.map((p) => p.id).sort()).toEqual([subjectPhoto, carolPhoto].sort());
    expect(after.find((p) => p.id === subjectPhoto)!.display_name).toBe(SUBJECT.displayName);
    expect(await statuses()).toBe(before);
  });
});

describe('trip album, recap, feed post slots', () => {
  it('Trip Album and approved highlights omit a pending owner\'s photos and serve them again after restore', async () => {
    const { tripId, subjectPhoto, carolPhoto } = await seedTripWithPhotos();
    const repo = createPhotosRepo(pool);
    const before = await statuses();

    const album = await repo.listTripPhotos({ tripId, viewerId: BOB.id, limit: 10 });
    expect(album.map((p) => p.id)).toEqual([carolPhoto]);
    expect((await repo.listTripApprovedHighlights(tripId, BOB.id)).map((p) => p.id)).toEqual([carolPhoto]);
    expect(await statuses()).toBe(before);

    await restore(w);
    expect((await repo.listTripPhotos({ tripId, viewerId: BOB.id, limit: 10 })).map((p) => p.id).sort()).toEqual(
      [subjectPhoto, carolPhoto].sort(),
    );
    expect((await repo.listTripApprovedHighlights(tripId, BOB.id)).map((p) => p.id).sort()).toEqual(
      [subjectPhoto, carolPhoto].sort(),
    );
  });

  it('the shared recap (highlights, album page, album membership) omits a pending owner\'s photos', async () => {
    const { tripId, subjectPhoto, carolPhoto } = await seedTripWithPhotos();
    const store = storeWithServingObjects([subjectPhoto, carolPhoto]);
    const port = new DefaultRecapPhotoPort({ pool, store });
    const access = { tripId, sharerId: BOB.id, includePhotos: true, tripAvailable: true, tripName: 'T', sharerDisplayName: 'B' };

    expect((await port.highlights(access as never, CAROL.id)).map((p) => p.id)).toEqual([carolPhoto]);
    expect((await port.albumPage(access as never, CAROL.id, { limit: 10 })).photos.map((p) => p.id)).toEqual([carolPhoto]);
    expect(await port.isAlbumPhoto(access as never, CAROL.id, subjectPhoto)).toBe(false);
    expect(await port.isAlbumPhoto(access as never, CAROL.id, carolPhoto)).toBe(true);

    await restore(w);
    expect((await port.albumPage(access as never, CAROL.id, { limit: 10 })).photos).toHaveLength(2);
    expect(await port.isAlbumPhoto(access as never, CAROL.id, subjectPhoto)).toBe(true);
  });

  it('feed post slots: a pending owner\'s photo is a removed slot (no url), the other photo is ready; ready again after restore', async () => {
    const { tripId, subjectPhoto, carolPhoto } = await seedTripWithPhotos();
    const postId = randomUUID();
    insertFeedPost(w.db, { id: postId, tripId, actorId: CAROL.id, caption: 'day one' });
    await w.pool.query(`UPDATE trip_feed_items SET metadata = $2::jsonb WHERE id = $1`, [
      postId,
      JSON.stringify({ caption: 'day one', photoIds: [subjectPhoto, carolPhoto] }),
    ]);
    const store = storeWithServingObjects([subjectPhoto, carolPhoto]) as FakeObjectStore;
    const port = new DefaultFeedPhotoPort({ pool, store });

    const slotsOf = async (): Promise<{ photoId: string; state: string; url: string | null }[]> =>
      (await port.slotsForFeedItems(tripId, BOB.id, [postId])).get(postId)!.slots as never;

    const during = await slotsOf();
    expect(during.find((s) => s.photoId === subjectPhoto)).toMatchObject({ state: 'removed', url: null });
    expect(during.find((s) => s.photoId === carolPhoto)!.state).toBe('ready');

    await restore(w);
    const after = await slotsOf();
    expect(after.find((s) => s.photoId === subjectPhoto)!.state).toBe('ready');
  });
});

describe('Blocked-users list, friend filter, profile lookup', () => {
  it('the Blocked-users list omits a pending person; getProfile and the friend filter see nobody; all return after restore', async () => {
    await w.seeder.insertRow('user_blocks', { blocker_id: BOB.id, blocked_id: SUBJECT.id });
    await w.seeder.insertRow('user_blocks', { blocker_id: BOB.id, blocked_id: CAROL.id });
    await befriend(w, BOB.id, SUBJECT.id);
    const reports = createReportsRepo(pool);
    const photos = createPhotosRepo(pool);

    expect((await reports.listBlocks(BOB.id)).map((b) => b.blocked_id)).toEqual([CAROL.id]);
    expect(await reports.getProfile(SUBJECT.id)).toBeNull();
    expect([...(await photos.friendIdsAmong(BOB.id, [SUBJECT.id, CAROL.id]))]).toEqual([]);

    await restore(w);
    expect((await reports.listBlocks(BOB.id)).map((b) => b.blocked_id).sort()).toEqual([CAROL.id, SUBJECT.id].sort());
    expect(await reports.getProfile(SUBJECT.id)).toEqual({ displayName: SUBJECT.displayName, avatarPreset: SUBJECT.avatarPreset });
    expect([...(await photos.friendIdsAmong(BOB.id, [SUBJECT.id]))]).toEqual([SUBJECT.id]);
  });
});
