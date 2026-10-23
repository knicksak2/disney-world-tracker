/**
 * Repo tests (pg-mem, real SQL) for trip resolution at purge: `listTripsOf` and `resolveTrip`.
 *
 * Feature: account-deletion, Property 9: Trip resolution never strands or leaks a trip
 * Feature: account-deletion, Property 30: A trip is deleted only from the roster read under its own lock, and its photos go with it atomically
 *
 * Validates: Requirements 7.7, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.10, 10.11, 17.2, 17.4, 17.10
 */
import { randomUUID } from 'node:crypto';

import fc from 'fast-check';
import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it } from 'vitest';

import { createPhotosRepo } from '../../photos/repo.js';
import type { ClaimedAccount, TripPurgePhotoPort } from '../ports.js';
import type { Row } from './helpers.js';
import { BOB, CAROL, claimSubject, createWorld, DAVE, SUBJECT, userRow, type World } from './world.js';

const NOW = new Date('2026-05-02T09:00:00.000Z');
const D = (day: number): Date => new Date(Date.UTC(2026, 2, day, 12));

type UserState = 'active' | 'pending_deletion' | 'purging';

describe('accountDeletion repo: trip resolution (pg-mem)', () => {
  let w: World;
  let c: ClaimedAccount;

  /** A photo port that goes through the real photos repo and records every client it was handed. */
  function recordingPort(): { port: TripPurgePhotoPort; clients: unknown[] } {
    const photos = createPhotosRepo(w.pool);
    const clients: unknown[] = [];
    return {
      clients,
      port: {
        async softDeleteTripPhotos(tripId, now, client) {
          clients.push(client);
          return photos.softDeleteByTarget('trip', tripId, now, client);
        },
      },
    };
  }

  async function newTrip(creatorId: string, members: readonly { id: string; role: 'organizer' | 'member'; joinedAt: Date }[]): Promise<string> {
    const trip = await w.seeder.insertRow('trips', { creator_id: creatorId });
    const tripId = String(trip.id);
    for (const m of members) {
      await w.seeder.insertRow('trip_memberships', { trip_id: tripId, user_id: m.id, role: m.role, joined_at: m.joinedAt });
    }
    return tripId;
  }

  async function addPhoto(tripId: string, ownerId: string, status = 'approved'): Promise<string> {
    const p = await w.seeder.insertRow('photos', {
      owner_id: ownerId,
      target_kind: 'trip',
      target_id: tripId,
      scope_id: tripId,
      status,
      harm_verdict: 'pass',
      full_etag: 'f',
      thumb_etag: 't',
    });
    return String(p.id);
  }

  async function setState(userId: string, state: UserState): Promise<void> {
    if (state === 'active') return;
    await w.pool.query(
      `UPDATE users SET deletion_state = $2, deletion_requested_at = $3, scheduled_purge_at = $4, placeholder_id = $5,
              purge_claimed_at = CASE WHEN $2 = 'purging' THEN $6 ELSE NULL END WHERE id = $1`,
      [userId, state, new Date('2026-04-01T00:00:00Z'), new Date('2026-05-01T00:00:00Z'), `deadc0de-${userId.slice(9)}`, NOW],
    );
  }

  const trip = async (id: string): Promise<Row | undefined> =>
    (await w.pool.query(`SELECT * FROM trips WHERE id = $1`, [id])).rows[0] as Row | undefined;
  const memberships = async (tripId: string): Promise<Row[]> =>
    (await w.pool.query(`SELECT * FROM trip_memberships WHERE trip_id = $1 ORDER BY joined_at`, [tripId])).rows as Row[];
  const photoStatus = async (id: string): Promise<string> =>
    String(((await w.pool.query(`SELECT status FROM photos WHERE id = $1`, [id])).rows[0] as Row).status);

  const resolve = (tripId: string, extra: Partial<Parameters<World['repo']['resolveTrip']>[2]> = {}) =>
    w.repo.resolveTrip(c, tripId, { photoPort: recordingPort().port, now: NOW, ...extra });

  beforeEach(async () => {
    w = await createWorld();
    c = await claimSubject(w);
  });

  describe('listTripsOf', () => {
    it('is the union of memberships and created trips, once each, and nothing else', async () => {
      const member = await newTrip(BOB.id, [{ id: SUBJECT.id, role: 'member', joinedAt: D(1) }, { id: BOB.id, role: 'organizer', joinedAt: D(1) }]);
      const created = await newTrip(SUBJECT.id, [{ id: SUBJECT.id, role: 'organizer', joinedAt: D(1) }]); // member AND creator: once
      const creatorOnly = await newTrip(SUBJECT.id, [{ id: BOB.id, role: 'organizer', joinedAt: D(1) }]); // creator who already left
      await newTrip(BOB.id, [{ id: BOB.id, role: 'organizer', joinedAt: D(1) }]); // unrelated

      const listed = await w.repo.listTripsOf(SUBJECT.id);
      expect([...listed].sort()).toEqual([member, created, creatorOnly].sort());
      expect(await w.repo.listTripsOf(DAVE.id)).toEqual([]);
    });
  });

  describe('keep_trip', () => {
    it('transfers to the organizer over a member who joined earlier, sets the creator, removes the membership and counts one transfer', async () => {
      const tripId = await newTrip(SUBJECT.id, [
        { id: SUBJECT.id, role: 'organizer', joinedAt: D(1) },
        { id: DAVE.id, role: 'member', joinedAt: D(2) },
        { id: BOB.id, role: 'member', joinedAt: D(3) },
        { id: CAROL.id, role: 'organizer', joinedAt: D(9) },
      ]);

      expect(await resolve(tripId)).toBe('transferred');

      expect((await trip(tripId))!.creator_id).toBe(CAROL.id);
      const rows = await memberships(tripId);
      expect(rows.map((r) => r.user_id)).not.toContain(SUBJECT.id);
      expect(rows.find((r) => r.user_id === CAROL.id)!.role).toBe('organizer');
      expect(rows.find((r) => r.user_id === DAVE.id)!.role).toBe('member'); // nobody else was promoted
      expect(rows).toHaveLength(3);
      const counters = (await userRow(w, SUBJECT.id))!;
      expect(counters.purge_trips_transferred).toBe(1);
      expect(counters.purge_trips_deleted).toBe(0);
    });

    it('ties go to the earliest joined, then the lowest user id', async () => {
      const tripId = await newTrip(SUBJECT.id, [
        { id: SUBJECT.id, role: 'organizer', joinedAt: D(1) },
        { id: CAROL.id, role: 'organizer', joinedAt: D(5) },
        { id: BOB.id, role: 'organizer', joinedAt: D(5) },
        { id: DAVE.id, role: 'organizer', joinedAt: D(6) },
      ]);
      await resolve(tripId);
      // BOB (bbbb...) < CAROL (cccc...) at the same joined_at.
      expect((await trip(tripId))!.creator_id).toBe(BOB.id);
    });

    it('promotes a member to organizer when the purged creator held the trip, and only that member', async () => {
      const tripId = await newTrip(SUBJECT.id, [
        { id: SUBJECT.id, role: 'organizer', joinedAt: D(1) },
        { id: BOB.id, role: 'member', joinedAt: D(4) },
        { id: CAROL.id, role: 'member', joinedAt: D(3) },
      ]);
      expect(await resolve(tripId)).toBe('transferred');

      expect((await trip(tripId))!.creator_id).toBe(CAROL.id);
      const roles = Object.fromEntries((await memberships(tripId)).map((r) => [String(r.user_id), r.role]));
      expect(roles).toEqual({ [CAROL.id]: 'organizer', [BOB.id]: 'member' });
    });

    it('last-organizer rule: a non-creator sole organizer leaving promotes the earliest member, creator unchanged', async () => {
      const tripId = await newTrip(BOB.id, [
        { id: BOB.id, role: 'member', joinedAt: D(2) },
        { id: SUBJECT.id, role: 'organizer', joinedAt: D(1) },
        { id: CAROL.id, role: 'member', joinedAt: D(1) },
      ]);
      expect(await resolve(tripId)).toBe('transferred');

      expect((await trip(tripId))!.creator_id).toBe(BOB.id);
      const roles = Object.fromEntries((await memberships(tripId)).map((r) => [String(r.user_id), r.role]));
      expect(roles).toEqual({ [CAROL.id]: 'organizer', [BOB.id]: 'member' }); // CAROL joined first
    });

    it('a member who is not the creator and leaves behind an organizer changes nothing but the membership ("unchanged")', async () => {
      const tripId = await newTrip(BOB.id, [
        { id: BOB.id, role: 'organizer', joinedAt: D(1) },
        { id: SUBJECT.id, role: 'member', joinedAt: D(2) },
      ]);
      expect(await resolve(tripId)).toBe('unchanged');

      expect((await memberships(tripId)).map((r) => r.user_id)).toEqual([BOB.id]);
      expect((await trip(tripId))!.creator_id).toBe(BOB.id);
      const counters = (await userRow(w, SUBJECT.id))!;
      expect(counters.purge_trips_transferred).toBe(0);
      expect(counters.purge_trips_deleted).toBe(0);
    });

    it('a creator who already left: creator_id is re-pointed at a remaining candidate', async () => {
      const tripId = await newTrip(SUBJECT.id, [
        { id: BOB.id, role: 'organizer', joinedAt: D(1) },
        { id: CAROL.id, role: 'member', joinedAt: D(2) },
      ]);
      expect(await w.repo.listTripsOf(SUBJECT.id)).toEqual([tripId]);

      expect(await resolve(tripId)).toBe('transferred');
      expect((await trip(tripId))!.creator_id).toBe(BOB.id);
      expect(await w.repo.listTripsOf(SUBJECT.id)).toEqual([]);
    });

    it('a pending-deletion member is chosen only when no member is active', async () => {
      const tripId = await newTrip(SUBJECT.id, [
        { id: SUBJECT.id, role: 'organizer', joinedAt: D(1) },
        { id: BOB.id, role: 'organizer', joinedAt: D(2) },
        { id: CAROL.id, role: 'member', joinedAt: D(3) },
      ]);
      await setState(BOB.id, 'pending_deletion');
      await resolve(tripId);
      expect((await trip(tripId))!.creator_id).toBe(CAROL.id); // the active member beats the pending organizer
      expect((await memberships(tripId)).find((r) => r.user_id === CAROL.id)!.role).toBe('organizer');
    });

    it('cancels pending rode-with tags the purged user created or is named in, and leaves every other tag and invite alone', async () => {
      const tripId = await newTrip(BOB.id, [
        { id: BOB.id, role: 'organizer', joinedAt: D(1) },
        { id: SUBJECT.id, role: 'member', joinedAt: D(2) },
        { id: CAROL.id, role: 'member', joinedAt: D(3) },
      ]);
      const entry = async (memberId: string): Promise<string> =>
        String((await w.seeder.insertRow('trip_log_entries', { trip_id: tripId, member_id: memberId })).id);
      const tag = async (logEntryId: string, taggedId: string, state = 'pending'): Promise<string> =>
        String((await w.seeder.insertRow('rode_with_tags', { log_entry_id: logEntryId, tagged_member_id: taggedId, state })).id);

      const bobsEntry = await entry(BOB.id);
      const subjectsEntry = await entry(SUBJECT.id);
      const namedIn = await tag(bobsEntry, SUBJECT.id); // pending, names the purged user
      const created = await tag(subjectsEntry, CAROL.id); // pending, on an entry the purged user authored
      const confirmed = await tag(subjectsEntry, BOB.id, 'confirmed'); // already confirmed: untouched
      const unrelated = await tag(bobsEntry, CAROL.id); // pending, nothing to do with the purged user

      // Another trip's pending tag naming the purged user is not this trip's to touch.
      const otherTrip = await newTrip(BOB.id, [{ id: BOB.id, role: 'organizer', joinedAt: D(1) }]);
      const otherEntry = String((await w.seeder.insertRow('trip_log_entries', { trip_id: otherTrip, member_id: BOB.id })).id);
      const otherTag = await tag(otherEntry, SUBJECT.id);

      const invFrom = String((await w.seeder.insertRow('trip_invites', { trip_id: tripId, inviter_id: SUBJECT.id, invitee_id: DAVE.id })).id);
      const invTo = String((await w.seeder.insertRow('trip_invites', { trip_id: tripId, inviter_id: BOB.id, invitee_id: SUBJECT.id })).id);
      const invOther = String((await w.seeder.insertRow('trip_invites', { trip_id: tripId, inviter_id: BOB.id, invitee_id: CAROL.id })).id);

      await resolve(tripId);

      const states = Object.fromEntries(
        ((await w.pool.query(`SELECT id, state FROM rode_with_tags`)).rows as Row[]).map((r) => [String(r.id), r.state]),
      );
      expect(states[namedIn]).toBe('cancelled');
      expect(states[created]).toBe('cancelled');
      expect(states[confirmed]).toBe('confirmed');
      expect(states[unrelated]).toBe('pending');
      expect(states[otherTag]).toBe('pending');
      const invites = ((await w.pool.query(`SELECT id FROM trip_invites`)).rows as Row[]).map((r) => String(r.id));
      expect(invites).not.toContain(invFrom);
      expect(invites).not.toContain(invTo);
      expect(invites).toContain(invOther);
    });

    it('is idempotent: a second resolve of a trip the user already left changes nothing', async () => {
      const tripId = await newTrip(BOB.id, [
        { id: BOB.id, role: 'organizer', joinedAt: D(1) },
        { id: SUBJECT.id, role: 'member', joinedAt: D(2) },
      ]);
      await resolve(tripId);
      const before = JSON.stringify([await trip(tripId), await memberships(tripId), await userRow(w, SUBJECT.id)]);
      expect(await resolve(tripId)).toBe('unchanged');
      expect(JSON.stringify([await trip(tripId), await memberships(tripId), await userRow(w, SUBJECT.id)])).toBe(before);
    });

    it('a trip that no longer exists is "unchanged"', async () => {
      expect(await resolve(randomUUID())).toBe('unchanged');
    });
  });

  describe('delete_trip (Property 30)', () => {
    it('sole member: photos become deleted, the trips row is gone, other trips and their photos are untouched, and the photo call ran on the transaction client', async () => {
      const tripId = await newTrip(SUBJECT.id, [{ id: SUBJECT.id, role: 'organizer', joinedAt: D(1) }]);
      const other = await newTrip(BOB.id, [{ id: BOB.id, role: 'organizer', joinedAt: D(1) }]);
      const mine = [await addPhoto(tripId, SUBJECT.id), await addPhoto(tripId, SUBJECT.id, 'pending')];
      const alsoOthersOnMyTrip = await addPhoto(tripId, SUBJECT.id);
      const bystander = await addPhoto(other, BOB.id);
      const { port, clients } = recordingPort();
      w.resetStatements();

      expect(await w.repo.resolveTrip(c, tripId, { photoPort: port, now: NOW })).toBe('deleted');

      expect(await trip(tripId)).toBeUndefined();
      for (const id of [...mine, alsoOthersOnMyTrip]) expect(await photoStatus(id)).toBe('deleted');
      expect(await photoStatus(bystander)).toBe('approved');
      expect(await trip(other)).toBeDefined();
      const counters = (await userRow(w, SUBJECT.id))!;
      expect(counters.purge_trips_deleted).toBe(1);
      expect(counters.purge_trips_transferred).toBe(0);

      // The photo call received the purge transaction's client, not the pool.
      expect(clients).toHaveLength(1);
      expect(clients[0]).not.toBe(w.pool);
      expect(typeof (clients[0] as PoolClient).release).toBe('function');
      // ...and its statement sits between BEGIN and COMMIT, before the trip delete.
      const texts = w.statements.map((s) => s.text.trim().replace(/\s+/g, ' '));
      const begin = texts.indexOf('BEGIN');
      const photoUpdate = texts.findIndex((t) => t.startsWith('UPDATE photos'));
      const tripDelete = texts.findIndex((t) => t.startsWith('DELETE FROM trips'));
      const commit = texts.lastIndexOf('COMMIT');
      expect(begin).toBeGreaterThanOrEqual(0);
      expect(begin).toBeLessThan(photoUpdate);
      expect(photoUpdate).toBeLessThan(tripDelete);
      expect(tripDelete).toBeLessThan(commit);
      // The trip row is locked first, then the roster is read, in that order.
      const lock = texts.findIndex((t) => /^SELECT id, creator_id FROM trips WHERE id = \$1 FOR UPDATE/.test(t));
      const roster = texts.findIndex((t) => /FROM trip_memberships WHERE trip_id = \$1 FOR UPDATE/.test(t));
      expect(begin).toBeLessThan(lock);
      expect(lock).toBeLessThan(roster);
      expect(roster).toBeLessThan(photoUpdate);
    });

    it('deletes the trip with everything under it (cascade) and does not call TripRepo.deleteTrip', async () => {
      const tripId = await newTrip(SUBJECT.id, [{ id: SUBJECT.id, role: 'organizer', joinedAt: D(1) }]);
      await w.seeder.insertRow('trip_log_entries', { trip_id: tripId, member_id: SUBJECT.id });
      await resolve(tripId);
      expect((await w.pool.query(`SELECT 1 FROM trip_log_entries WHERE trip_id = $1`, [tripId])).rows).toHaveLength(0);
      expect(await trip(tripId)).toBeUndefined();
    });

    it('every other member already purging: the trip is deleted rather than left to a purging owner', async () => {
      const tripId = await newTrip(SUBJECT.id, [
        { id: SUBJECT.id, role: 'organizer', joinedAt: D(1) },
        { id: BOB.id, role: 'member', joinedAt: D(2) },
        { id: CAROL.id, role: 'organizer', joinedAt: D(3) },
      ]);
      await setState(BOB.id, 'purging');
      await setState(CAROL.id, 'purging');
      const photo = await addPhoto(tripId, BOB.id);

      expect(await resolve(tripId)).toBe('deleted');
      expect(await trip(tripId)).toBeUndefined();
      expect(await photoStatus(photo)).toBe('deleted');
    });

    it('roster change between lock and plan (seam): a member added after the lock keeps the trip alive, photos stay, the new member remains', async () => {
      const tripId = await newTrip(SUBJECT.id, [{ id: SUBJECT.id, role: 'organizer', joinedAt: D(1) }]);
      const photo = await addPhoto(tripId, SUBJECT.id);
      const { port } = recordingPort();
      let seamRan = 0;

      const result = await w.repo.resolveTrip(c, tripId, {
        photoPort: port,
        now: NOW,
        afterTripLocked: async (client) => {
          seamRan += 1;
          await client.query(`INSERT INTO trip_memberships (trip_id, user_id, role, joined_at) VALUES ($1, $2, 'member', $3)`, [
            tripId,
            CAROL.id,
            D(8),
          ]);
        },
      });

      expect(seamRan).toBe(1);
      expect(result).toBe('transferred');
      expect(await trip(tripId)).toBeDefined();
      expect(await photoStatus(photo)).toBe('approved'); // NOT deleted
      const rows = await memberships(tripId);
      expect(rows.map((r) => r.user_id)).toEqual([CAROL.id]);
      expect(rows[0]!.role).toBe('organizer'); // promoted: the purged creator's trip needs an organizer
      expect((await trip(tripId))!.creator_id).toBe(CAROL.id);
      expect((await userRow(w, SUBJECT.id))!.purge_trips_deleted).toBe(0);
    });

    it('a throwing seam leaves the photos un-deleted and the trip present (the error propagates)', async () => {
      const tripId = await newTrip(SUBJECT.id, [{ id: SUBJECT.id, role: 'organizer', joinedAt: D(1) }]);
      const photo = await addPhoto(tripId, SUBJECT.id);
      await expect(
        resolve(tripId, {
          afterTripLocked: async () => {
            throw new Error('seam failed');
          },
        }),
      ).rejects.toThrow('seam failed');
      expect(await trip(tripId)).toBeDefined();
      expect(await photoStatus(photo)).toBe('approved');
      expect((await memberships(tripId)).map((r) => r.user_id)).toEqual([SUBJECT.id]);
    });

    it('atomic: when the photo step succeeds and the trip delete then fails, the photo rows are rolled back too', async () => {
      const tripId = await newTrip(SUBJECT.id, [{ id: SUBJECT.id, role: 'organizer', joinedAt: D(1) }]);
      const photo = await addPhoto(tripId, SUBJECT.id);
      const photos = createPhotosRepo(w.pool);
      const throwsAfterMarking: TripPurgePhotoPort = {
        async softDeleteTripPhotos(id, now, client) {
          await photos.softDeleteByTarget('trip', id, now, client);
          throw new Error('photo step failed after marking');
        },
      };
      await expect(w.repo.resolveTrip(c, tripId, { photoPort: throwsAfterMarking, now: NOW })).rejects.toThrow('photo step failed');
      expect(await photoStatus(photo)).toBe('approved');
      expect(await trip(tripId)).toBeDefined();
    });

    it('a claim that was lost rolls the whole trip back and reports "fenced" (delete_trip and keep_trip)', async () => {
      const soleTrip = await newTrip(SUBJECT.id, [{ id: SUBJECT.id, role: 'organizer', joinedAt: D(1) }]);
      const photo = await addPhoto(soleTrip, SUBJECT.id);
      const sharedTrip = await newTrip(SUBJECT.id, [
        { id: SUBJECT.id, role: 'organizer', joinedAt: D(1) },
        { id: BOB.id, role: 'member', joinedAt: D(2) },
      ]);
      // A newer run re-claimed the account: our token is stale.
      const [fresh] = await w.repo.claimDue(new Date(NOW.getTime() + 20 * 60_000), 10);
      expect(fresh!.claimedAt.getTime()).not.toBe(c.claimedAt.getTime());

      expect(await resolve(soleTrip)).toBe('fenced');
      expect(await resolve(sharedTrip)).toBe('fenced');

      expect(await trip(soleTrip)).toBeDefined();
      expect(await photoStatus(photo)).toBe('approved');
      expect((await trip(sharedTrip))!.creator_id).toBe(SUBJECT.id);
      expect((await memberships(sharedTrip)).map((r) => r.user_id).sort()).toEqual([BOB.id, SUBJECT.id].sort());
      const counters = (await userRow(w, SUBJECT.id))!;
      expect(counters.purge_trips_deleted).toBe(0);
      expect(counters.purge_trips_transferred).toBe(0);
      // The run that holds the claim can still do the trip.
      expect(await w.repo.resolveTrip(fresh!, soleTrip, { photoPort: recordingPort().port, now: NOW })).toBe('deleted');
    });
  });

  // -------------------------------------------------------------------------------------------
  // Property 9 against the real repo
  // -------------------------------------------------------------------------------------------
  // Feature: account-deletion, Property 9: Trip resolution never strands or leaks a trip
  it('property: over generated trips the real repo never strands a trip and never leaves the purged user behind', async () => {
    const others = [BOB, CAROL, DAVE];
    const spec = fc.record({
      subjectMember: fc.boolean(),
      subjectRole: fc.constantFrom<'organizer' | 'member'>('organizer', 'member'),
      subjectIsCreator: fc.boolean(),
      others: fc.array(
        fc.record({
          present: fc.boolean(),
          role: fc.constantFrom<'organizer' | 'member'>('organizer', 'member'),
          joinedDay: fc.integer({ min: 1, max: 6 }),
          state: fc.constantFrom<UserState>('active', 'active', 'pending_deletion', 'purging'),
        }),
        { minLength: 3, maxLength: 3 },
      ),
      creatorIndex: fc.integer({ min: 0, max: 2 }),
    });

    await fc.assert(
      fc.asyncProperty(spec, async (s) => {
        w = await createWorld();
        c = await claimSubject(w);
        const members: { id: string; role: 'organizer' | 'member'; joinedAt: Date }[] = [];
        if (s.subjectMember) members.push({ id: SUBJECT.id, role: s.subjectRole, joinedAt: D(3) });
        s.others.forEach((o, i) => {
          if (o.present) members.push({ id: others[i]!.id, role: o.role, joinedAt: D(o.joinedDay) });
        });
        const creatorId = s.subjectIsCreator ? SUBJECT.id : others[s.creatorIndex]!.id;
        const tripId = await newTrip(creatorId, members);
        for (let i = 0; i < others.length; i++) await setState(others[i]!.id, s.others[i]!.state);

        const candidates = members.filter((m) => {
          if (m.id === SUBJECT.id) return false;
          const st = s.others[others.findIndex((p) => p.id === m.id)]!.state;
          return st !== 'purging';
        });

        const result = await resolve(tripId);

        const t = await trip(tripId);
        const rows = await memberships(tripId);
        expect(rows.map((r) => r.user_id)).not.toContain(SUBJECT.id);
        if (candidates.length === 0) {
          expect(result).toBe('deleted');
          expect(t).toBeUndefined();
          return;
        }
        expect(t).toBeDefined();
        expect(t!.creator_id).not.toBe(SUBJECT.id);
        // The creator is a remaining candidate if it changed, and holds organizer if the purged user held the trip.
        if (creatorId === SUBJECT.id) {
          const newCreator = rows.find((r) => r.user_id === t!.creator_id);
          expect(newCreator, 'new creator is a remaining member').toBeDefined();
          expect(newCreator!.role).toBe('organizer');
          expect(candidates.map((m) => m.id)).toContain(String(t!.creator_id));
        }
        // At least one non-purging organizer survives (the Last_Organizer_Rule over the persisted rows).
        const stateOf = (id: string): UserState => s.others[others.findIndex((p) => p.id === id)]!.state;
        const survivingOrganizers = rows.filter((r) => r.role === 'organizer' && stateOf(String(r.user_id)) !== 'purging');
        expect(survivingOrganizers.length).toBeGreaterThanOrEqual(1);
        // Nobody but the purged user was removed.
        expect(rows.map((r) => String(r.user_id)).sort()).toEqual(members.filter((m) => m.id !== SUBJECT.id).map((m) => m.id).sort());
      }),
      { numRuns: 100 },
    );
  });
});
