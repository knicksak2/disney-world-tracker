/**
 * Task 12.1: social surfaces hide a pending person from everyone else (account-deletion R5, Appendix B).
 *
 * One pg-mem repo test per Appendix B row: an ACTIVE person (BOB, CAROL, DAVE) and a PENDING one (SUBJECT) are
 * seeded; an OMIT surface must not contain SUBJECT, a PLACEHOLDER surface shows `public_id`, `Deleted user` and a
 * null avatar; and the SAME call after Restoration returns the real values again, with no stored row changed.
 */
import { randomUUID } from 'node:crypto';

import { DELETED_USER_DISPLAY_NAME, isDeletedUserId } from '@dwt/shared';
import fc from 'fast-check';
import { DataType } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { assertOwnerOrFriend } from '../../friends/ownerOrFriend.js';
import { friendsRoutes } from '../../friends/routes.js';
import { createFriendsRepo } from '../../friends/repo.js';
import { createFriendFoodRatingsRepo } from '../../friendFoodRatings/repo.js';
import { createSenderDisplayNameResolver } from '../../notifications/directory.js';
import { createPinRepo } from '../../pins/repo.js';
import { showcaseRoutes } from '../../pins/showcaseRoutes.js';
import { createReactionsRepo } from '../../reactions/repo.js';
import { createSharingRepo } from '../../sharing/repo.js';
import { DefaultRecapShareGate } from '../../sharing/tripRecapGate.js';
import { statsRoutes } from '../../stats/routes.js';
import { profileRoutes } from '../../auth/profileRoutes.js';
import {
  as,
  befriend,
  BOB,
  buildApp,
  CAROL,
  createWorld,
  DAVE,
  makePending,
  makePurging,
  makeTombstone,
  restore,
  sessionStub,
  SUBJECT,
  type Row,
  type World,
} from './visibility.harness.js';

let w: World;
let pool: DbPool;

/**
 * pg-mem compatibility shims for three statements the repos send (the SQL under test is unchanged; Postgres
 * runs it as written): `ILIKE ... ESCAPE '\'`, and the multi-row `INSERT ... SELECT ... FROM unnest($2::uuid[])`.
 */
function pgMemCompat(inner: DbPool): DbPool {
  const fix = (text: string, params?: readonly unknown[]): [string, readonly unknown[] | undefined] => {
    let t = text.replace(/\s+ESCAPE\s+'\\'/g, '');
    let p = params;
    if (/FROM unnest\(\$2::uuid\[\]\)/.test(t) && p) {
      const ids = p[1] as string[];
      t = `INSERT INTO share_recipients (share_id, recipient_id) VALUES ${ids.map((_, i) => `($1, $${i + 2})`).join(', ')}`;
      p = [p[0], ...ids];
    }
    return [t, p];
  };
  return {
    query: (text: string, params?: readonly unknown[]) => inner.query(...(fix(text, params) as [string, unknown[]])),
    async connect() {
      const c = await inner.connect();
      return {
        query: (text: string, params?: readonly unknown[]) => c.query(...(fix(text, params) as [string, unknown[]])),
        release: () => c.release(),
      };
    },
  } as unknown as DbPool;
}

beforeEach(async () => {
  w = await createWorld();
  // friend social proof formats `visited_on` with to_char(date, text), which pg-mem lacks.
  try {
    w.db.public.registerFunction({
      name: 'to_char',
      args: [DataType.date, DataType.text],
      returns: DataType.text,
      implementation: (d: unknown): string => new Date(d as string).toISOString().slice(0, 10),
    });
  } catch {
    /* already registered on the shared base database */
  }
  pool = pgMemCompat(w.pool);
  await makePending(w, SUBJECT.id);
});

const PLACEHOLDER = `deadc0de-${SUBJECT.id.slice(9)}`;

describe('friends (searchUsers, list, requests, send/accept/decline)', () => {
  it('searchUsers: a pending person is not found by name or email, and the email is never returned; found again after restore', async () => {
    const repo = createFriendsRepo(pool);
    expect(await repo.searchUsers(BOB.id, 'Purge Subject')).toEqual([]);
    expect(await repo.searchUsers(BOB.id, SUBJECT.email)).toEqual([]);
    const carol = await repo.searchUsers(BOB.id, 'Carol');
    expect(carol.map((h) => h.id)).toEqual([CAROL.id]);

    await restore(w);
    const after = await repo.searchUsers(BOB.id, 'Purge Subject');
    expect(after).toEqual([{ id: SUBJECT.id, displayName: SUBJECT.displayName, email: SUBJECT.email }]);
  });

  it('listFriendsAndRequests: friends and both request directions omit a pending person; real values return after restore', async () => {
    await befriend(w, BOB.id, SUBJECT.id);
    await befriend(w, BOB.id, CAROL.id);
    // Requests live in their own table: SUBJECT -> BOB (incoming for BOB), BOB -> SUBJECT (outgoing), DAVE -> BOB (control).
    await w.seeder.insertRow('friend_requests', { sender_id: SUBJECT.id, recipient_id: BOB.id });
    await w.seeder.insertRow('friend_requests', { sender_id: BOB.id, recipient_id: SUBJECT.id });
    await w.seeder.insertRow('friend_requests', { sender_id: DAVE.id, recipient_id: BOB.id });
    const repo = createFriendsRepo(w.pool);

    const during = await repo.listFriendsAndRequests(BOB.id);
    expect(during.friends.map((f) => f.userId)).toEqual([CAROL.id]);
    expect(during.incomingRequests.map((r) => r.otherUserId)).toEqual([DAVE.id]);
    expect(during.outgoingRequests).toEqual([]);
    expect(JSON.stringify(during)).not.toContain(SUBJECT.id);
    expect(JSON.stringify(during)).not.toContain(SUBJECT.displayName);

    await restore(w);
    const after = await repo.listFriendsAndRequests(BOB.id);
    expect(after.friends.map((f) => f.userId).sort()).toEqual([CAROL.id, SUBJECT.id].sort());
    expect(after.incomingRequests.map((r) => r.otherUserId).sort()).toEqual([DAVE.id, SUBJECT.id].sort());
    expect(after.outgoingRequests.map((r) => r.otherUserId)).toEqual([SUBJECT.id]);
  });

  it('sendRequest to a pending person answers friend_recipient_unknown and writes nothing; works after restore', async () => {
    const repo = createFriendsRepo(w.pool);
    await expect(repo.sendRequest(BOB.id, SUBJECT.id)).rejects.toMatchObject({ code: 'friend_recipient_unknown' });
    expect((await w.pool.query(`SELECT 1 FROM friend_requests`)).rowCount).toBe(0);

    await restore(w);
    const created = await repo.sendRequest(BOB.id, SUBJECT.id);
    expect(created.recipientId).toBe(SUBJECT.id);
  });

  it('acceptRequest and declineRequest of a request from a pending sender find nothing and change nothing; both work after restore', async () => {
    const req = await w.seeder.insertRow('friend_requests', { sender_id: SUBJECT.id, recipient_id: BOB.id });
    const repo = createFriendsRepo(w.pool);

    expect(await repo.acceptRequest(BOB.id, String(req.id))).toBeNull();
    expect(await repo.declineRequest(BOB.id, String(req.id))).toBe(false);
    expect((await w.pool.query(`SELECT id FROM friend_requests WHERE id = $1`, [req.id])).rowCount).toBe(1);
    expect((await w.pool.query(`SELECT 1 FROM friendships`)).rowCount).toBe(0);

    await restore(w);
    expect(await repo.acceptRequest(BOB.id, String(req.id))).not.toBeNull();
    expect((await w.pool.query(`SELECT 1 FROM friendships`)).rowCount).toBe(1);
  });

  it('GET /me/friends (route level) returns nothing for a pending friend and a pending requester', async () => {
    await befriend(w, BOB.id, SUBJECT.id);
    await befriend(w, BOB.id, CAROL.id);
    await w.seeder.insertRow('friend_requests', { sender_id: SUBJECT.id, recipient_id: BOB.id });
    const app = await buildApp(friendsRoutes({ repo: createFriendsRepo(w.pool), requireSession: sessionStub }));

    const res = await app.inject({ method: 'GET', url: '/me/friends', headers: as(BOB.id) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { friends: { userId: string }[]; incomingRequests: unknown[] };
    expect(body.friends.map((f) => f.userId)).toEqual([CAROL.id]);
    expect(body.incomingRequests).toEqual([]);
    expect(res.body).not.toContain(SUBJECT.id);

    await restore(w);
    const after = (await app.inject({ method: 'GET', url: '/me/friends', headers: as(BOB.id) })).json() as {
      friends: { userId: string }[];
      incomingRequests: unknown[];
    };
    expect(after.friends).toHaveLength(2);
    expect(after.incomingRequests).toHaveLength(1);
  });
});

describe('owner-or-friend gate, profile, stats, Pin Showcase, friend food ratings', () => {
  it('assertOwnerOrFriend: a pending friend is forbidden; the owner is never gated; allowed again after restore', async () => {
    await befriend(w, BOB.id, SUBJECT.id);
    await expect(assertOwnerOrFriend(w.pool, BOB.id, SUBJECT.id)).rejects.toMatchObject({ code: 'profile_forbidden' });
    await expect(assertOwnerOrFriend(w.pool, SUBJECT.id, SUBJECT.id)).resolves.toBeUndefined();
    await restore(w);
    await expect(assertOwnerOrFriend(w.pool, BOB.id, SUBJECT.id)).resolves.toBeUndefined();
  });

  it('GET /users/:id/profile: profile_forbidden for a pending friend, the real profile after restore', async () => {
    await befriend(w, BOB.id, SUBJECT.id);
    const app = await buildApp(async (a) => {
      await a.register(profileRoutes, { pool: w.pool, requireAuth: sessionStub });
    });
    const during = await app.inject({ method: 'GET', url: `/users/${SUBJECT.id}/profile`, headers: as(BOB.id) });
    expect(during.statusCode).toBe(403);
    expect((during.json() as { error: { code: string } }).error.code).toBe('profile_forbidden');
    expect(during.body).not.toContain(SUBJECT.displayName);

    await restore(w);
    const after = await app.inject({ method: 'GET', url: `/users/${SUBJECT.id}/profile`, headers: as(BOB.id) });
    expect(after.statusCode).toBe(200);
    expect((after.json() as { displayName: string }).displayName).toBe(SUBJECT.displayName);
  });

  it('GET /me/stats/summary?for=: a pending friend and a never-existing id both give stats_target_not_found; an active non-friend stays profile_forbidden', async () => {
    await befriend(w, BOB.id, SUBJECT.id);
    // The repo must never be read on a deny path.
    const repo = new Proxy({}, { get: () => { throw new Error('snapshot read on a deny path'); } }) as never;
    const app = await buildApp(statsRoutes({ repo, pool: w.pool, requireSession: sessionStub }));
    const code = async (target: string): Promise<{ status: number; code: string }> => {
      const res = await app.inject({ method: 'GET', url: `/me/stats/summary?for=${target}`, headers: as(BOB.id) });
      return { status: res.statusCode, code: (res.json() as { error: { code: string } }).error.code };
    };

    const pendingFriend = await code(SUBJECT.id);
    const neverExisted = await code(randomUUID());
    expect(pendingFriend).toEqual(neverExisted);
    expect(pendingFriend.code).toBe('stats_target_not_found');
    expect(await code(CAROL.id)).toEqual({ status: 403, code: 'profile_forbidden' });
  });

  it('GET /users/:id/pin-showcase: gated by the same rule (pending friend forbidden)', async () => {
    await befriend(w, BOB.id, SUBJECT.id);
    const repo = { getFriendShowcase: async () => ({ ownerId: SUBJECT.id, placements: [] }) } as never;
    const app = await buildApp(showcaseRoutes({ repo, pool: w.pool, requireSession: sessionStub }));
    const during = await app.inject({ method: 'GET', url: `/users/${SUBJECT.id}/pin-showcase`, headers: as(BOB.id) });
    expect(during.statusCode).toBe(403);
    await restore(w);
    const after = await app.inject({ method: 'GET', url: `/users/${SUBJECT.id}/pin-showcase`, headers: as(BOB.id) });
    expect(after.statusCode).toBe(200);
  });

  it('friend food ratings: a pending friend contributes no social proof row; present after restore', async () => {
    await befriend(w, BOB.id, SUBJECT.id);
    await befriend(w, BOB.id, CAROL.id);
    const experience = await w.seeder.insertRow('experiences');
    const item = await w.seeder.insertRow('food_items', { experience_id: experience.id });
    for (const u of [SUBJECT.id, CAROL.id]) {
      await w.seeder.insertRow('food_item_logs', { user_id: u, food_item_id: item.id, rating: 9 });
    }
    const repo = createFriendFoodRatingsRepo(w.pool);
    const scope = { kind: 'experience' as const, id: String(experience.id) };

    const during = await repo.listFriendSocialProof(BOB.id, scope);
    expect(during.rows.map((r) => r.friendId)).toEqual([CAROL.id]);

    await restore(w);
    const after = await repo.listFriendSocialProof(BOB.id, scope);
    expect(after.rows.map((r) => r.friendId).sort()).toEqual([CAROL.id, SUBJECT.id].sort());
  });

  it('pins reconcileAll skips non-active accounts (pending, purging) and includes them again after restore', async () => {
    const repo = createPinRepo(w.pool);
    expect((await repo.reconcileAll()).usersProcessed).toBe(3);
    await makePurging(w);
    expect((await repo.reconcileAll()).usersProcessed).toBe(3);
    await w.pool.query(
      `UPDATE users SET deletion_state = 'pending_deletion', purge_claimed_at = NULL WHERE id = $1`,
      [SUBJECT.id],
    );
    await restore(w);
    expect((await repo.reconcileAll()).usersProcessed).toBe(4);
  });
});

describe('sharing: inbox, Sent, single share, recipient validity, unread badge (Properties 18, 20)', () => {
  const payloads = (experienceId: string, tripId: string, ownerId: string, ownerName: string) => ({
    experience: { kind: 'experience', experienceId, note: 'loved it' },
    progress: { kind: 'progress', overallPercent: 40, perParkPercent: {}, perCategoryPercent: {} },
    pinShowcase: { kind: 'pinShowcase', ownerId, ownerDisplayName: ownerName },
    tripSummary: { kind: 'tripSummary', tripId, tripName: 'Spring', sharerDisplayName: ownerName, includePhotos: false },
  });

  async function deliver(senderId: string, kind: string, payload: object, recipientId: string): Promise<string> {
    const row = await w.seeder.insertRow('shares', {
      sender_id: senderId,
      payload_kind: kind,
      payload_snapshot: payload,
      ...(kind === 'experience' ? { experience_id: (payload as { experienceId: string }).experienceId } : {}),
    });
    await w.seeder.insertRow('share_recipients', { share_id: row.id, recipient_id: recipientId });
    return String(row.id);
  }

  const stored = async (shareId: string): Promise<unknown> =>
    ((await w.pool.query(`SELECT payload_snapshot FROM shares WHERE id = $1`, [shareId])).rows[0] as Row).payload_snapshot;

  it.each(['experience', 'progress', 'pinShowcase', 'tripSummary'] as const)(
    'inbox: a pending sender\'s %s share stays readable as the placeholder, embedded names are replaced at read time, the stored row is unchanged, real values return after restore',
    async (kind) => {
      const experience = await w.seeder.insertRow('experiences');
      const p = payloads(String(experience.id), randomUUID(), SUBJECT.id, SUBJECT.displayName)[kind];
      const shareId = await deliver(SUBJECT.id, kind, p, BOB.id);
      const sharing = createSharingRepo(w.pool);
      const storedBefore = JSON.stringify(await stored(shareId));

      const during = await sharing.listInbox(BOB.id);
      expect(during.items).toHaveLength(1);
      const item = during.items[0]!;
      expect(item.senderId).toBe(PLACEHOLDER);
      expect(isDeletedUserId(item.senderId)).toBe(true);
      expect(item.senderDisplayName).toBe(DELETED_USER_DISPLAY_NAME);
      expect(JSON.stringify(item)).not.toContain(SUBJECT.displayName);
      expect(JSON.stringify(item)).not.toContain(SUBJECT.id);
      if (kind === 'pinShowcase') {
        expect(item.payload).toEqual({ kind, ownerId: PLACEHOLDER, ownerDisplayName: DELETED_USER_DISPLAY_NAME });
      } else if (kind === 'tripSummary') {
        expect(item.payload).toMatchObject({ kind, sharerDisplayName: DELETED_USER_DISPLAY_NAME });
      } else {
        expect(item.payload).toEqual(p);
      }
      // The stored row is exactly what the sender wrote.
      expect(JSON.stringify(await stored(shareId))).toBe(storedBefore);

      // The single-share lookup applies the same rule.
      const opened = await sharing.openShare(BOB.id, shareId);
      expect(opened?.senderId).toBe(PLACEHOLDER);
      expect(JSON.stringify(opened?.payload)).not.toContain(SUBJECT.displayName);

      await restore(w);
      const after = await sharing.listInbox(BOB.id);
      expect(after.items[0]!.senderId).toBe(SUBJECT.id);
      expect(after.items[0]!.senderDisplayName).toBe(SUBJECT.displayName);
      expect(after.items[0]!.payload).toEqual(p);
      expect(JSON.stringify(await stored(shareId))).toBe(storedBefore);
    },
  );

  it('countUnreadInbox: counts active and restored senders, never pending, purging or tombstone senders, while listInbox returns the share in every state', async () => {
    const sharing = createSharingRepo(w.pool);
    const experience = await w.seeder.insertRow('experiences');
    const p = payloads(String(experience.id), randomUUID(), SUBJECT.id, SUBJECT.displayName);
    await deliver(SUBJECT.id, 'progress', p.progress, BOB.id);
    await deliver(CAROL.id, 'progress', p.progress, BOB.id); // an active sender's share is always counted

    // pending
    expect(await sharing.countUnreadInbox(BOB.id)).toBe(1);
    expect((await sharing.listInbox(BOB.id)).items).toHaveLength(2);
    // purging
    await makePurging(w);
    expect(await sharing.countUnreadInbox(BOB.id)).toBe(1);
    expect((await sharing.listInbox(BOB.id)).items).toHaveLength(2);
    // restored
    await w.pool.query(`UPDATE users SET deletion_state = 'pending_deletion' WHERE id = $1`, [SUBJECT.id]);
    await restore(w);
    expect(await sharing.countUnreadInbox(BOB.id)).toBe(2);
    // tombstone sender: a real tombstone row (the purge re-points the share's sender at it)
    const tombstoneId = await makeTombstone(w);
    await w.pool.query(`UPDATE shares SET sender_id = $1 WHERE sender_id = $2`, [tombstoneId, SUBJECT.id]);
    expect(await sharing.countUnreadInbox(BOB.id)).toBe(1);
    const inbox = await sharing.listInbox(BOB.id);
    expect(inbox.items).toHaveLength(2);
    expect(inbox.items.some((i) => i.senderId === tombstoneId && i.senderDisplayName === DELETED_USER_DISPLAY_NAME)).toBe(true);
  });

  it('Sent list: the sender\'s own shares are listed unchanged whatever state a recipient is in (it reads no other person)', async () => {
    const share = await deliver(BOB.id, 'progress', { kind: 'progress', overallPercent: 1, perParkPercent: {}, perCategoryPercent: {} }, SUBJECT.id);
    const sharing = createSharingRepo(w.pool);
    const during = await sharing.listSentShares(BOB.id);
    expect(during.map((s) => s.shareId)).toEqual([share]);
    expect(JSON.stringify(during)).not.toContain(SUBJECT.id);
    await restore(w);
    expect((await sharing.listSentShares(BOB.id)).map((s) => s.shareId)).toEqual([share]);
  });

  it('createShareAtomic: a pending recipient is not a valid recipient (the atomic friend check rejects) and nothing is written', async () => {
    await befriend(w, BOB.id, SUBJECT.id);
    await befriend(w, BOB.id, CAROL.id);
    const sharing = createSharingRepo(pool);
    const payload = { kind: 'progress', overallPercent: 1, perParkPercent: {}, perCategoryPercent: {} } as never;
    await expect(sharing.createShareAtomic(BOB.id, [SUBJECT.id, CAROL.id], payload)).rejects.toMatchObject({
      code: 'share_atomic_rejected',
    });
    expect((await w.pool.query(`SELECT 1 FROM shares`)).rowCount).toBe(0);
    await restore(w);
    const ok = await sharing.createShareAtomic(BOB.id, [SUBJECT.id, CAROL.id], payload);
    expect(ok.deliveredTo).toBe(2);
  });

  it('property: for any mix of senders, the badge equals the unread shares from ACTIVE senders only (Property 18)', async () => {
    const sharing = createSharingRepo(w.pool);
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom(CAROL.id, DAVE.id, SUBJECT.id), { minLength: 0, maxLength: 6 }), async (senders) => {
        await w.pool.query(`DELETE FROM shares`);
        for (const s of senders) {
          await deliver(s, 'progress', { kind: 'progress', overallPercent: 1, perParkPercent: {}, perCategoryPercent: {} }, BOB.id);
        }
        // Feature: account-deletion, Property 18: the unread badge never counts a share from a non-active sender
        expect(await sharing.countUnreadInbox(BOB.id)).toBe(senders.filter((s) => s !== SUBJECT.id).length);
        expect((await sharing.listInbox(BOB.id)).items).toHaveLength(senders.length);
      }),
      { numRuns: 100 },
    );
  });
});

describe('share reactions, notification sender name, shared trip recap gate', () => {
  it('listReactionsForSender: a pending recipient\'s reaction is not shown; shown after restore', async () => {
    const share = await w.seeder.insertRow('shares', {
      sender_id: BOB.id,
      payload_kind: 'progress',
      payload_snapshot: { kind: 'progress', overallPercent: 1, perParkPercent: {}, perCategoryPercent: {} },
    });
    for (const r of [SUBJECT.id, CAROL.id]) {
      await w.seeder.insertRow('share_recipients', { share_id: share.id, recipient_id: r });
      await w.seeder.insertRow('share_reactions', { share_id: share.id, recipient_id: r, reaction: 'love' });
    }
    const repo = createReactionsRepo(w.pool);
    const during = await repo.listReactionsForSender(String(share.id), BOB.id);
    expect(during.map((r) => r.reactorId)).toEqual([CAROL.id]);
    expect(JSON.stringify(during)).not.toContain(SUBJECT.displayName);
    await restore(w);
    const after = await repo.listReactionsForSender(String(share.id), BOB.id);
    expect(after.map((r) => r.reactorId).sort()).toEqual([CAROL.id, SUBJECT.id].sort());
  });

  it('notification sender name resolves to the placeholder name while pending and the real name after restore', async () => {
    const resolve = createSenderDisplayNameResolver(w.pool);
    expect(await resolve(SUBJECT.id)).toBe(DELETED_USER_DISPLAY_NAME);
    expect(await resolve(CAROL.id)).toBe(CAROL.displayName);
    await restore(w);
    expect(await resolve(SUBJECT.id)).toBe(SUBJECT.displayName);
  });

  it('shared trip recap gate: a pending sender\'s recap is unavailable to a recipient exactly as if unfriended; available after restore', async () => {
    await befriend(w, BOB.id, SUBJECT.id);
    const tripId = randomUUID();
    const share = await w.seeder.insertRow('shares', {
      sender_id: SUBJECT.id,
      payload_kind: 'tripSummary',
      payload_snapshot: { kind: 'tripSummary', tripId, tripName: 'Spring', sharerDisplayName: SUBJECT.displayName, includePhotos: false },
    });
    await w.seeder.insertRow('share_recipients', { share_id: share.id, recipient_id: BOB.id });
    const gate = new DefaultRecapShareGate({
      pool: w.pool,
      tripShareFacts: {
        roleOf: async () => 'member',
        tripName: async () => 'Spring',
        isMember: async () => true,
        summary: async () => null,
      },
    });
    expect(await gate.resolve(String(share.id), BOB.id)).toBeNull();
    await restore(w);
    expect(await gate.resolve(String(share.id), BOB.id)).toMatchObject({ sharerId: SUBJECT.id, tripAvailable: true });
  });
});
