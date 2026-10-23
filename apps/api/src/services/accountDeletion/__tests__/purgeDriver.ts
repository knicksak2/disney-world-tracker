/**
 * Test-side driver for the five purge stages, written straight from design.md "Purge procedure" so the repo
 * tests can run stages to completion before the real runner (task 8.2) exists. It owns no rules the runner will
 * not also own (stage order, loop-until-empty, enqueue before the registry loop); it only calls repo methods.
 *
 * It is deliberately NOT bounded by a time budget: budget behaviour is the runner's, and is tested there.
 */
import { createPhotosRepo } from '../../photos/repo.js';
import { DISPOSITIONS } from '../dispositions.js';
import type { ClaimedAccount, PhotoDeletionPort, TripPurgePhotoPort } from '../ports.js';
import type { World } from './world.js';

export interface Drivers {
  readonly photos: PhotoDeletionPort;
  readonly tripPhotos: TripPurgePhotoPort;
}

/** The ports as composeServices.ts will build them when photos are disabled: straight over the photos repo. */
export function photoDrivers(w: World): Drivers {
  const repo = createPhotosRepo(w.pool);
  return {
    photos: { deleteAllForUser: (id, o) => repo.softDeleteByOwner(id, new Date(), undefined, o?.limit) },
    tripPhotos: { softDeleteTripPhotos: (tripId, now, client) => repo.softDeleteByTarget('trip', tripId, now, client) },
  };
}

const MAX_LOOPS = 10_000;

async function untilZero(step: () => Promise<number>): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_LOOPS; i++) {
    const n = await step();
    if (n === 0) return total;
    total += n;
  }
  throw new Error('purgeDriver: a chunk loop did not terminate');
}

export async function stage1Photos(w: World, c: ClaimedAccount, d: Drivers, chunkRows: number): Promise<void> {
  for (let i = 0; i < MAX_LOOPS; i++) {
    const ids = await d.photos.deleteAllForUser(c.id, { limit: chunkRows });
    if (ids.length > 0) await w.repo.addCounters(c, { photosDeleted: ids.length });
    if (ids.length < chunkRows) break;
  }
  await w.repo.advanceStage(c, 1);
}

export async function stage2Trips(w: World, c: ClaimedAccount, d: Drivers): Promise<void> {
  for (const tripId of await w.repo.listTripsOf(c.id)) {
    const r = await w.repo.resolveTrip(c, tripId, { photoPort: d.tripPhotos, now: new Date() });
    if (r === 'fenced') throw new Error('purgeDriver: fenced during trips');
  }
  await w.repo.advanceStage(c, 2);
}

export async function stage3Anonymize(w: World, c: ClaimedAccount): Promise<string | null> {
  const remaining = await w.repo.countRemainingReferences(c.id);
  const needsTombstone = remaining.some((r) =>
    DISPOSITIONS.some(
      (e) => e.table === r.table && e.column === r.column && (e.disposition === 'anonymize' || e.disposition === 'anonymize_then_delete'),
    ),
  );
  const tombstoneId = needsTombstone ? await w.repo.ensureTombstone(c) : null;
  if (tombstoneId !== null) {
    for (const entry of DISPOSITIONS) {
      if (entry.disposition !== 'anonymize' && entry.disposition !== 'anonymize_then_delete') continue;
      await untilZero(() => w.repo.anonymizeChunk(c, entry, tombstoneId));
    }
    let cursor: string | null = null;
    for (let i = 0; i < MAX_LOOPS; i++) {
      const page: { lastId: string | null } = await w.repo.scrubShares(c, tombstoneId, cursor);
      if (page.lastId === null) break;
      cursor = page.lastId;
    }
  }
  await w.repo.advanceStage(c, 3);
  return tombstoneId;
}

export async function stage4PersonalData(w: World, c: ClaimedAccount, hooks: { beforeRegistry?: () => Promise<void> } = {}): Promise<void> {
  let cursor: string | null = null;
  for (let i = 0; i < MAX_LOOPS; i++) {
    const page: { lastId: string | null } = await w.repo.enqueueRatedChunk(c.id, cursor);
    if (page.lastId === null) break;
    cursor = page.lastId;
  }
  await hooks.beforeRegistry?.();
  for (const entry of DISPOSITIONS) {
    if (entry.disposition === 'anonymize' || entry.disposition === 'trip') continue;
    await untilZero(() => w.repo.applyDeleteOrNullChunk(c, entry));
  }
  await w.repo.advanceStage(c, 4);
}

/** Stages 1 to 4 and finalize; returns finalize's verdict. */
export async function drivePurge(
  w: World,
  c: ClaimedAccount,
  d: Drivers,
  chunkRows: number,
  opts: { fromStage?: number } = {},
): Promise<'purged' | 'fenced' | 'refs_remain'> {
  const from = opts.fromStage ?? 0;
  if (from < 1) await stage1Photos(w, c, d, chunkRows);
  if (from < 2) await stage2Trips(w, c, d);
  if (from < 3) await stage3Anonymize(w, c);
  if (from < 4) await stage4PersonalData(w, c);
  return w.repo.finalize(c, new Date('2026-05-02T09:05:00.000Z'));
}
