/**
 * Feature: in-app-feedback, Requirements 2.3 to 2.6, 3.1, 6.1, 6.2, 7.1
 *
 * Real-SQL check of the feedback repo against local Postgres (the pg-mem suite in `repo.test.ts` cannot prove that the
 * parameter casts, the `CITEXT -> TEXT` email copy, the bounded `DELETE ... IN (SELECT ... LIMIT)` and the conditional
 * `UPDATE` run on the real planner). Skipped when no database answers on `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbPool } from '../../../db/pool.js';
import { createLiveTestDb, probeDatabase, type LiveTestDb } from '../../../test/liveDbTemplate.js';
import { createFeedbackRepo, type FeedbackRepo } from '../repo.js';

const DB_AVAILABLE = await probeDatabase();

describe.skipIf(!DB_AVAILABLE)('feedback repo (live Postgres)', () => {
  let liveDb: LiveTestDb;
  let pool: DbPool;
  let repo: FeedbackRepo;

  beforeAll(async () => {
    liveDb = await createLiveTestDb('dwt_feedback_repo', { maxConnections: 5 });
    pool = liveDb.pool as unknown as DbPool;
    repo = createFeedbackRepo(pool);
  }, 120_000);

  afterAll(async () => {
    await liveDb?.cleanup();
  });

  async function addUser(email: string, state = 'active'): Promise<string> {
    const id = randomUUID();
    if (state === 'active') {
      await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'h')`, [id, email]);
    } else {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, deletion_state, scheduled_purge_at, deletion_requested_at, placeholder_id)
         VALUES ($1, $2, 'h', $3, now() + interval '30 days', now(), $4)`,
        [id, email, state, randomUUID()],
      );
    }
    return id;
  }

  it('insert copies the account email only with consent, stores device info, and returns the id', async () => {
    const userId = await addUser('Mixed.Case@Example.com');
    const withConsent = await repo.insert({
      userId,
      kind: 'idea',
      message: 'dark mode please',
      contactOk: true,
      device: { appVersion: '1.4.0', platform: 'ios', osVersion: '17.5' },
    });
    const without = await repo.insert({ userId, kind: 'bug', message: 'crash', contactOk: false });
    expect(withConsent).toEqual(expect.any(String));
    expect(without).toEqual(expect.any(String));

    const a = await repo.get(withConsent!);
    expect(a).toMatchObject({
      userId,
      kind: 'idea',
      status: 'new',
      contactOk: true,
      appVersion: '1.4.0',
      platform: 'ios',
      osVersion: '17.5',
    });
    expect(a?.contactEmail?.toLowerCase()).toBe('mixed.case@example.com');

    const b = await repo.get(without!);
    expect(b).toMatchObject({ contactOk: false, contactEmail: null, appVersion: null, platform: null, osVersion: null });
  });

  it('insert stores nothing for a pending_deletion account and for an unknown user', async () => {
    const pending = await addUser('pending-live@example.com', 'pending_deletion');
    expect(await repo.insert({ userId: pending, kind: 'bug', message: 'x', contactOk: true })).toBeNull();
    expect(await repo.insert({ userId: randomUUID(), kind: 'bug', message: 'x', contactOk: false })).toBeNull();
    const res = await pool.query(`SELECT count(*)::int AS n FROM user_feedback WHERE user_id = $1`, [pending]);
    expect(res.rows[0]?.n).toBe(0);
  });

  it('countRecent counts the trailing hour and day for one user only', async () => {
    const me = await addUser('count-me@example.com');
    const other = await addUser('count-other@example.com');
    const now = new Date();
    const ago = (min: number): Date => new Date(now.getTime() - min * 60_000);
    for (const [u, min] of [
      [me, 5],
      [me, 59],
      [me, 120],
      [me, 24 * 60 + 5],
      [other, 1],
    ] as const) {
      await pool.query(
        `INSERT INTO user_feedback (user_id, kind, message, created_at) VALUES ($1, 'bug', 'm', $2)`,
        [u, ago(min)],
      );
    }
    const counts = await repo.countRecent(me, now);
    expect(counts).toEqual({ lastHour: 2, lastDay: 3 });
    expect(typeof counts.lastHour).toBe('number');
  });

  it('pruneResolved deletes only old resolved rows, honours the limit, and never touches new or triaged', async () => {
    const u = await addUser('prune-live@example.com');
    const now = new Date();
    const daysAgo = (d: number): Date => new Date(now.getTime() - d * 86_400_000);
    const seed = async (status: string, ageDays: number): Promise<string> => {
      const r = await pool.query<{ id: string }>(
        `INSERT INTO user_feedback (user_id, kind, message, status, status_changed_at)
         VALUES ($1, 'other', 'm', $2, $3) RETURNING id`,
        [u, status, daysAgo(ageDays)],
      );
      return r.rows[0]!.id;
    };
    const oldResolvedA = await seed('resolved', 200);
    const oldResolvedB = await seed('resolved', 120);
    const recentResolved = await seed('resolved', 10);
    const oldNew = await seed('new', 300);
    const oldTriaged = await seed('triaged', 300);

    const cutoff = new Date(now.getTime() - 90 * 86_400_000);
    expect(await repo.pruneResolved(cutoff, 1)).toBe(1);
    const afterOne = await pool.query(`SELECT id FROM user_feedback WHERE user_id = $1`, [u]);
    const idsAfterOne = new Set(afterOne.rows.map((r) => r.id as string));
    expect(idsAfterOne.has(oldResolvedA)).toBe(false); // oldest first
    expect(idsAfterOne.has(oldResolvedB)).toBe(true);

    expect(await repo.pruneResolved(cutoff, 200)).toBe(1);
    const left = await pool.query(`SELECT id FROM user_feedback WHERE user_id = $1`, [u]);
    expect(new Set(left.rows.map((r) => r.id as string))).toEqual(new Set([recentResolved, oldNew, oldTriaged]));
  });

  it('setStatus moves status_changed_at only on a real change; list filters and pages', async () => {
    const u = await addUser('admin-live@example.com');
    const id = (await repo.insert({ userId: u, kind: 'bug', message: 'first', contactOk: false }))!;
    const t1 = new Date('2026-11-10T10:00:00Z');
    const t2 = new Date('2026-11-10T11:00:00Z');
    expect(await repo.setStatus(id, 'triaged', t1)).toBe(true);
    expect((await repo.get(id))?.statusChangedAt.getTime()).toBe(t1.getTime());
    expect(await repo.setStatus(id, 'triaged', t2)).toBe(true);
    expect((await repo.get(id))?.statusChangedAt.getTime()).toBe(t1.getTime());
    expect(await repo.setStatus(randomUUID(), 'resolved', t2)).toBe(false);

    const triaged = await repo.list({ status: 'triaged', kind: 'bug', limit: 50, offset: 0 });
    expect(triaged.rows.map((r) => r.id)).toContain(id);
    expect(triaged.total).toBe(triaged.rows.length);
    expect(typeof triaged.total).toBe('number');

    expect(await repo.remove(id)).toBe(true);
    expect(await repo.get(id)).toBeNull();
  });

  it('deleting the user removes their feedback (ON DELETE CASCADE)', async () => {
    const u = await addUser('cascade-live@example.com');
    await repo.insert({ userId: u, kind: 'other', message: 'bye', contactOk: false });
    await pool.query(`DELETE FROM users WHERE id = $1`, [u]);
    const res = await pool.query(`SELECT count(*)::int AS n FROM user_feedback WHERE user_id = $1`, [u]);
    expect(res.rows[0]?.n).toBe(0);
  });
});
