/**
 * Repo tests (pg-mem, real SQL) for the purge claim, the fencing predicate and the stuck-account counters.
 *
 * Feature: account-deletion, Property 16: A claim has exactly one winner
 * Feature: account-deletion, Property 31: A permanently failing account cannot starve the purge queue
 *
 * pg-mem is single-connection, so true concurrent locking is Postgres's behaviour and is not exercised;
 * mutual exclusion is asserted by the sequential-claim tests and by a statement-text assertion that the
 * claim is one `UPDATE ... RETURNING` carrying `FOR UPDATE SKIP LOCKED`.
 *
 * Validates: Requirements 4.5, 8.3, 8.5, 8.11, 8.12, 8.13, 17.4
 */
import { randomUUID } from 'node:crypto';

import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';

import { orderForClaim, PURGE_STALE_CLAIM_MS } from '../deletionState.js';
import type { ClaimedAccount } from '../ports.js';
import type { Row } from './helpers.js';
import { BOB, CAROL, claimSubject, createWorld, DAVE, makePending, SUBJECT, userRow, type World } from './world.js';

const T0 = new Date('2026-05-02T09:00:00.000Z');
const PLACEHOLDER_OF = (id: string): string => `deadc0de-${id.slice(9)}`;

/** Every purge_* column plus the lifecycle columns: what a fenced-out write must leave untouched. */
async function purgeColumns(w: World, id: string): Promise<string> {
  const r = (await userRow(w, id))!;
  const keys = Object.keys(r).filter((k) => k.startsWith('purge_') || k === 'deletion_state');
  return JSON.stringify(Object.fromEntries(keys.map((k) => [k, r[k]])));
}

describe('accountDeletion repo: claim and fencing (pg-mem)', () => {
  let w: World;

  beforeEach(async () => {
    w = await createWorld();
  });

  // -------------------------------------------------------------------------------------------
  // The claim statement
  // -------------------------------------------------------------------------------------------
  describe('claimDue (Property 16)', () => {
    it('is one UPDATE ... RETURNING statement that carries FOR UPDATE SKIP LOCKED and passes dates as parameters', async () => {
      await makePending(w, SUBJECT.id);
      w.resetStatements();
      await w.repo.claimDue(T0, 10);

      expect(w.statements).toHaveLength(1);
      const sql = w.statements[0]!.text;
      expect(sql.trim()).toMatch(/^UPDATE users/);
      expect(sql).toContain('FOR UPDATE SKIP LOCKED');
      expect(sql).toMatch(/RETURNING/);
      expect(sql).toContain('ORDER BY purge_attempts ASC, scheduled_purge_at ASC, id ASC');
      const [nowParam, staleParam, limitParam] = w.statements[0]!.params as [Date, Date, number];
      expect(nowParam.toISOString()).toBe(T0.toISOString());
      expect(staleParam.toISOString()).toBe(new Date(T0.getTime() - PURGE_STALE_CLAIM_MS).toISOString());
      expect(limitParam).toBe(10);
    });

    it('claims a due pending account: purging state, fencing token = now, stage 0, and returns the resume facts', async () => {
      const { requestedAt, placeholderId } = await makePending(w, SUBJECT.id);
      const claimed = await w.repo.claimDue(T0, 10);

      expect(claimed).toHaveLength(1);
      const c = claimed[0]!;
      expect(c.id).toBe(SUBJECT.id);
      expect(c.placeholderId).toBe(placeholderId);
      expect(c.deletionRequestedAt.toISOString()).toBe(requestedAt.toISOString());
      expect(c.claimedAt.toISOString()).toBe(T0.toISOString());
      expect(c.stage).toBe(0);
      expect(c.attempts).toBe(0);

      const row = (await userRow(w, SUBJECT.id))!;
      expect(row.deletion_state).toBe('purging');
      expect(new Date(row.purge_claimed_at as Date).toISOString()).toBe(T0.toISOString());
      expect(row.purge_stage).toBe(0);
    });

    it('a sequential second claim returns nothing for an account that is already claimed', async () => {
      await makePending(w, SUBJECT.id);
      expect(await w.repo.claimDue(T0, 10)).toHaveLength(1);
      expect(await w.repo.claimDue(T0, 10)).toEqual([]);
      expect(await w.repo.claimDue(new Date(T0.getTime() + 1000), 10)).toEqual([]);
    });

    it('does not claim before scheduled_purge_at, claims at it (<=), and never claims active or tombstone accounts', async () => {
      const { scheduledPurgeAt } = await makePending(w, SUBJECT.id);
      expect(await w.repo.claimDue(new Date(scheduledPurgeAt.getTime() - 1), 10)).toEqual([]);
      expect((await userRow(w, SUBJECT.id))!.deletion_state).toBe('pending_deletion');

      const claimed = await w.repo.claimDue(scheduledPurgeAt, 10);
      expect(claimed.map((c) => c.id)).toEqual([SUBJECT.id]);
      // BOB, CAROL and DAVE are active and were never candidates.
      for (const p of [BOB, CAROL, DAVE]) expect((await userRow(w, p.id))!.deletion_state).toBe('active');
    });

    it('a released claim is re-claimable immediately and keeps purge_stage', async () => {
      const c = await claimSubject(w);
      expect(await w.repo.advanceStage(c, 2)).toBe(true);
      expect(await w.repo.releaseClaim(c)).toBe(true);
      expect((await userRow(w, SUBJECT.id))!.purge_claimed_at).toBeNull();

      const again = await w.repo.claimDue(new Date(T0.getTime() + 1), 10);
      expect(again).toHaveLength(1);
      expect(again[0]!.stage).toBe(2);
      expect(again[0]!.claimedAt.getTime()).toBe(T0.getTime() + 1);
      expect((await userRow(w, SUBJECT.id))!.purge_stage).toBe(2);
    });

    it('a held claim is stale only at 15 minutes: one millisecond earlier it cannot be re-claimed, then it can, keeping the stage', async () => {
      const c = await claimSubject(w);
      await w.repo.advanceStage(c, 3);

      expect(await w.repo.claimDue(new Date(T0.getTime() + PURGE_STALE_CLAIM_MS - 1), 10)).toEqual([]);
      const reclaimed = await w.repo.claimDue(new Date(T0.getTime() + PURGE_STALE_CLAIM_MS), 10);
      expect(reclaimed).toHaveLength(1);
      expect(reclaimed[0]!.stage).toBe(3);
      expect(reclaimed[0]!.claimedAt.getTime()).toBe(T0.getTime() + PURGE_STALE_CLAIM_MS);
    });

    it('rejects a non-positive or fractional batch limit', async () => {
      await expect(w.repo.claimDue(T0, 0)).rejects.toThrow(RangeError);
      await expect(w.repo.claimDue(T0, 1.5)).rejects.toThrow(RangeError);
    });

    it('restore versus claim has exactly one winner, whichever commits first', async () => {
      const { scheduledPurgeAt } = await makePending(w, SUBJECT.id);
      const justBefore = new Date(scheduledPurgeAt.getTime() - 1);

      // Restore first: the claim then finds no due account.
      const restoreFirst = await w.repo.restore(SUBJECT.id, justBefore);
      const claimAfter = await w.repo.claimDue(scheduledPurgeAt, 10);
      expect([restoreFirst.restored, claimAfter.length === 1].filter(Boolean)).toHaveLength(1);
      expect(restoreFirst.restored).toBe(true);
      expect((await userRow(w, SUBJECT.id))!.deletion_state).toBe('active');

      // Claim first (the claim's clock is ahead of the restore's): the restore then matches nothing.
      await makePending(w, SUBJECT.id, { scheduledPurgeAt });
      const claimFirst = await w.repo.claimDue(scheduledPurgeAt, 10);
      const restoreAfter = await w.repo.restore(SUBJECT.id, justBefore);
      expect([restoreAfter.restored, claimFirst.length === 1].filter(Boolean)).toHaveLength(1);
      expect(claimFirst).toHaveLength(1);
      expect(restoreAfter.restored).toBe(false);
      expect((await userRow(w, SUBJECT.id))!.deletion_state).toBe('purging');
    });
  });

  // -------------------------------------------------------------------------------------------
  // Fencing: every write carries the claim predicate
  // -------------------------------------------------------------------------------------------
  describe('fencing (Property 16, Property 14)', () => {
    /** Re-claims the subject so the first claim `c` is stale. */
    async function supersede(c: ClaimedAccount): Promise<ClaimedAccount> {
      const later = new Date(c.claimedAt.getTime() + PURGE_STALE_CLAIM_MS);
      const [fresh] = await w.repo.claimDue(later, 10);
      return fresh!;
    }

    it('every stage, counter, release and failure write with a stale claim reports fenced and changes nothing', async () => {
      const stale = await claimSubject(w);
      const current = await supersede(stale);
      expect(current.claimedAt.getTime()).not.toBe(stale.claimedAt.getTime());
      const before = JSON.stringify(await userRow(w, SUBJECT.id));

      expect(await w.repo.advanceStage(stale, 1, { photosDeleted: 3 })).toBe(false);
      expect(await w.repo.addCounters(stale, { tripsDeleted: 1 })).toBe(false);
      expect(await w.repo.rewindStage(stale, 0)).toBe(false);
      expect(await w.repo.recordFailedAttempt(stale, T0)).toBeNull();
      expect(await w.repo.recordFailedAttempt(stale, T0, 4)).toBeNull();
      expect(await w.repo.recordWarning(stale)).toBe(false);
      expect(await w.repo.releaseClaim(stale)).toBe(false);

      expect(JSON.stringify(await userRow(w, SUBJECT.id))).toBe(before);
      // The current holder is still fully able to write.
      expect(await w.repo.advanceStage(current, 1)).toBe(true);
    });

    it('a write after the claim was released, and one after the account was restored or purged, is fenced', async () => {
      const c = await claimSubject(w);
      expect(await w.repo.releaseClaim(c)).toBe(true);
      // purge_claimed_at is NULL now: the equality predicate matches nothing.
      expect(await w.repo.advanceStage(c, 1)).toBe(false);
      expect(await w.repo.releaseClaim(c)).toBe(false);
      expect(await w.repo.recordFailedAttempt(c, T0)).toBeNull();
    });

    it('is fenced when the account is not purging at all (a pending account has no claim)', async () => {
      await makePending(w, SUBJECT.id);
      const ghost: ClaimedAccount = {
        id: SUBJECT.id,
        placeholderId: PLACEHOLDER_OF(SUBJECT.id),
        deletionRequestedAt: T0,
        claimedAt: T0,
        stage: 0,
        attempts: 0,
      };
      const before = await purgeColumns(w, SUBJECT.id);
      expect(await w.repo.advanceStage(ghost, 1)).toBe(false);
      expect(await w.repo.addCounters(ghost, { photosDeleted: 1 })).toBe(false);
      expect(await w.repo.recordWarning(ghost)).toBe(false);
      expect(await purgeColumns(w, SUBJECT.id)).toBe(before);
    });

    it('every fenced statement text carries the claim predicate', async () => {
      const c = await claimSubject(w);
      w.resetStatements();
      await w.repo.advanceStage(c, 1, { photosDeleted: 1 });
      await w.repo.addCounters(c, { tripsTransferred: 1 });
      await w.repo.rewindStage(c, 0);
      await w.repo.recordFailedAttempt(c, T0);
      await w.repo.recordWarning(c);
      await w.repo.releaseClaim(c);
      // recordFailedAttempt already released the claim, so the later writes above it ran fenced-out; the
      // point here is the statement text of each.
      expect(w.statements).toHaveLength(6);
      for (const s of w.statements) {
        expect(s.text).toContain(`deletion_state = 'purging'`);
        expect(s.text).toContain('purge_claimed_at = $2');
        expect(s.params[1]).toBeInstanceOf(Date);
      }
    });
  });

  // -------------------------------------------------------------------------------------------
  // Stage and counter writes (Property 31, R8.12)
  // -------------------------------------------------------------------------------------------
  describe('advanceStage / addCounters / rewindStage', () => {
    it('advanceStage sets the stage, adds counter deltas and resets purge_attempts to 0', async () => {
      const c = await claimSubject(w);
      await w.pool.query(`UPDATE users SET purge_attempts = 3 WHERE id = $1`, [SUBJECT.id]);

      expect(await w.repo.advanceStage(c, 2, { tripsDeleted: 2, tripsTransferred: 1, photosDeleted: 7 })).toBe(true);
      expect(await w.repo.advanceStage(c, 3, { photosDeleted: 1 })).toBe(true);

      const row = (await userRow(w, SUBJECT.id))!;
      expect(row.purge_stage).toBe(3);
      expect(row.purge_attempts).toBe(0);
      expect(row.purge_trips_deleted).toBe(2);
      expect(row.purge_trips_transferred).toBe(1);
      expect(row.purge_photos_deleted).toBe(8);
    });

    it('addCounters adds to the counters and changes neither purge_stage nor purge_attempts', async () => {
      const c = await claimSubject(w);
      await w.repo.advanceStage(c, 1);
      await w.pool.query(`UPDATE users SET purge_attempts = 2 WHERE id = $1`, [SUBJECT.id]);

      expect(await w.repo.addCounters(c, { photosDeleted: 5 })).toBe(true);
      expect(await w.repo.addCounters(c, { photosDeleted: 4 })).toBe(true);
      // An empty delta still runs fenced and reports success while the claim is ours.
      expect(await w.repo.addCounters(c, {})).toBe(true);

      const row = (await userRow(w, SUBJECT.id))!;
      expect(row.purge_photos_deleted).toBe(9);
      expect(row.purge_stage).toBe(1);
      expect(row.purge_attempts).toBe(2);
    });

    it('rejects a negative or fractional counter delta and an out-of-range stage', async () => {
      const c = await claimSubject(w);
      await expect(w.repo.addCounters(c, { photosDeleted: -1 })).rejects.toThrow(RangeError);
      await expect(w.repo.addCounters(c, { photosDeleted: 1.5 })).rejects.toThrow(RangeError);
      await expect(w.repo.advanceStage(c, 5)).rejects.toThrow(RangeError);
      await expect(w.repo.advanceStage(c, -1)).rejects.toThrow(RangeError);
    });

    it('rewindStage sets purge_stage to 0 and nothing else', async () => {
      const c = await claimSubject(w);
      await w.repo.advanceStage(c, 4, { photosDeleted: 2 });
      await w.pool.query(`UPDATE users SET purge_attempts = 1 WHERE id = $1`, [SUBJECT.id]);

      expect(await w.repo.rewindStage(c, 0)).toBe(true);
      const row = (await userRow(w, SUBJECT.id))!;
      expect(row.purge_stage).toBe(0);
      expect(row.purge_attempts).toBe(1);
      expect(row.purge_photos_deleted).toBe(2);
      expect(new Date(row.purge_claimed_at as Date).toISOString()).toBe(T0.toISOString());
    });

    it('a budget stop (releaseClaim) leaves purge_attempts and purge_stage unchanged', async () => {
      const c = await claimSubject(w);
      await w.repo.advanceStage(c, 2);
      await w.pool.query(`UPDATE users SET purge_attempts = 2 WHERE id = $1`, [SUBJECT.id]);

      expect(await w.repo.releaseClaim(c)).toBe(true);
      const row = (await userRow(w, SUBJECT.id))!;
      expect(row.purge_attempts).toBe(2);
      expect(row.purge_stage).toBe(2);
      expect(row.purge_claimed_at).toBeNull();
      expect(row.deletion_state).toBe('purging');
    });
  });

  describe('recordFailedAttempt and recordWarning (Property 31, R8.12, R8.13)', () => {
    it('a thrown stage: +1 relative to the stored value, purge_last_attempt_at set, claim released, new count returned', async () => {
      const c = await claimSubject(w);
      const failedAt = new Date('2026-05-02T09:00:30.000Z');

      expect(await w.repo.recordFailedAttempt(c, failedAt)).toBe(1);
      let row = (await userRow(w, SUBJECT.id))!;
      expect(row.purge_attempts).toBe(1);
      expect(new Date(row.purge_last_attempt_at as Date).toISOString()).toBe(failedAt.toISOString());
      expect(row.purge_claimed_at).toBeNull();
      expect(row.deletion_state).toBe('purging'); // still purging: eligible for the next run

      // Re-claim and fail again: relative to the stored value, so 2.
      const [again] = await w.repo.claimDue(new Date(T0.getTime() + 60_000), 10);
      expect(again!.attempts).toBe(1);
      expect(await w.repo.recordFailedAttempt(again!, failedAt)).toBe(2);
      row = (await userRow(w, SUBJECT.id))!;
      expect(row.purge_attempts).toBe(2);
    });

    it('saturates at 32767 for the relative and the absolute write', async () => {
      let c = await claimSubject(w);
      await w.pool.query(`UPDATE users SET purge_attempts = 32767 WHERE id = $1`, [SUBJECT.id]);
      expect(await w.repo.recordFailedAttempt(c, T0)).toBe(32767);

      [c] = (await w.repo.claimDue(new Date(T0.getTime() + 60_000), 10)) as [ClaimedAccount];
      expect(await w.repo.recordFailedAttempt(c, T0, 40000)).toBe(32767);
      expect((await userRow(w, SUBJECT.id))!.purge_attempts).toBe(32767);
    });

    it('the absolute write sets attempts to the given value regardless of what the stage writes did to the column', async () => {
      // The refs_remain accumulation: claim read attempts = 2, stages 1..4 completed (advanceStage resets the
      // column to 0), finalize said refs_remain: rewind, then write claim-time attempts + 1 absolutely.
      let c = await claimSubject(w);
      await w.pool.query(`UPDATE users SET purge_attempts = 2 WHERE id = $1`, [SUBJECT.id]);
      await w.repo.releaseClaim(c);
      [c] = (await w.repo.claimDue(new Date(T0.getTime() + 1000), 10)) as [ClaimedAccount];
      expect(c.attempts).toBe(2);

      for (let stage = 1; stage <= 4; stage++) await w.repo.advanceStage(c, stage);
      expect((await userRow(w, SUBJECT.id))!.purge_attempts).toBe(0); // the reset that defeated a relative write
      expect(await w.repo.rewindStage(c, 0)).toBe(true);

      expect(await w.repo.recordFailedAttempt(c, T0, c.attempts + 1)).toBe(3);
      const row = (await userRow(w, SUBJECT.id))!;
      expect(row.purge_attempts).toBe(3);
      expect(row.purge_stage).toBe(0);
      expect(row.purge_claimed_at).toBeNull();
    });

    it('rejects a negative or fractional absolute attempts value', async () => {
      const c = await claimSubject(w);
      await expect(w.repo.recordFailedAttempt(c, T0, -1)).rejects.toThrow(RangeError);
      await expect(w.repo.recordFailedAttempt(c, T0, 1.5)).rejects.toThrow(RangeError);
    });

    it('recordWarning increments purge_warnings under the claim and changes nothing else', async () => {
      const c = await claimSubject(w);
      const before = (await userRow(w, SUBJECT.id))!;
      expect(await w.repo.recordWarning(c)).toBe(true);
      expect(await w.repo.recordWarning(c)).toBe(true);
      const after = (await userRow(w, SUBJECT.id))!;
      expect(after.purge_warnings).toBe(2);
      const changed = Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
      expect(changed).toEqual(['purge_warnings']);
    });
  });

  // -------------------------------------------------------------------------------------------
  // Property 31: claim order and starvation
  // -------------------------------------------------------------------------------------------
  describe('claim order (Property 31)', () => {
    async function insertPending(attempts: number, scheduledPurgeAt: Date, state: 'pending_deletion' | 'purging' = 'pending_deletion'): Promise<string> {
      const id = randomUUID();
      await w.pool.query(
        `INSERT INTO users (id, email, password_hash, deletion_state, deletion_requested_at, scheduled_purge_at, placeholder_id, purge_attempts, purge_claimed_at)
         VALUES ($1, $2, 'h', $3, $4, $5, $6, $7, NULL)`,
        [id, `${id}@example.com`, state, new Date(scheduledPurgeAt.getTime() - 86_400_000), scheduledPurgeAt, PLACEHOLDER_OF(id), attempts],
      );
      return id;
    }

    it('a fresh account is claimed ahead of BATCH accounts that already failed three times, even though it is newer', async () => {
      const BATCH = 3;
      const failing: string[] = [];
      for (let i = 0; i < BATCH; i++) failing.push(await insertPending(3, new Date(`2026-04-0${i + 1}T00:00:00Z`), 'purging'));
      const fresh = await insertPending(0, new Date('2026-05-01T00:00:00Z'));

      const claimed = await w.repo.claimDue(T0, BATCH);
      expect(claimed).toHaveLength(BATCH);
      expect(claimed[0]!.id).toBe(fresh);
      expect(claimed.slice(1).map((c) => c.id)).toEqual(failing.slice(0, BATCH - 1)); // oldest request first among equals
      // The third failing account was left unclaimed this run.
      expect((await userRow(w, failing[BATCH - 1]!))!.purge_claimed_at).toBeNull();
    });

    it('the fresh account is purged within two runs even when BATCH accounts always fail', async () => {
      const BATCH = 2;
      const failing: string[] = [];
      for (let i = 0; i < BATCH; i++) failing.push(await insertPending(0, new Date(`2026-04-0${i + 1}T00:00:00Z`)));
      const fresh = await insertPending(0, new Date('2026-05-01T00:00:00Z'));

      const seenFresh: boolean[] = [];
      for (let run = 0; run < 2; run++) {
        const now = new Date(T0.getTime() + run * 60_000);
        const claimed = await w.repo.claimDue(now, BATCH);
        seenFresh.push(claimed.some((c) => c.id === fresh));
        for (const c of claimed) {
          if (c.id === fresh) await w.repo.releaseClaim(c); // stands in for "processed"
          else await w.repo.recordFailedAttempt(c, now); // always throws
        }
      }
      expect(seenFresh).toContain(true);
      expect(seenFresh[0] === true || seenFresh[1] === true).toBe(true);
    });

    // Feature: account-deletion, Property 31: the claim returns at most BATCH accounts in (purge_attempts, scheduled_purge_at, id) order
    it('property: the SQL claim returns the first BATCH accounts in orderForClaim order', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              attempts: fc.integer({ min: 0, max: 6 }),
              dayOffset: fc.integer({ min: 0, max: 4 }),
            }),
            { minLength: 1, maxLength: 8 },
          ),
          fc.integer({ min: 1, max: 5 }),
          async (specs, batch) => {
            const fresh = await createWorld();
            const pool = fresh.pool;
            const accounts: { attempts: number; scheduledPurgeAt: Date; id: string }[] = [];
            for (const s of specs) {
              const id = randomUUID();
              const scheduledPurgeAt = new Date(Date.UTC(2026, 3, 1 + s.dayOffset));
              await pool.query(
                `INSERT INTO users (id, email, password_hash, deletion_state, deletion_requested_at, scheduled_purge_at, placeholder_id, purge_attempts)
                 VALUES ($1, $2, 'h', 'pending_deletion', $3, $4, $5, $6)`,
                [id, `${id}@example.com`, new Date(scheduledPurgeAt.getTime() - 86_400_000), scheduledPurgeAt, PLACEHOLDER_OF(id), s.attempts],
              );
              accounts.push({ attempts: s.attempts, scheduledPurgeAt, id });
            }
            const expected = [...accounts].sort(orderForClaim).slice(0, batch).map((a) => a.id);
            const claimed = await fresh.repo.claimDue(T0, batch);
            expect(claimed.length).toBe(Math.min(batch, accounts.length));
            expect(claimed.map((c) => c.id)).toEqual(expected);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  it('keeps every other user\'s purge columns untouched by a claim', async () => {
    await makePending(w, SUBJECT.id);
    const bobBefore = JSON.stringify((await userRow(w, BOB.id)) as Row);
    await w.repo.claimDue(T0, 10);
    expect(JSON.stringify(await userRow(w, BOB.id))).toBe(bobBefore);
  });
});
