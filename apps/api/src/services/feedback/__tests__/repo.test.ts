/**
 * Feedback repo against pg-mem with every migration applied (real SQL, real `users` table).
 *
 * Validates: Requirements 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 5.2, 5.3, 6.1, 6.2, 7.2
 */
import { randomUUID } from 'node:crypto';
import fc from 'fast-check';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FEEDBACK_KINDS } from '@dwt/shared';
import { buildMigratedDb, createSeeder, createTestPool, type Seeder, type TestPool } from '../../accountDeletion/__tests__/helpers.js';
import { createFeedbackRepo, type FeedbackRepo } from '../repo.js';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const minutesAgo = (m: number): Date => new Date(NOW.getTime() - m * 60_000);

describe('feedback repo (pg-mem)', () => {
  let test: TestPool;
  let seeder: Seeder;
  let repo: FeedbackRepo;
  let alice: string;
  let bob: string;

  async function addUser(email: string, deletionState = 'active'): Promise<string> {
    const id = randomUUID();
    // users_deletion_schedule_chk: a pending/purging account must carry its schedule and placeholder id.
    const schedule =
      deletionState === 'active'
        ? {}
        : { scheduled_purge_at: new Date('2026-12-01T00:00:00Z'), deletion_requested_at: NOW, placeholder_id: randomUUID() };
    await seeder.insertRow('users', { id, email, deletion_state: deletionState, ...schedule });
    return id;
  }

  async function seedFeedback(over: Record<string, unknown>): Promise<string> {
    const row = await seeder.insertRow('user_feedback', {
      kind: 'bug',
      message: 'seeded',
      contact_ok: false,
      ...over,
    });
    return row['id'] as string;
  }

  async function rows(): Promise<Record<string, unknown>[]> {
    const res = await test.pool.query(`SELECT * FROM user_feedback ORDER BY created_at, id`);
    return res.rows as Record<string, unknown>[];
  }

  beforeAll(() => {
    const db = buildMigratedDb();
    test = createTestPool(db);
    seeder = createSeeder(test.pool);
    repo = createFeedbackRepo(test.pool);
  });

  beforeEach(async () => {
    await test.pool.query(`DELETE FROM user_feedback`);
    await test.pool.query(`DELETE FROM users`);
    alice = await addUser('alice@example.com');
    bob = await addUser('bob@example.com');
  });

  describe('insert', () => {
    it('stores a row with status new, no email and no device by default', async () => {
      const id = await repo.insert({ userId: alice, kind: 'bug', message: 'It crashed', contactOk: false });
      expect(id).toEqual(expect.any(String));
      const [row] = await rows();
      expect(row).toMatchObject({
        id,
        user_id: alice,
        kind: 'bug',
        message: 'It crashed',
        status: 'new',
        contact_ok: false,
        contact_email: null,
        app_version: null,
        platform: null,
        os_version: null,
      });
    });

    // Feature: in-app-feedback, Property 3: Contact email is stored only with consent
    it('Property 3: contact_email equals the account email iff contactOk', async () => {
      await fc.assert(
        fc.asyncProperty(fc.boolean(), fc.constantFrom(...FEEDBACK_KINDS), async (contactOk, kind) => {
          await test.pool.query(`DELETE FROM user_feedback`);
          await repo.insert({ userId: alice, kind, message: 'm', contactOk });
          const [row] = await rows();
          expect(row?.['contact_ok']).toBe(contactOk);
          expect(row?.['contact_email']).toBe(contactOk ? 'alice@example.com' : null);
        }),
        { numRuns: 100 },
      );
    });

    // Feature: in-app-feedback, Property 4: Device info is all-or-nothing and never derived
    it('Property 4: the three device columns are all null or exactly the supplied values', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.option(
            fc.record({
              appVersion: fc.stringMatching(/^[0-9]{1,2}\.[0-9]{1,2}\.[0-9]{1,2}$/),
              platform: fc.constantFrom('ios', 'android', 'web'),
              osVersion: fc.stringMatching(/^[0-9]{1,2}(\.[0-9]{1,2})?$/),
            }),
            { nil: undefined },
          ),
          async (device) => {
            await test.pool.query(`DELETE FROM user_feedback`);
            await repo.insert({ userId: alice, kind: 'idea', message: 'm', contactOk: false, device });
            const [row] = await rows();
            if (device === undefined) {
              expect([row?.['app_version'], row?.['platform'], row?.['os_version']]).toEqual([null, null, null]);
            } else {
              expect([row?.['app_version'], row?.['platform'], row?.['os_version']]).toEqual([
                device.appVersion,
                device.platform,
                device.osVersion,
              ]);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('derives user_id from the argument and snapshots the email at submit time', async () => {
      await repo.insert({ userId: bob, kind: 'other', message: 'hello', contactOk: true });
      await test.pool.query(`UPDATE users SET email = 'bob-new@example.com' WHERE id = $1`, [bob]);
      const [row] = await rows();
      expect(row?.['user_id']).toBe(bob);
      expect(row?.['contact_email']).toBe('bob@example.com');
    });

    it('returns null and stores nothing for a pending_deletion account', async () => {
      const pending = await addUser('pending@example.com', 'pending_deletion');
      expect(await repo.insert({ userId: pending, kind: 'bug', message: 'x', contactOk: true })).toBeNull();
      expect(await rows()).toEqual([]);
    });

    it('returns null and stores nothing for an unknown user id', async () => {
      expect(await repo.insert({ userId: randomUUID(), kind: 'bug', message: 'x', contactOk: false })).toBeNull();
      expect(await rows()).toEqual([]);
    });
  });

  describe('countRecent', () => {
    it('counts the caller rows in the trailing hour and the trailing 24 hours, boundary inclusive', async () => {
      await seedFeedback({ user_id: alice, created_at: minutesAgo(0) });
      await seedFeedback({ user_id: alice, created_at: minutesAgo(60) }); // exactly one hour ago: inside
      await seedFeedback({ user_id: alice, created_at: minutesAgo(61) }); // inside the day, outside the hour
      await seedFeedback({ user_id: alice, created_at: minutesAgo(24 * 60) }); // exactly 24 h: inside
      await seedFeedback({ user_id: alice, created_at: minutesAgo(24 * 60 + 1) }); // outside both
      expect(await repo.countRecent(alice, NOW)).toEqual({ lastHour: 2, lastDay: 4 });
    });

    it('does not count another user rows', async () => {
      await seedFeedback({ user_id: bob, created_at: minutesAgo(1) });
      expect(await repo.countRecent(alice, NOW)).toEqual({ lastHour: 0, lastDay: 0 });
    });

    // Feature: in-app-feedback, Property 2: Cap counts only the caller's trailing window
    it('Property 2: matches a model over random users and ages', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.record({ who: fc.constantFrom('a', 'b'), ageMin: fc.integer({ min: 0, max: 3000 }) }), { maxLength: 12 }),
          async (items) => {
            await test.pool.query(`DELETE FROM user_feedback`);
            for (const it of items) {
              await seedFeedback({ user_id: it.who === 'a' ? alice : bob, created_at: minutesAgo(it.ageMin) });
            }
            const mine = items.filter((i) => i.who === 'a');
            expect(await repo.countRecent(alice, NOW)).toEqual({
              lastHour: mine.filter((i) => i.ageMin <= 60).length,
              lastDay: mine.filter((i) => i.ageMin <= 24 * 60).length,
            });
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('pruneResolved', () => {
    const cutoff = minutesAgo(90 * 24 * 60);

    // Feature: in-app-feedback, Property 6: Prune deletes only old resolved rows
    it('Property 6: deletes only resolved rows older than the cutoff, at most limit, oldest first', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              status: fc.constantFrom('new', 'triaged', 'resolved'),
              ageDays: fc.integer({ min: 0, max: 200 }),
            }),
            { maxLength: 10 },
          ),
          fc.integer({ min: 1, max: 6 }),
          async (items, limit) => {
            await test.pool.query(`DELETE FROM user_feedback`);
            const seeded: { id: string; status: string; ageDays: number }[] = [];
            for (const it of items) {
              const id = await seedFeedback({
                user_id: alice,
                status: it.status,
                status_changed_at: minutesAgo(it.ageDays * 24 * 60),
              });
              seeded.push({ id, ...it });
            }
            const eligible = seeded
              .filter((s) => s.status === 'resolved' && s.ageDays > 90)
              .sort((a, b) => b.ageDays - a.ageDays);
            const deleted = await repo.pruneResolved(cutoff, limit);
            expect(deleted).toBe(Math.min(limit, eligible.length));
            const remaining = new Set((await rows()).map((r) => r['id'] as string));
            for (const s of seeded) {
              if (s.status !== 'resolved') expect(remaining.has(s.id), `${s.status} kept`).toBe(true);
              if (s.status === 'resolved' && s.ageDays <= 90) expect(remaining.has(s.id), 'recent resolved kept').toBe(true);
            }
            const expectedGone = eligible.slice(0, limit).map((s) => s.id);
            for (const id of expectedGone) expect(remaining.has(id)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('admin reads and writes', () => {
    it('lists newest first with a filtered total, and pages', async () => {
      const oldest = await seedFeedback({ user_id: alice, created_at: minutesAgo(30), kind: 'idea' });
      const middle = await seedFeedback({ user_id: bob, created_at: minutesAgo(20), kind: 'bug', status: 'triaged' });
      const newest = await seedFeedback({ user_id: alice, created_at: minutesAgo(10), kind: 'bug' });

      const all = await repo.list({ limit: 50, offset: 0 });
      expect(all.total).toBe(3);
      expect(all.rows.map((r) => r.id)).toEqual([newest, middle, oldest]);

      const bugs = await repo.list({ kind: 'bug', limit: 50, offset: 0 });
      expect(bugs.total).toBe(2);

      const fresh = await repo.list({ status: 'new', limit: 50, offset: 0 });
      expect(fresh.rows.map((r) => r.id)).toEqual([newest, oldest]);

      const both = await repo.list({ status: 'new', kind: 'bug', limit: 50, offset: 0 });
      expect(both.rows.map((r) => r.id)).toEqual([newest]);

      const page2 = await repo.list({ limit: 1, offset: 1 });
      expect(page2.rows.map((r) => r.id)).toEqual([middle]);
      expect(page2.total).toBe(3);
    });

    it('get maps every column and returns null for an unknown id', async () => {
      const id = await seedFeedback({
        user_id: alice,
        message: 'full',
        contact_ok: true,
        contact_email: 'alice@example.com',
        app_version: '1.2.3',
        platform: 'ios',
        os_version: '17.5',
        created_at: minutesAgo(5),
      });
      const row = await repo.get(id);
      expect(row).toMatchObject({
        id,
        userId: alice,
        kind: 'bug',
        message: 'full',
        status: 'new',
        contactOk: true,
        contactEmail: 'alice@example.com',
        appVersion: '1.2.3',
        platform: 'ios',
        osVersion: '17.5',
      });
      expect(row?.createdAt.getTime()).toBe(minutesAgo(5).getTime());
      expect(await repo.get(randomUUID())).toBeNull();
    });

    it('setStatus updates the status and moves status_changed_at only when the status changes', async () => {
      const created = minutesAgo(100);
      const id = await seedFeedback({ user_id: alice, created_at: created, status_changed_at: created });
      expect(await repo.setStatus(id, 'resolved', NOW)).toBe(true);
      let row = await repo.get(id);
      expect(row?.status).toBe('resolved');
      expect(row?.statusChangedAt.getTime()).toBe(NOW.getTime());

      const later = new Date(NOW.getTime() + 3_600_000);
      expect(await repo.setStatus(id, 'resolved', later)).toBe(true);
      row = await repo.get(id);
      expect(row?.statusChangedAt.getTime()).toBe(NOW.getTime());

      expect(await repo.setStatus(randomUUID(), 'triaged', NOW)).toBe(false);
    });

    it('remove deletes one row and reports whether it existed', async () => {
      const id = await seedFeedback({ user_id: alice });
      const keep = await seedFeedback({ user_id: alice });
      expect(await repo.remove(id)).toBe(true);
      expect(await repo.remove(id)).toBe(false);
      expect((await rows()).map((r) => r['id'])).toEqual([keep]);
    });
  });
});
