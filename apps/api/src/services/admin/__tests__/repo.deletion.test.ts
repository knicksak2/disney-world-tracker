/**
 * Task 12.4: admin visibility of account deletion (account-deletion R5.7, R8.12, R15.5, R17.2, R17.3).
 * Admin is not "another user": a pending account is visible with its status, a tombstone never is, active-user
 * counts exclude every non-active row, and the purge ledger is reported only as per-UTC-day counts.
 */
import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BOB,
  CAROL,
  claimSubject,
  createWorld,
  DAVE,
  makePending,
  makePurging,
  SUBJECT,
  type World,
} from '../../accountDeletion/__tests__/visibility.harness.js';
import { createAdminRepo, type AdminRepo } from '../repo.js';
import { adminPoolShim, registerToChar } from './pgMemAdmin.js';

let w: World;
let repo: AdminRepo;

beforeEach(async () => {
  w = await createWorld();
  registerToChar(w.db);
  repo = createAdminRepo(adminPoolShim(w.pool), {} as never);
});

const ledger = async (purgedAt: string, outcome: 'completed' | 'completed_with_warnings' = 'completed'): Promise<void> => {
  await w.pool.query(`INSERT INTO account_deletion_ledger (requested_at, purged_at, outcome) VALUES ($1, $2, $3)`, [
    new Date('2026-01-01T00:00:00Z'),
    new Date(purgedAt),
    outcome,
  ]);
};

describe('findUserByEmail and userExists', () => {
  it('returns an active account with state active and no schedule', async () => {
    const user = await repo.findUserByEmail(BOB.email);
    expect(user).toMatchObject({
      id: BOB.id,
      email: BOB.email,
      deletionState: 'active',
      deletionRequestedAt: null,
      scheduledPurgeAt: null,
      purgeStage: 0,
      purgeAttempts: 0,
    });
  });

  it('returns a pending account with its status, request time, schedule, stage and attempts, and still its real email and name', async () => {
    await makePending(w, SUBJECT.id, {
      requestedAt: new Date('2026-04-01T12:00:00.000Z'),
      scheduledPurgeAt: new Date('2026-05-01T12:00:00.000Z'),
    });
    await w.pool.query(`UPDATE users SET purge_stage = 2, purge_attempts = 3 WHERE id = $1`, [SUBJECT.id]);
    const user = await repo.findUserByEmail(SUBJECT.email);
    expect(user).toMatchObject({
      id: SUBJECT.id,
      email: SUBJECT.email,
      displayName: SUBJECT.displayName,
      deletionState: 'pending_deletion',
      deletionRequestedAt: '2026-04-01T12:00:00.000Z',
      scheduledPurgeAt: '2026-05-01T12:00:00.000Z',
      purgeStage: 2,
      purgeAttempts: 3,
    });
  });

  it('answers not found for a tombstone address, and userExists is false for it', async () => {
    const claimed = await claimSubject(w);
    const tombstoneId = await w.repo.ensureTombstone(claimed);
    const email = String(((await w.pool.query(`SELECT email FROM users WHERE id = $1`, [tombstoneId])).rows[0] as { email: string }).email);
    expect(email).toMatch(/\.invalid$/);
    expect(await repo.findUserByEmail(email)).toBeNull();
    expect(await repo.userExists(tombstoneId)).toBe(false);
  });

  it('userExists is true for active, pending and purging accounts', async () => {
    await makePending(w, SUBJECT.id);
    await makePurging(w, DAVE.id);
    expect(await repo.userExists(BOB.id)).toBe(true);
    expect(await repo.userExists(SUBJECT.id)).toBe(true);
    expect(await repo.userExists(DAVE.id)).toBe(true);
    expect(await repo.userExists(randomUUID())).toBe(false);
  });
});

describe('growth', () => {
  it('counts only active users, reports pending separately, and lastPurgeAt is the newest ledger row (null when empty)', async () => {
    // BOB active; CAROL pending; DAVE purging; SUBJECT purged into a tombstone. (`claimSubject` claims every
    // due account, so it runs first and CAROL becomes pending afterwards.)
    const claimed = await claimSubject(w);
    await w.repo.ensureTombstone(claimed);
    await makePending(w, CAROL.id);
    await makePurging(w, DAVE.id);

    const empty = await repo.getGrowthTotals();
    expect(empty.totalUsers).toBe(1);
    expect(empty.pendingDeletionCount).toBe(1);
    expect(empty.lastPurgeAt).toBeNull();

    await ledger('2026-05-01T08:00:00.000Z');
    await ledger('2026-05-03T09:30:00.000Z');
    await ledger('2026-05-02T10:00:00.000Z');
    const totals = await repo.getGrowthTotals();
    expect(totals.lastPurgeAt).toBe('2026-05-03T09:30:00.000Z');
    expect(totals.totalUsers).toBe(1);
  });

  it('getDailyGrowth ignores a tombstone and counts pending signups on their signup day', async () => {
    await makePending(w, CAROL.id);
    const claimed = await claimSubject(w);
    await w.repo.ensureTombstone(claimed);
    // The tombstone is stamped long ago, and the four seeded people were created "now" by default.
    const daily = await repo.getDailyGrowth(7);
    expect(daily.reduce((s, d) => s + d.newUsers, 0)).toBe(4);
  });
});

describe('getPurgeLedgerDaily', () => {
  it('returns one zero-filled entry per UTC day, oldest first, bucketed by UTC day across midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); // only the clock: pg-mem needs real timers
    try {
      vi.setSystemTime(new Date('2026-05-10T12:00:00.000Z'));
      await ledger('2026-05-04T23:59:59.000Z'); // 05-04 (UTC)
      await ledger('2026-05-05T00:00:01.000Z'); // 05-05 (UTC): straddles midnight with the row above
      await ledger('2026-05-05T10:00:00.000Z');
      await ledger('2026-05-09T23:30:00.000Z', 'completed_with_warnings');
      await ledger('2026-05-03T23:59:59.000Z'); // before the 7-day window (starts 05-04)

      const days = await repo.getPurgeLedgerDaily(7);
      expect(days.map((d) => d.dayUtc)).toEqual([
        '2026-05-04', '2026-05-05', '2026-05-06', '2026-05-07', '2026-05-08', '2026-05-09', '2026-05-10',
      ]);
      expect(days.map((d) => d.count)).toEqual([1, 2, 0, 0, 0, 1, 0]);
      expect(Object.keys(days[0]!).sort()).toEqual(['count', 'dayUtc']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('defaults to seven days', async () => {
    expect(await repo.getPurgeLedgerDaily()).toHaveLength(7);
  });
});
