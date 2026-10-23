/**
 * Task 12.2 (trips, bookings, lists): a pending person is hidden from every other member (account-deletion R5,
 * Appendix B). Each test seeds an ACTIVE bystander and the PENDING SUBJECT, asserts the OMIT row is absent or the
 * PLACEHOLDER row shows `public_id` / `Deleted user` / null avatar, and asserts the same call after Restoration
 * returns the real values, with no stored row changed.
 */
import { DELETED_USER_DISPLAY_NAME, isDeletedUserId } from '@dwt/shared';
import { DataType } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { createExperienceListAffinityRepo, createExperienceListRepo, createExperienceListShareRepo } from '../../experienceLists/repo.js';
import { createFoodListAffinityRepo, createFoodListRepo, createFoodListShareRepo } from '../../foodLists/repo.js';
import { createTripBookingRepo } from '../../tripBooking/repo.js';
import { createTripRepo, type TripRepoDeps } from '../../trips/repo.js';
import { tripRoutes } from '../../trips/routes.js';
import { resolveExperienceListForTrip, resolveFoodListForTrip } from '../../trips/listResolvers.js';
import {
  as,
  befriend,
  BOB,
  buildApp,
  CAROL,
  createWorld,
  makePending,
  makePurging,
  restore,
  sessionStub,
  SUBJECT,
  type World,
} from './visibility.harness.js';

let w: World;
const PLACEHOLDER = `deadc0de-${SUBJECT.id.slice(9)}`;

beforeEach(async () => {
  w = await createWorld();
  // The feed query uses NULLIF(text, text), which pg-mem lacks; Postgres evaluates it as written.
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
  await makePending(w, SUBJECT.id);
});

/**
 * pg-mem cannot plan the feed's two correlated per-item subqueries (the rode-with count and its JSON list), the
 * same two the existing `feedEnrichment.test.ts` neutralizes. Only those are rewritten; the actor join, the
 * comments query and the reactions aggregate under test run exactly as the repo sends them.
 */
function feedCompat(inner: DbPool): DbPool {
  const fix = (text: string): string =>
    text
      .replace(/\(SELECT count\(\*\)::int\s+FROM rode_with_tags rwt\s+WHERE rwt\.log_entry_id = le\.id\) AS rode_with_count/i, 'NULL AS rode_with_count')
      .replace(/\(SELECT json_agg[\s\S]*?WHERE rwt\.log_entry_id = le\.id\) AS rode_with/i, 'NULL AS rode_with');
  return { query: (text: string, params?: unknown[]) => inner.query(fix(text), params) } as unknown as DbPool;
}

const deps = {
  completions: { mark: async () => null },
  ratings: { setRating: async () => undefined },
} as unknown as TripRepoDeps;

/** A trip created by BOB with BOB (organizer), CAROL and SUBJECT (members). */
async function seedTrip(): Promise<string> {
  const trip = await w.seeder.insertRow('trips', { creator_id: BOB.id });
  const id = String(trip.id);
  await w.seeder.insertRow('trip_memberships', { trip_id: id, user_id: BOB.id, role: 'organizer' });
  await w.seeder.insertRow('trip_memberships', { trip_id: id, user_id: CAROL.id, role: 'member' });
  await w.seeder.insertRow('trip_memberships', { trip_id: id, user_id: SUBJECT.id, role: 'member' });
  return id;
}

describe('trip roster, counts, pickers, invites (OMIT)', () => {
  it('listMembers and listPendingInvites omit a pending member and a pending invitee; real values return after restore', async () => {
    const tripId = await seedTrip();
    await w.seeder.insertRow('trip_invites', { trip_id: tripId, inviter_id: BOB.id, invitee_id: SUBJECT.id, state: 'pending' });
    const repo = createTripRepo(w.pool, deps);

    const members = await repo.listMembers(tripId);
    expect(members.map((m) => m.userId).sort()).toEqual([BOB.id, CAROL.id].sort());
    expect(await repo.listPendingInvites(tripId)).toEqual([]);
    expect(JSON.stringify(members)).not.toContain(SUBJECT.displayName);

    await restore(w);
    expect((await repo.listMembers(tripId)).map((m) => m.userId)).toContain(SUBJECT.id);
    expect((await repo.listPendingInvites(tripId)).map((i) => i.inviteeId)).toEqual([SUBJECT.id]);
  });

  it('GET /me/trip-invites (route level) and getInvite return nothing from a pending inviter; listed again after restore', async () => {
    const tripId = await seedTrip();
    const invite = await w.seeder.insertRow('trip_invites', { trip_id: tripId, inviter_id: SUBJECT.id, invitee_id: CAROL.id, state: 'pending' });
    const repo = createTripRepo(w.pool, deps);
    const app = await buildApp(tripRoutes({ repo, requireSession: sessionStub, pool: w.pool }));

    const during = await app.inject({ method: 'GET', url: '/me/trip-invites', headers: as(CAROL.id) });
    expect(during.statusCode).toBe(200);
    expect(during.json()).toEqual([]);
    expect(during.body).not.toContain(SUBJECT.displayName);
    expect(await repo.getInvite(String(invite.id), CAROL.id)).toBeNull();

    await restore(w);
    const after = (await app.inject({ method: 'GET', url: '/me/trip-invites', headers: as(CAROL.id) })).json() as {
      inviterDisplayName: string;
    }[];
    expect(after).toHaveLength(1);
    expect(after[0]!.inviterDisplayName).toBe(SUBJECT.displayName);
  });

  it('sendInvite to a pending person is trip_not_friend (the friend check reads active_friendships)', async () => {
    const tripId = await seedTrip();
    await w.pool.query(`DELETE FROM trip_memberships WHERE trip_id = $1 AND user_id = $2`, [tripId, SUBJECT.id]);
    await befriend(w, BOB.id, SUBJECT.id);
    const repo = createTripRepo(w.pool, deps);
    await expect(repo.sendInvite(tripId, BOB.id, SUBJECT.id)).rejects.toMatchObject({ code: 'trip_not_friend' });
    await restore(w);
    await expect(repo.sendInvite(tripId, BOB.id, SUBJECT.id)).resolves.toBeDefined();
  });

  it('logCompletion cannot tag a pending member (tag pickers list active members only)', async () => {
    const tripId = await seedTrip();
    const experience = await w.seeder.insertRow('experiences');
    const repo = createTripRepo(w.pool, deps);
    await expect(
      repo.logCompletion(tripId, BOB.id, { experienceId: String(experience.id), rodeWith: [SUBJECT.id] } as never),
    ).rejects.toMatchObject({ code: 'trip_validation_failed' });
    expect((await w.pool.query(`SELECT 1 FROM trip_log_entries WHERE trip_id = $1`, [tripId])).rowCount).toBe(0);
  });

  it('getGroupFavorites counts and names only active members; the pending member is back after restore', async () => {
    const tripId = await seedTrip();
    const experience = await w.seeder.insertRow('experiences');
    for (const u of [BOB.id, CAROL.id, SUBJECT.id]) {
      await w.seeder.insertRow('experience_favorites', { user_id: u, experience_id: experience.id });
    }
    const repo = createTripRepo(w.pool, deps);
    const during = await repo.getGroupFavorites(tripId, BOB.id);
    expect(during).toHaveLength(1);
    expect(during[0]!.favoritingCount).toBe(2);
    expect(during[0]!.favoritingDisplayNames).not.toContain(SUBJECT.displayName);
    await restore(w);
    expect((await repo.getGroupFavorites(tripId, BOB.id))[0]!.favoritingCount).toBe(3);
  });
});

describe('trip feed, comments, reactions, log entries, planned items, summary (PLACEHOLDER / OMIT)', () => {
  it('feed: the actor and a commenter are shown as the placeholder; reactions by a pending member are neither counted nor flagged (Property 18)', async () => {
    const tripId = await seedTrip();
    const item = await w.seeder.insertRow('trip_feed_items', { trip_id: tripId, type: 'member_joined', actor_id: SUBJECT.id });
    await w.seeder.insertRow('trip_comments', { trip_id: tripId, target_type: 'feed_item', target_id: item.id, author_id: SUBJECT.id, body: 'hello' });
    await w.seeder.insertRow('trip_comments', { trip_id: tripId, target_type: 'feed_item', target_id: item.id, author_id: CAROL.id, body: 'hi' });
    for (const m of [SUBJECT.id, CAROL.id]) {
      await w.seeder.insertRow('trip_reactions', { trip_id: tripId, target_type: 'feed_item', target_id: item.id, member_id: m, reaction: 'like' });
    }
    const repo = createTripRepo(feedCompat(w.pool), deps);

    const during = (await repo.getFeed(tripId, BOB.id))[0]!;
    expect(during.actorDisplayName).toBe(DELETED_USER_DISPLAY_NAME);
    expect(during.actorAvatarPreset).toBeNull();
    expect(during.reactions).toEqual([{ reaction: 'like', count: 1, mine: false }]);
    const authors = during.comments.map((c) => c.authorId).sort();
    expect(authors).toEqual([CAROL.id, PLACEHOLDER].sort());
    expect(during.comments.find((c) => c.authorId === PLACEHOLDER)!.authorDisplayName).toBe(DELETED_USER_DISPLAY_NAME);
    expect(JSON.stringify(during)).not.toContain(SUBJECT.id);
    expect(JSON.stringify(during)).not.toContain(SUBJECT.displayName);

    await restore(w);
    const after = (await repo.getFeed(tripId, BOB.id))[0]!;
    expect(after.actorDisplayName).toBe(SUBJECT.displayName);
    expect(after.reactions).toEqual([{ reaction: 'like', count: 2, mine: false }]);
    expect(after.comments.map((c) => c.authorId)).toContain(SUBJECT.id);
    // The stored reaction rows were never touched.
    expect((await w.pool.query(`SELECT 1 FROM trip_reactions WHERE member_id = $1`, [SUBJECT.id])).rowCount).toBe(1);
  });

  it('feed rode-with list: the repo\'s own correlated subquery shows a pending tagged member as the placeholder id and name; real values after restore (Property 18)', async () => {
    const tripId = await seedTrip();
    const experience = await w.seeder.insertRow('experiences');
    const entry = await w.seeder.insertRow('trip_log_entries', { trip_id: tripId, member_id: BOB.id, experience_id: experience.id });
    const logEntryId = String(entry.id);
    await w.seeder.insertRow('trip_feed_items', {
      trip_id: tripId,
      type: 'completion_logged',
      actor_id: BOB.id,
      metadata: JSON.stringify({ logEntryId, experienceId: String(experience.id) }),
    });
    await w.seeder.insertRow('rode_with_tags', { log_entry_id: logEntryId, tagged_member_id: SUBJECT.id, state: 'pending' });
    await w.seeder.insertRow('rode_with_tags', { log_entry_id: logEntryId, tagged_member_id: CAROL.id, state: 'confirmed' });

    // pg-mem cannot plan the two correlated subqueries inside getFeed, so capture the SQL the repo really sends,
    // cut the rode-with subquery out of it by text, bind `le.id` to this log entry and run that text on its own.
    let feedSql = '';
    const recording = {
      query: (text: string, params?: unknown[]) => {
        if (text.includes('FROM trip_feed_items fi')) feedSql = text;
        return feedCompat(w.pool).query(text, params);
      },
    } as unknown as DbPool;
    await createTripRepo(recording, deps).getFeed(tripId, BOB.id);
    const cut = /\((SELECT json_agg[\s\S]*?WHERE rwt\.log_entry_id = le\.id)\) AS rode_with\b/.exec(feedSql);
    expect(cut, 'the feed SQL must still contain the rode-with json_agg subquery').not.toBeNull();
    // pg-mem has json_agg but not json_build_object; register the one fixed signature the subquery calls, with
    // Postgres semantics (alternating key/value pairs into a JSON object).
    try {
      w.db.public.registerFunction({
        name: 'json_build_object',
        args: [DataType.text, DataType.uuid, DataType.text, DataType.text, DataType.text, DataType.text],
        returns: DataType.json,
        implementation: (k1: string, v1: string, k2: string, v2: string, k3: string, v3: string): Record<string, string> => ({
          [k1]: v1,
          [k2]: v2,
          [k3]: v3,
        }),
      });
    } catch {
      /* already registered on the shared base database */
    }
    const subquery = cut![1]!.replace(/\ble\.id\b/g, `'${logEntryId}'::uuid`);
    expect(subquery).toContain('JOIN profile_identity pr');
    expect(subquery).not.toContain('rwt.tagged_member_id,');

    const read = async (): Promise<{ taggedMemberId: string; displayName: string; state: string }[]> => {
      const res = await w.pool.query<{ rode_with: { taggedMemberId: string; displayName: string; state: string }[] }>(
        `SELECT (${subquery}) AS rode_with`,
      );
      // pg-mem returns the aggregated json array wrapped in one more array; Postgres returns it unwrapped.
      return (res.rows[0]!.rode_with as unknown as unknown[]).flat() as { taggedMemberId: string; displayName: string; state: string }[];
    };

    const during = await read();
    expect(during).toHaveLength(2);
    expect(during.find((t) => t.state === 'pending')).toEqual({
      taggedMemberId: PLACEHOLDER,
      displayName: DELETED_USER_DISPLAY_NAME,
      state: 'pending',
    });
    expect(during.find((t) => t.state === 'confirmed')).toEqual({
      taggedMemberId: CAROL.id,
      displayName: CAROL.displayName,
      state: 'confirmed',
    });
    expect(JSON.stringify(during)).not.toContain(SUBJECT.id);
    expect(JSON.stringify(during)).not.toContain(SUBJECT.displayName);

    await restore(w);
    expect((await read()).find((t) => t.state === 'pending')).toEqual({
      taggedMemberId: SUBJECT.id,
      displayName: SUBJECT.displayName,
      state: 'pending',
    });
  });

  it('log entries: the logging member and a tagged member are the placeholder id and name; pending tags of a pending tagger are not listed (and not for a purging tagger)', async () => {
    const tripId = await seedTrip();
    const entry = await w.seeder.insertRow('trip_log_entries', { trip_id: tripId, member_id: SUBJECT.id });
    await w.seeder.insertRow('rode_with_tags', { log_entry_id: entry.id, tagged_member_id: CAROL.id, state: 'pending' });
    const repo = createTripRepo(w.pool, deps);

    const [during] = await repo.listLogEntries(tripId);
    expect(during!.memberId).toBe(PLACEHOLDER);
    expect(isDeletedUserId(during!.memberId)).toBe(true);
    expect(during!.memberDisplayName).toBe(DELETED_USER_DISPLAY_NAME);
    // CAROL's pending-tag list (Notification_Center) omits the tag from a non-visible tagger.
    expect(await repo.listPendingRodeWithTags(CAROL.id)).toEqual([]);
    await makePurging(w);
    expect(await repo.listPendingRodeWithTags(CAROL.id)).toEqual([]);

    await w.pool.query(`UPDATE users SET deletion_state = 'pending_deletion' WHERE id = $1`, [SUBJECT.id]);
    await restore(w);
    expect((await repo.listLogEntries(tripId))[0]!.memberId).toBe(SUBJECT.id);
    const listed = await repo.listPendingRodeWithTags(CAROL.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.taggingMemberDisplayName).toBe(SUBJECT.displayName);
  });

  it('a tag whose tagged member is pending shows that member as the placeholder in the log entry', async () => {
    const tripId = await seedTrip();
    const entry = await w.seeder.insertRow('trip_log_entries', { trip_id: tripId, member_id: CAROL.id });
    await w.seeder.insertRow('rode_with_tags', { log_entry_id: entry.id, tagged_member_id: SUBJECT.id, state: 'pending' });
    const repo = createTripRepo(w.pool, deps);
    const [during] = await repo.listLogEntries(tripId);
    expect(during!.rodeWith.map((t) => t.taggedMemberId)).toEqual([PLACEHOLDER]);
    await restore(w);
    expect((await repo.listLogEntries(tripId))[0]!.rodeWith.map((t) => t.taggedMemberId)).toEqual([SUBJECT.id]);
  });

  it('a rode-with confirmation shows a pending tagging member as the placeholder name', async () => {
    const tripId = await seedTrip();
    const entry = await w.seeder.insertRow('trip_log_entries', { trip_id: tripId, member_id: SUBJECT.id });
    const tag = await w.seeder.insertRow('rode_with_tags', { log_entry_id: entry.id, tagged_member_id: CAROL.id, state: 'pending' });
    const repo = createTripRepo(w.pool, deps);
    expect((await repo.getRodeWithTag(String(tag.id), CAROL.id))!.taggingMemberDisplayName).toBe(DELETED_USER_DISPLAY_NAME);
    await restore(w);
    expect((await repo.getRodeWithTag(String(tag.id), CAROL.id))!.taggingMemberDisplayName).toBe(SUBJECT.displayName);
  });

  it('planned items: the adder is the placeholder name while pending', async () => {
    const tripId = await seedTrip();
    await w.seeder.insertRow('planned_items', { trip_id: tripId, added_by: SUBJECT.id });
    const repo = createTripRepo(w.pool, deps);
    expect((await repo.listPlannedItems(tripId))[0]!.addedByDisplayName).toBe(DELETED_USER_DISPLAY_NAME);
    await restore(w);
    expect((await repo.listPlannedItems(tripId))[0]!.addedByDisplayName).toBe(SUBJECT.displayName);
  });

  it('trip summary: a pending member keeps their counts but appears as the placeholder id and name', async () => {
    const tripId = await seedTrip();
    await w.seeder.insertRow('trip_log_entries', { trip_id: tripId, member_id: SUBJECT.id });
    const repo = createTripRepo(w.pool, deps);
    const during = await repo.getSummary(tripId);
    const row = during.perMember.find((m) => m.logEntryCount === 1)!;
    expect(row.memberId).toBe(PLACEHOLDER);
    expect(row.displayName).toBe(DELETED_USER_DISPLAY_NAME);
    expect(row.avatarPreset).toBeNull();
    expect(JSON.stringify(during)).not.toContain(SUBJECT.id);
    await restore(w);
    const after = (await repo.getSummary(tripId)).perMember.find((m) => m.logEntryCount === 1)!;
    expect(after.memberId).toBe(SUBJECT.id);
    expect(after.displayName).toBe(SUBJECT.displayName);
  });
});

describe('trip booking: reminder roster, packing list, assignee, done marks', () => {
  it('listReminderRecipients omits a pending member; packing list shows the placeholder adder and drops a pending assignee; assignment to a pending member is rejected', async () => {
    const tripId = await seedTrip();
    const repo = createTripBookingRepo(w.pool);
    expect((await repo.listReminderRecipients(tripId)).sort()).toEqual([BOB.id, CAROL.id].sort());

    await w.seeder.insertRow('trip_packing_items', {
      trip_id: tripId, name: 'Poncho', category: 'clothing', added_by: SUBJECT.id, assignee_id: SUBJECT.id,
    });
    const list = await repo.listPacking(tripId);
    const item = list.items[0]!;
    expect(item.addedById).toBe(PLACEHOLDER);
    expect(item.addedByDisplayName).toBe(DELETED_USER_DISPLAY_NAME);
    expect(item.assigneeId).toBeNull();
    expect(JSON.stringify(list)).not.toContain(SUBJECT.id);

    await expect(
      repo.addPackingItem(tripId, BOB.id, { name: 'Sunscreen', category: 'toiletries', assigneeId: SUBJECT.id } as never),
    ).rejects.toMatchObject({ code: 'trip_validation_failed' });

    await restore(w);
    expect((await repo.listReminderRecipients(tripId)).sort()).toEqual([BOB.id, CAROL.id, SUBJECT.id].sort());
    const after = (await repo.listPacking(tripId)).items[0]!;
    expect(after.addedById).toBe(SUBJECT.id);
    expect(after.assigneeId).toBe(SUBJECT.id);
  });

  it('a booking window marked done by a pending member shows the placeholder name; the real name returns after restore', async () => {
    const tripId = await seedTrip();
    await w.seeder.insertRow('trip_booking_window_done', { trip_id: tripId, marked_by: SUBJECT.id, drop_on: '2026-09-01' });
    const repo = createTripBookingRepo(w.pool);
    const names = async (): Promise<string[]> =>
      [...(await repo.getTimelineInputs(tripId, BOB.id))!.doneMarks.values()].map((m) => m.markedByDisplayName);
    expect(await names()).toEqual([DELETED_USER_DISPLAY_NAME]);
    await restore(w);
    expect(await names()).toEqual([SUBJECT.displayName]);
  });

  it('toggling a packing item added by a pending member never reveals their real id or name', async () => {
    const tripId = await seedTrip();
    const row = await w.seeder.insertRow('trip_packing_items', { trip_id: tripId, name: 'Hat', category: 'clothing', added_by: SUBJECT.id });
    const repo = createTripBookingRepo(w.pool);
    const toggled = await repo.setPacked(tripId, String(row.id), BOB.id, true);
    expect(toggled.addedById).toBe(PLACEHOLDER);
    expect(toggled.addedByDisplayName).toBe(DELETED_USER_DISPLAY_NAME);
  });
});

describe('food and experience lists (OMIT)', () => {
  it('food lists: a pending owner\'s list is not served (detail, discovery, saved), shared-with entries are hidden, item adders show the placeholder; all return after restore', async () => {
    const lists = createFoodListRepo(w.pool);
    const shares = createFoodListShareRepo(w.pool);
    const affinity = createFoodListAffinityRepo(w.pool, lists);
    const owned = await lists.createList(SUBJECT.id, { name: 'Snacks', visibility: 'public' } as never);
    const bobs = await lists.createList(BOB.id, { name: 'Bobs', visibility: 'private' } as never);
    await befriend(w, BOB.id, CAROL.id);
    await befriend(w, BOB.id, SUBJECT.id);
    await w.seeder.insertRow('food_list_shares', { food_list_id: bobs.id, shared_with_user_id: SUBJECT.id, shared_by_user_id: BOB.id, role: 'viewer' });
    await w.seeder.insertRow('food_list_shares', { food_list_id: bobs.id, shared_with_user_id: CAROL.id, shared_by_user_id: BOB.id, role: 'viewer' });
    await w.seeder.insertRow('food_list_saves', { food_list_id: owned.id, saved_by_user_id: CAROL.id });

    await expect(lists.getListDetail(owned.id, CAROL.id)).rejects.toMatchObject({ code: 'food_list_not_found' });
    expect((await lists.discover('popular')).items.map((l) => l.id)).not.toContain(owned.id);
    expect((await shares.listShares(bobs.id, BOB.id)).map((s) => s.recipientId)).toEqual([CAROL.id]);
    const saved = (await affinity.getCollection(CAROL.id)).saved;
    expect(saved).toHaveLength(1);
    expect(saved[0]!.available).toBe(false);

    await restore(w);
    expect((await lists.getListDetail(owned.id, CAROL.id)).ownerDisplayName).toBe(SUBJECT.displayName);
    expect((await lists.discover('popular')).items.map((l) => l.id)).toContain(owned.id);
    expect((await shares.listShares(bobs.id, BOB.id)).map((s) => s.recipientId).sort()).toEqual([CAROL.id, SUBJECT.id].sort());
    expect((await affinity.getCollection(CAROL.id)).saved[0]!.available).toBe(true);
  });

  it('food list share to a pending friend is food_list_share_not_friend', async () => {
    const lists = createFoodListRepo(w.pool);
    const shares = createFoodListShareRepo(w.pool);
    const bobs = await lists.createList(BOB.id, { name: 'Bobs', visibility: 'private' } as never);
    await befriend(w, BOB.id, SUBJECT.id);
    await expect(shares.shareWithFriend(bobs.id, BOB.id, SUBJECT.id, 'viewer')).rejects.toMatchObject({
      code: 'food_list_share_not_friend',
    });
    await restore(w);
    await expect(shares.shareWithFriend(bobs.id, BOB.id, SUBJECT.id, 'viewer')).resolves.toMatchObject({ action: 'created' });
  });

  it('experience lists: the same rules (detail, discovery, shared-with, saved)', async () => {
    const lists = createExperienceListRepo(w.pool);
    const shares = createExperienceListShareRepo(w.pool);
    const affinity = createExperienceListAffinityRepo(w.pool, lists);
    const owned = await lists.createList(SUBJECT.id, { name: 'Rides', visibility: 'public' } as never);
    const bobs = await lists.createList(BOB.id, { name: 'Bobs', visibility: 'private' } as never);
    await befriend(w, BOB.id, SUBJECT.id);
    await befriend(w, BOB.id, CAROL.id);
    await w.seeder.insertRow('experience_list_shares', { experience_list_id: bobs.id, shared_with_user_id: SUBJECT.id, shared_by_user_id: BOB.id, role: 'viewer' });
    await w.seeder.insertRow('experience_list_shares', { experience_list_id: bobs.id, shared_with_user_id: CAROL.id, shared_by_user_id: BOB.id, role: 'viewer' });
    await w.seeder.insertRow('experience_list_saves', { experience_list_id: owned.id, saved_by_user_id: CAROL.id });

    await expect(lists.getListDetail(owned.id, CAROL.id)).rejects.toMatchObject({ code: 'experience_list_not_found' });
    expect((await lists.discover('popular')).items.map((l) => l.id)).not.toContain(owned.id);
    expect((await shares.listShares(bobs.id, BOB.id)).map((s) => s.recipientId)).toEqual([CAROL.id]);
    expect((await affinity.getCollection(CAROL.id)).saved[0]!.available).toBe(false);

    await restore(w);
    expect((await lists.getListDetail(owned.id, CAROL.id)).ownerDisplayName).toBe(SUBJECT.displayName);
    expect((await shares.listShares(bobs.id, BOB.id)).map((s) => s.recipientId).sort()).toEqual([CAROL.id, SUBJECT.id].sort());
    expect((await affinity.getCollection(CAROL.id)).saved[0]!.available).toBe(true);
  });

  it('the two trip list-owner resolvers (composeServices ports) return null for a pending owner and the list after restore', async () => {
    const lists = createFoodListRepo(w.pool);
    const expLists = createExperienceListRepo(w.pool);
    const food = await lists.createList(SUBJECT.id, { name: 'Snacks', visibility: 'public' } as never);
    const exp = await expLists.createList(SUBJECT.id, { name: 'Rides', visibility: 'public' } as never);
    const resolveFood = resolveFoodListForTrip(w.pool);
    const resolveExp = resolveExperienceListForTrip(w.pool);
    expect(await resolveFood(food.id)).toBeNull();
    expect(await resolveExp(exp.id)).toBeNull();
    await restore(w);
    expect(await resolveFood(food.id)).toMatchObject({ id: food.id, ownerDisplayName: SUBJECT.displayName });
    expect(await resolveExp(exp.id)).toMatchObject({ id: exp.id, ownerDisplayName: SUBJECT.displayName });
  });
});
