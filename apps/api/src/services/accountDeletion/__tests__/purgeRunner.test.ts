/**
 * The real purge runner over pg-mem (real SQL, real repo): single-flight, the time budget at every boundary,
 * the idle pass, stuck accounts, the best-effort lockout cleanup and the structural "no job-queue library" rule.
 *
 * Feature: account-deletion, Property 14: Every purge stage is idempotent and resumable
 * Feature: account-deletion, Property 17: A purge run is bounded
 * Feature: account-deletion, Property 31: A permanently failing account cannot starve the purge queue
 * Feature: account-deletion, Property 33: The ledger outcome is decided before the row that carries it
 *
 * Validates: Requirements 8.2, 8.3, 8.4, 8.5, 8.6, 8.9, 8.10, 8.11, 8.12, 8.13, 9.1, 9.7, 9.11, 12.5, 15.1, 17.2, 17.10
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import { DISPOSITIONS } from '../dispositions.js';
import { accountLogId } from '../logId.js';
import type { AccountDeletionRepo, ClaimedAccount, LockoutPort } from '../ports.js';
import { createBudget, createPurgeRunner, type PurgeRunner } from '../purgeRunner.js';
import { createRecordingLogger, type Row } from './helpers.js';
import { photoDrivers } from './purgeDriver.js';
import { BOB, CAROL, createWorld, makePending, SUBJECT, userRow, type World } from './world.js';

const SECRET = 'test-session-secret-must-be-at-least-32-chars';
const RUN_AT = new Date('2026-05-02T09:00:00.000Z');
const BUDGET_MS = 25_000;
const CHUNK = 4;

// ---------------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------------

interface Hooks {
  before?: (method: string, args: unknown[]) => void | Promise<void>;
  after?: (method: string, args: unknown[], result: unknown) => void | Promise<void>;
}

/** Wraps every repo method so a test can observe calls, and act just before or just after one. */
function hooked(repo: AccountDeletionRepo, hooks: Hooks, log: string[]): AccountDeletionRepo {
  return new Proxy(repo, {
    get(target, prop) {
      const fn = (target as unknown as Record<string, unknown>)[prop as string];
      if (typeof fn !== 'function') return fn;
      return async (...args: unknown[]) => {
        log.push(String(prop));
        await hooks.before?.(String(prop), args);
        const result = await (fn as (...a: unknown[]) => Promise<unknown>)(...args);
        await hooks.after?.(String(prop), args, result);
        return result;
      };
    },
  });
}

interface HarnessOptions {
  hooks?: Hooks;
  batch?: number;
  lockoutThrows?: boolean;
  scheduler?: { run(job: () => Promise<void>): void };
}

function harness(w: World, opts: HarnessOptions = {}) {
  const { logger, calls } = createRecordingLogger();
  const clockState = { t: RUN_AT.getTime() };
  const clock = { now: () => new Date(clockState.t) };
  const recomputed: string[] = [];
  const lockoutCalls: string[] = [];
  const log: string[] = [];
  const lockout: LockoutPort = {
    isLocked: async () => false,
    recordFailure: async () => false,
    clearOnSuccess: async (id) => {
      lockoutCalls.push(id);
      if (opts.lockoutThrows) throw new Error('redis down');
    },
  };
  const drivers = photoDrivers(w);
  const repo = opts.hooks ? hooked(w.repo, opts.hooks, log) : hooked(w.repo, {}, log);
  const runner: PurgeRunner = createPurgeRunner({
    repo,
    photos: drivers.photos,
    tripPhotos: drivers.tripPhotos,
    aggregate: {
      recomputeFromScratch: async (id) => {
        recomputed.push(id);
      },
    },
    lockout,
    clock,
    logger,
    logSecret: SECRET,
    config: { batch: opts.batch ?? 10, timeBudgetMs: BUDGET_MS, chunkRows: CHUNK },
    ...(opts.scheduler ? { scheduler: opts.scheduler } : {}),
  });
  const expireBudget = (): void => {
    clockState.t += BUDGET_MS;
  };
  return { runner, calls, recomputed, lockoutCalls, log, expireBudget };
}

async function newWorld(): Promise<World> {
  return createWorld(CHUNK);
}

/** Subject data that needs several chunks in every unbounded table, a sole-member trip, a shared trip, a share. */
async function seedSmall(w: World): Promise<void> {
  const exps: string[] = [];
  for (let i = 0; i < 9; i++) exps.push(String((await w.seeder.insertRow('experiences')).id));
  for (const exp of exps) await w.seeder.insertRow('experience_favorites', { user_id: SUBJECT.id, experience_id: exp });
  for (const exp of exps.slice(0, 6)) await w.seeder.insertRow('ratings', { user_id: SUBJECT.id, experience_id: exp });
  for (let i = 0; i < 5; i++) {
    await w.seeder.insertRow('photos', { owner_id: SUBJECT.id, status: 'approved', harm_verdict: 'pass', vision_verdict: 'pass', full_etag: 'f', thumb_etag: 't' });
  }
  const sole = await w.seeder.insertRow('trips', { creator_id: SUBJECT.id });
  await w.seeder.insertRow('trip_memberships', { trip_id: sole.id, user_id: SUBJECT.id, role: 'organizer' });
  await w.seeder.insertRow('photos', { owner_id: SUBJECT.id, target_kind: 'trip', target_id: sole.id, scope_id: sole.id, status: 'approved', harm_verdict: 'pass', full_etag: 'f', thumb_etag: 't' });
  const shared = await w.seeder.insertRow('trips', { creator_id: BOB.id });
  await w.seeder.insertRow('trip_memberships', { trip_id: shared.id, user_id: BOB.id, role: 'organizer' });
  await w.seeder.insertRow('trip_memberships', { trip_id: shared.id, user_id: SUBJECT.id, role: 'member' });
  await addShare(w);
}

function addShare(w: World): Promise<Row> {
  return w.seeder.insertRow('shares', {
    sender_id: SUBJECT.id,
    payload_kind: 'pinShowcase',
    payload_snapshot: { kind: 'pinShowcase', ownerId: SUBJECT.id, ownerDisplayName: SUBJECT.displayName },
  });
}

const D = (iso: string): Date => new Date(iso);

async function count(w: World, table: string): Promise<number> {
  return w.db.public.getTable(table).find().length;
}

async function tableCounts(w: World): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of w.db.public.listTables()) {
    // The recompute queue depends on how far the drain got, which is not part of "the same final state".
    if (t.name === 'account_deletion_recompute_queue') continue;
    out[t.name] = t.find().length;
  }
  return out;
}

async function ledger(w: World): Promise<Row[]> {
  return (await w.pool.query(`SELECT * FROM account_deletion_ledger ORDER BY id`)).rows as Row[];
}

const EXEMPT: readonly ((sql: string) => boolean)[] = [
  (s) => /^DELETE FROM trips\b/.test(s),
  (s) => /^UPDATE photos\b[\s\S]*target_kind = \$1\s+AND target_id = \$2/.test(s),
  (s) => /^DELETE FROM users\b/.test(s),
];

// ===================================================================================================
describe('purgeRunner: single-flight (R8.2)', () => {
  it('a second tryStart while one is in flight answers in_flight; once it finishes a new one starts', async () => {
    const w = await newWorld();
    const jobs: (() => Promise<void>)[] = [];
    const { runner } = harness(w, { scheduler: { run: (job) => void jobs.push(job) } });

    expect(runner.tryStart()).toEqual({ started: true });
    expect(runner.tryStart()).toEqual({ started: false, reason: 'in_flight' });
    expect(runner.tryStart()).toEqual({ started: false, reason: 'in_flight' });
    expect(jobs).toHaveLength(1); // the overlapping calls scheduled nothing

    await jobs[0]!();
    expect(runner.tryStart()).toEqual({ started: true });
    expect(jobs).toHaveLength(2);
    await jobs[1]!();
  });

  it('a crashed run is logged by error name only and does not leave the runner stuck in flight', async () => {
    const w = await newWorld();
    const jobs: (() => Promise<void>)[] = [];
    const { runner, calls } = harness(w, {
      scheduler: { run: (job) => void jobs.push(job) },
      hooks: {
        before: (m) => {
          if (m === 'claimDue') throw new TypeError('boom with secret detail');
        },
      },
    });
    expect(runner.tryStart()).toEqual({ started: true });
    await jobs[0]!();
    const errors = calls.filter((c) => c.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.obj).toEqual({ event: 'account_deletion.purge.crashed', error: 'TypeError' });
    expect(JSON.stringify(calls)).not.toContain('secret detail');
    expect(runner.tryStart()).toEqual({ started: true }); // in-flight flag was reset
  });

  it('with the default scheduler the job runs in-process after tryStart returns', async () => {
    const w = await newWorld();
    await w.pool.query(`INSERT INTO account_deletion_recompute_queue (experience_id) VALUES ($1)`, [(await w.seeder.insertRow('experiences')).id]);
    const { runner, recomputed } = harness(w);
    expect(runner.tryStart()).toEqual({ started: true });
    await vi.waitFor(() => expect(recomputed).toHaveLength(1));
  });
});

// ===================================================================================================
describe('purgeRunner: the idle pass (R8.11d)', () => {
  it('with nothing due it issues exactly two statements (queue read, claim) and writes nothing', async () => {
    const w = await newWorld();
    await makePending(w, SUBJECT.id, { scheduledPurgeAt: D('2026-06-01T00:00:00.000Z') }); // pending, not yet due
    const { runner } = harness(w);
    w.resetStatements();

    const summary = await runner.runOnce();

    expect(summary).toEqual({ claimed: 0, purged: 0, released: 0, failed: 0, fenced: 0, recomputed: 0, budgetExpired: false });
    expect(w.statements).toHaveLength(2);
    expect(w.statements[0]!.text).toMatch(/^\s*SELECT experience_id FROM account_deletion_recompute_queue/);
    expect(w.statements[1]!.text).toMatch(/^\s*UPDATE users[\s\S]*FOR UPDATE SKIP LOCKED/);
    expect(w.statements[1]!.rowCount).toBe(0); // the claim matched nothing: no row was written
    expect((await userRow(w, SUBJECT.id))!.deletion_state).toBe('pending_deletion');
  });

  it('does not drain a second time when nothing was claimed, and a non-empty queue is the only thing that makes an idle pass write', async () => {
    const w = await newWorld();
    const exp = String((await w.seeder.insertRow('experiences')).id);
    await w.pool.query(`INSERT INTO account_deletion_recompute_queue (experience_id) VALUES ($1)`, [exp]);
    const { runner, recomputed } = harness(w);
    w.resetStatements();

    const summary = await runner.runOnce();

    expect(summary.recomputed).toBe(1);
    expect(recomputed).toEqual([exp]);
    // read, delete of the drained row, claim: and no second queue read after the (empty) claim.
    expect(w.statements.map((s) => s.text.trim().split(/\s+/).slice(0, 3).join(' '))).toEqual([
      'SELECT experience_id FROM',
      'DELETE FROM account_deletion_recompute_queue',
      'UPDATE users SET',
    ]);
  });
});

// ===================================================================================================
describe('purgeRunner: a full run (R8.4, R9.1)', () => {
  it('purges a due account through all five stages: the row is gone and one non-identifying ledger row exists', async () => {
    const w = await newWorld();
    await seedSmall(w);
    await makePending(w, SUBJECT.id);
    const h = harness(w);

    const summary = await h.runner.runOnce();

    expect(summary).toMatchObject({ claimed: 1, purged: 1, released: 0, failed: 0, fenced: 0, budgetExpired: false });
    expect(await userRow(w, SUBJECT.id)).toBeUndefined();
    const rows = await ledger(w);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'completed', trips_deleted: 1 });
    expect(Number(rows[0]!.photos_deleted)).toBe(6);
    // Redis cleanup ran once, for this account, after stage 3 and before stage 4 completed.
    expect(h.lockoutCalls).toEqual([SUBJECT.id]);
  });

  it('claims at most BATCH accounts per run; the rest wait for the next run', async () => {
    const w = await newWorld();
    for (const [i, p] of [SUBJECT, CAROL, BOB].entries()) {
      await makePending(w, p.id, { scheduledPurgeAt: new Date(D('2026-05-01T12:00:00.000Z').getTime() + i * 60_000) });
    }
    const h = harness(w, { batch: 2 });

    const first = await h.runner.runOnce();
    expect(first).toMatchObject({ claimed: 2, purged: 2 });
    expect((await userRow(w, BOB.id))!.deletion_state).toBe('pending_deletion');

    const second = await h.runner.runOnce();
    expect(second).toMatchObject({ claimed: 1, purged: 1 });
    expect(await userRow(w, BOB.id)).toBeUndefined();
  });

  it('the recompute queue holds every rated experience id before the first ratings row is deleted, and later runs drain it', async () => {
    const w = await newWorld();
    await seedSmall(w);
    await makePending(w, SUBJECT.id);
    const h = harness(w);
    w.resetStatements();

    const first = await h.runner.runOnce();

    const texts = w.statements.map((s) => s.text.trim());
    const lastEnqueue = texts.map((t, i) => (/^INSERT INTO account_deletion_recompute_queue/.test(t) ? i : -1)).filter((i) => i >= 0).pop()!;
    const firstRatingsDelete = texts.findIndex((t) => /^DELETE FROM ratings\b/.test(t));
    expect(lastEnqueue).toBeGreaterThanOrEqual(0);
    expect(firstRatingsDelete).toBeGreaterThan(lastEnqueue);
    expect(await count(w, 'ratings')).toBe(0);

    // 6 ids were queued; the post-run drain recomputes at most CHUNK of them, later runs finish the rest.
    expect(first.recomputed).toBe(CHUNK);
    const second = await h.runner.runOnce();
    expect(second.recomputed).toBe(6 - CHUNK);
    expect(new Set(h.recomputed).size).toBe(6);
    w.resetStatements();
    await h.runner.runOnce();
    expect(w.statements).toHaveLength(2); // drained: back to an idle pass
  });

  it('no statement touches more than CHUNK rows except exactly the three named ones (Property 17)', async () => {
    const w = await newWorld();
    await seedSmall(w);
    await makePending(w, SUBJECT.id);
    const h = harness(w);
    w.resetStatements();

    await h.runner.runOnce();

    for (const s of w.statements) {
      const sql = s.text.trim().replace(/\s+/g, ' ');
      if (EXEMPT.some((x) => x(sql))) continue;
      if (s.rowCount !== null) expect(s.rowCount, sql.slice(0, 120)).toBeLessThanOrEqual(CHUNK);
    }
    expect(w.statements.some((s) => /^DELETE FROM users\b/.test(s.text.trim()))).toBe(true);
  });
});

// ===================================================================================================
describe('purgeRunner: the time budget (Property 17)', () => {
  const BOUNDARIES = [1, 2, 3, 4] as const;

  it('createBudget expires exactly at timeBudgetMs on the injected clock', () => {
    let t = 1_000;
    const budget = createBudget(500, { now: () => new Date(t) });
    expect(budget.expired()).toBe(false);
    t = 1_499;
    expect(budget.expired()).toBe(false);
    t = 1_500;
    expect(budget.expired()).toBe(true);
  });

  it('(a) before the claim: nothing is claimed, nothing is written, the account stays pending', async () => {
    const w = await newWorld();
    await makePending(w, SUBJECT.id);
    const holder: { expire?: () => void } = {};
    const h = harness(w, { hooks: { after: (m) => { if (m === 'drainRecomputeQueue') holder.expire?.(); } } });
    holder.expire = h.expireBudget;

    const summary = await h.runner.runOnce();

    expect(summary).toEqual({ claimed: 0, purged: 0, released: 0, failed: 0, fenced: 0, recomputed: 0, budgetExpired: true });
    expect(h.log).toEqual(['drainRecomputeQueue']); // claimDue was never called
    expect((await userRow(w, SUBJECT.id))!.deletion_state).toBe('pending_deletion');
  });

  it('(b) between accounts: the finished account is purged, the unstarted one is released at stage 0', async () => {
    const w = await newWorld();
    await makePending(w, SUBJECT.id, { scheduledPurgeAt: D('2026-05-01T12:00:00.000Z') });
    await makePending(w, CAROL.id, { scheduledPurgeAt: D('2026-05-01T13:00:00.000Z') });
    const holder: { expire?: () => void } = {};
    const h = harness(w, { hooks: { after: (m, _a, r) => { if (m === 'finalize' && r === 'purged') holder.expire?.(); } } });
    holder.expire = h.expireBudget;

    const summary = await h.runner.runOnce();

    expect(summary).toMatchObject({ claimed: 2, purged: 1, released: 1, budgetExpired: true });
    expect(await userRow(w, SUBJECT.id)).toBeUndefined();
    const carol = (await userRow(w, CAROL.id))!;
    expect(carol).toMatchObject({ deletion_state: 'purging', purge_stage: 0, purge_claimed_at: null });

    const followUp = await harness(w).runner.runOnce();
    expect(followUp).toMatchObject({ claimed: 1, purged: 1 });
    expect(await userRow(w, CAROL.id)).toBeUndefined();
  });

  describe.each(BOUNDARIES)('(c) between stages: expiry right after stage %i completed', (n) => {
    it('purge_stage equals the completed-stage count, the claim is released, and a follow-up run reaches the same final state', async () => {
      // Baseline: the same data purged without interruption.
      const base = await newWorld();
      await seedSmall(base);
      await makePending(base, SUBJECT.id);
      await harness(base).runner.runOnce();
      const expected = await tableCounts(base);
      const expectedLedger = (await ledger(base)).map(({ id: _id, purged_at: _p, requested_at: _r, ...rest }) => rest);

      const w = await newWorld();
      await seedSmall(w);
      await makePending(w, SUBJECT.id);
      const holder: { expire?: () => void } = {};
      const h = harness(w, { hooks: { after: (m, a, r) => { if (m === 'advanceStage' && a[1] === n && r === true) holder.expire?.(); } } });
      holder.expire = h.expireBudget;

      const summary = await h.runner.runOnce();

      expect(summary).toMatchObject({ claimed: 1, purged: 0, released: 1, failed: 0, budgetExpired: true });
      const row = (await userRow(w, SUBJECT.id))!;
      expect(row).toMatchObject({ deletion_state: 'purging', purge_stage: n, purge_claimed_at: null, purge_attempts: 0 });
      if (n === 1) expect(Number(row.purge_photos_deleted)).toBe(6);

      const followUp = await harness(w).runner.runOnce();
      expect(followUp).toMatchObject({ claimed: 1, purged: 1 });
      expect(await tableCounts(w)).toEqual(expected);
      expect((await ledger(w)).map(({ id: _id, purged_at: _p, requested_at: _r, ...rest }) => rest)).toEqual(expectedLedger);
    });
  });

  it('(d) between chunks of one account: the stage is not advanced, rows remain, the claim is released, a follow-up finishes', async () => {
    const w = await newWorld();
    await seedSmall(w);
    await makePending(w, SUBJECT.id);
    let favoriteChunks = 0;
    const holder: { expire?: () => void } = {};
    const h = harness(w, {
      hooks: {
        after: (m, a, r) => {
          const entry = a[1] as { table?: string } | undefined;
          if (m === 'applyDeleteOrNullChunk' && entry?.table === 'experience_favorites' && Number(r) > 0) {
            favoriteChunks += 1;
            if (favoriteChunks === 2) holder.expire?.();
          }
        },
      },
    });
    holder.expire = h.expireBudget;

    const summary = await h.runner.runOnce();

    expect(summary).toMatchObject({ claimed: 1, purged: 0, released: 1, budgetExpired: true });
    expect(favoriteChunks).toBe(2);
    expect(await count(w, 'experience_favorites')).toBe(9 - 2 * CHUNK); // two chunks of 4 gone, one row left
    expect(await userRow(w, SUBJECT.id)).toMatchObject({ deletion_state: 'purging', purge_stage: 3, purge_claimed_at: null });

    const followUp = await harness(w).runner.runOnce();
    expect(followUp).toMatchObject({ purged: 1 });
    expect(await count(w, 'experience_favorites')).toBe(0);
  });

  // Feature: account-deletion, Property 17: A purge run is bounded
  // Feature: account-deletion, Property 14: Every purge stage is idempotent and resumable
  it('Property 17/14: a budget that expires after ANY repo call leaves a consistent state and a follow-up run reaches the unbounded final state', async () => {
    const seedWorld = async (): Promise<World> => {
      const w = await newWorld();
      await seedSmall(w);
      await makePending(w, SUBJECT.id, { scheduledPurgeAt: D('2026-05-01T12:00:00.000Z') });
      await makePending(w, CAROL.id, { scheduledPurgeAt: D('2026-05-01T13:00:00.000Z') });
      return w;
    };

    // Baseline: unbounded, counting repo calls so the cut point ranges over the whole run.
    const baseWorld = await seedWorld();
    let total = 0;
    await harness(baseWorld, { hooks: { after: () => { total += 1; } } }).runner.runOnce();
    const expected = await tableCounts(baseWorld);
    expect(total).toBeGreaterThan(30);

    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: total }), async (cut) => {
        const w = await seedWorld();
        const completed = new Map<string, number>(); // user id -> stages persisted, tracked from advanceStage
        let calls = 0;
        const holder: { expire?: () => void } = {};
        const h = harness(w, {
          hooks: {
            after: (m, a, r) => {
              calls += 1;
              if (m === 'advanceStage' && r === true) completed.set((a[0] as ClaimedAccount).id, a[1] as number);
              if (calls === cut) holder.expire?.();
            },
          },
        });
        holder.expire = h.expireBudget;

        const summary = await h.runner.runOnce();

        for (const id of [SUBJECT.id, CAROL.id]) {
          const row = await userRow(w, id);
          if (row === undefined) continue; // purged before the cut
          expect(['pending_deletion', 'purging']).toContain(row.deletion_state);
          if (row.deletion_state === 'purging') {
            expect(row.purge_claimed_at).toBeNull(); // every unfinished claim was released
            expect(Number(row.purge_stage)).toBe(completed.get(id) ?? 0); // stage = stages fully completed
          }
        }
        if (cut < total) expect(summary.failed).toBe(0);

        // Applying the stages again is harmless: rewind every account to stage 0, then finish unbounded.
        await w.pool.query(`UPDATE users SET purge_stage = 0 WHERE deletion_state = 'purging'`);
        await harness(w).runner.runOnce();
        expect(await tableCounts(w)).toEqual(expected);
      }),
      { numRuns: 100 },
    );
  }, 300_000);
});

// ===================================================================================================
describe('purgeRunner: stage 3 repair after a crash between the re-point and the scrub (Property 14)', () => {
  it('scrubs a share whose sender was already re-pointed to the tombstone, although no reference to the user remains', async () => {
    const w = await newWorld();
    const share = await addShare(w);
    const placeholderId = (await makePending(w, SUBJECT.id)).placeholderId;
    // The earlier run got as far as the re-point: tombstone exists, sender re-pointed, payload still names the person.
    const [claimed] = await w.repo.claimDue(RUN_AT, 10);
    await w.repo.ensureTombstone(claimed!);
    await w.pool.query(`UPDATE shares SET sender_id = $2 WHERE id = $1`, [share.id, placeholderId]);
    await w.repo.releaseClaim(claimed!);
    expect(await w.repo.countRemainingReferences(SUBJECT.id)).toEqual([]); // nothing names the user any more

    const summary = await harness(w).runner.runOnce();

    expect(summary).toMatchObject({ claimed: 1, purged: 1 });
    const stored = (await w.pool.query(`SELECT payload_snapshot FROM shares WHERE id = $1`, [share.id])).rows[0] as { payload_snapshot: unknown };
    const text = JSON.stringify(stored.payload_snapshot);
    expect(text).not.toContain(SUBJECT.id);
    expect(text).not.toContain(SUBJECT.displayName);
    expect(stored.payload_snapshot).toMatchObject({ ownerId: placeholderId, ownerDisplayName: 'Deleted user' });
  });
});

// ===================================================================================================
describe('purgeRunner: stuck accounts (Property 31, R8.12, R8.13)', () => {
  const ALERT = 'account_deletion.purge.attempts_alert';

  /** Inserts a share naming the subject after stage 4, so `finalize` finds a reference every run. */
  function leaveReference(w: World): Hooks {
    return { after: async (m, a) => { if (m === 'advanceStage' && a[1] === 4) await addShare(w); } };
  }

  it('five consecutive refs_remain runs give purge_attempts 1..5, stage 0, a released claim, and the alert error exactly once', async () => {
    const w = await newWorld();
    await makePending(w, SUBJECT.id);
    const h = harness(w, { hooks: leaveReference(w) });
    const account = accountLogId(SUBJECT.id, SECRET);

    for (let run = 1; run <= 5; run++) {
      const summary = await h.runner.runOnce();
      expect(summary).toMatchObject({ claimed: 1, purged: 0, failed: 1 });
      const row = (await userRow(w, SUBJECT.id))!;
      expect(row, `after run ${run}`).toMatchObject({ deletion_state: 'purging', purge_attempts: run, purge_stage: 0, purge_claimed_at: null });
      expect(row.purge_last_attempt_at).toBeInstanceOf(Date);
      const alerts = h.calls.filter((c) => c.level === 'error' && c.obj.event === ALERT);
      expect(alerts, `alert count after run ${run}`).toHaveLength(run >= 5 ? 1 : 0);
    }
    expect(h.calls.find((c) => c.obj.event === ALERT)!.obj).toEqual({ event: ALERT, account, attempts: 5 });

    // A sixth run does not log the alert again.
    await h.runner.runOnce();
    expect((await userRow(w, SUBJECT.id))!.purge_attempts).toBe(6);
    expect(h.calls.filter((c) => c.obj.event === ALERT)).toHaveLength(1);

    // The data-integrity error is logged every run, with table and column names and counts but no ids.
    const refs = h.calls.filter((c) => c.level === 'error' && c.obj.event === 'account_deletion.purge.refs_remain');
    expect(refs).toHaveLength(6);
    expect(refs[0]!.obj).toMatchObject({ account, remaining: [{ table: 'shares', column: 'sender_id', count: 1 }] });
    // No shared row was deleted while it kept failing: the bystander still exists.
    expect(await userRow(w, BOB.id)).toBeDefined();
  });

  it('a stage that throws increments attempts by exactly one, releases the claim, and keeps the completed stages', async () => {
    const w = await newWorld();
    await makePending(w, SUBJECT.id);
    const h = harness(w, { hooks: { before: (m) => { if (m === 'listTripsOf') throw new RangeError('db hiccup'); } } });

    const summary = await h.runner.runOnce();

    expect(summary).toMatchObject({ claimed: 1, purged: 0, failed: 1 });
    const row = (await userRow(w, SUBJECT.id))!;
    expect(row).toMatchObject({ deletion_state: 'purging', purge_stage: 1, purge_attempts: 1, purge_claimed_at: null });
    expect(row.purge_last_attempt_at).toBeInstanceOf(Date);
    const warn = h.calls.filter((c) => c.level === 'warn' && c.obj.event === 'account_deletion.purge.stage_failed');
    expect(warn).toHaveLength(1);
    expect(warn[0]!.obj).toEqual({ event: 'account_deletion.purge.stage_failed', account: accountLogId(SUBJECT.id, SECRET), stage: 'trips', error: 'RangeError', attempts: 1 });
    expect(h.calls.filter((c) => c.level === 'error')).toHaveLength(0);
  });

  it('a thrown stage five runs in a row logs the alert error once, on the fifth', async () => {
    const w = await newWorld();
    await makePending(w, SUBJECT.id);
    const h = harness(w, { hooks: { before: (m) => { if (m === 'listTripsOf') throw new Error('always'); } } });
    for (let run = 1; run <= 6; run++) {
      await h.runner.runOnce();
      expect((await userRow(w, SUBJECT.id))!.purge_attempts).toBe(run);
    }
    const alerts = h.calls.filter((c) => c.obj.event === ALERT);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.obj).toMatchObject({ attempts: 5 });
  });

  it('a failing account sorts behind a fresh one: with BATCH 1 the fresh account is purged first (Property 31)', async () => {
    const w = await newWorld();
    await makePending(w, SUBJECT.id, { scheduledPurgeAt: D('2026-05-01T08:00:00.000Z') }); // older request
    await makePending(w, CAROL.id, { scheduledPurgeAt: D('2026-05-01T09:00:00.000Z') });
    await w.pool.query(`UPDATE users SET deletion_state = 'purging', purge_attempts = 3 WHERE id = $1`, [SUBJECT.id]);
    const h = harness(w, { batch: 1 });

    await h.runner.runOnce();

    expect(await userRow(w, CAROL.id)).toBeUndefined(); // the fresh account went first
    expect(await userRow(w, SUBJECT.id)).toBeDefined();
  });

  it('a fenced-out account stops silently: no failure recorded, no warn or error', async () => {
    const w = await newWorld();
    await makePending(w, SUBJECT.id);
    const h = harness(w, {
      hooks: {
        // Another instance re-claims the account just before this run persists stage 1.
        before: async (m, a) => {
          if (m === 'advanceStage' && a[1] === 1) {
            await w.pool.query(`UPDATE users SET purge_claimed_at = $2 WHERE id = $1`, [SUBJECT.id, new Date('2026-05-02T09:00:30.000Z')]);
          }
        },
      },
    });

    const summary = await h.runner.runOnce();

    expect(summary).toMatchObject({ claimed: 1, purged: 0, failed: 0, fenced: 1, released: 0 });
    expect(await userRow(w, SUBJECT.id)).toMatchObject({ purge_attempts: 0, purge_stage: 0 });
    expect(h.calls.filter((c) => c.level !== 'info')).toHaveLength(0);
    expect(h.calls.filter((c) => c.level === 'info')[0]!.obj).toMatchObject({ event: 'account_deletion.purge.fenced', stage: 'photos' });
  });

  it('a failure while recording the attempt is logged and does not take the run down', async () => {
    const w = await newWorld();
    await makePending(w, SUBJECT.id);
    await makePending(w, CAROL.id, { scheduledPurgeAt: D('2026-05-01T13:00:00.000Z') });
    const h = harness(w, {
      hooks: {
        before: (m, a) => {
          if (m === 'listTripsOf' && (a[0] as string) === SUBJECT.id) throw new Error('stage down');
          if (m === 'recordFailedAttempt') throw new Error('record down');
        },
      },
    });

    const summary = await h.runner.runOnce();

    expect(summary).toMatchObject({ claimed: 2, failed: 1, purged: 1 }); // CAROL still purged
    expect(h.calls.some((c) => c.obj.event === 'account_deletion.purge.record_failed')).toBe(true);
  });
});

// ===================================================================================================
describe('purgeRunner: best-effort lockout cleanup (Property 33, R9.11)', () => {
  it('a clearOnSuccess that throws still purges the account; the ledger says completed_with_warnings', async () => {
    const w = await newWorld();
    await makePending(w, SUBJECT.id);
    const h = harness(w, { lockoutThrows: true });

    const summary = await h.runner.runOnce();

    expect(summary).toMatchObject({ purged: 1, failed: 0 });
    expect(await userRow(w, SUBJECT.id)).toBeUndefined();
    const rows = await ledger(w);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBe('completed_with_warnings');
    expect(Object.keys(rows[0]!).sort()).toEqual(['id', 'outcome', 'photos_deleted', 'purged_at', 'requested_at', 'trips_deleted', 'trips_transferred']);
    const warn = h.calls.filter((c) => c.obj.event === 'account_deletion.purge.lockout_cleanup_failed');
    expect(warn).toHaveLength(1);
    expect(warn[0]!.level).toBe('warn');
    expect(warn[0]!.obj).toEqual({ event: 'account_deletion.purge.lockout_cleanup_failed', account: accountLogId(SUBJECT.id, SECRET), error: 'Error' });
  });

  it('a clearOnSuccess that works leaves the outcome completed, and it ran after stage 3 and before stage 4 was recorded', async () => {
    const w = await newWorld();
    await makePending(w, SUBJECT.id);
    const stageAtCleanup: number[] = [];
    const { logger } = createRecordingLogger();
    const drivers = photoDrivers(w);
    const runner = createPurgeRunner({
      repo: w.repo,
      photos: drivers.photos,
      tripPhotos: drivers.tripPhotos,
      aggregate: { recomputeFromScratch: async () => {} },
      lockout: {
        isLocked: async () => false,
        recordFailure: async () => false,
        clearOnSuccess: async () => {
          stageAtCleanup.push(Number((await userRow(w, SUBJECT.id))!.purge_stage));
        },
      },
      clock: { now: () => RUN_AT },
      logger,
      logSecret: SECRET,
      config: { batch: 10, timeBudgetMs: BUDGET_MS, chunkRows: CHUNK },
    });

    await runner.runOnce();

    expect(stageAtCleanup).toEqual([3]);
    expect((await ledger(w))[0]!.outcome).toBe('completed');
  });

  // Feature: account-deletion, Property 33: The ledger outcome is decided before the row that carries it
  it('Property 33: for any mix of cleanup failures across accounts the outcome is completed_with_warnings iff that account cleanup threw', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.boolean(), { minLength: 1, maxLength: 3 }), async (throwsFor) => {
        const w = await newWorld();
        const people = [SUBJECT, CAROL, BOB].slice(0, throwsFor.length);
        const throwing = new Set(people.filter((_, i) => throwsFor[i]).map((p) => p.id));
        for (const [i, p] of people.entries()) {
          await makePending(w, p.id, { scheduledPurgeAt: new Date(D('2026-05-01T12:00:00.000Z').getTime() + i * 60_000) });
        }
        const drivers = photoDrivers(w);
        const runner = createPurgeRunner({
          repo: w.repo,
          photos: drivers.photos,
          tripPhotos: drivers.tripPhotos,
          aggregate: { recomputeFromScratch: async () => {} },
          lockout: {
            isLocked: async () => false,
            recordFailure: async () => false,
            clearOnSuccess: async (id) => {
              if (throwing.has(id)) throw new Error('redis down');
            },
          },
          clock: { now: () => RUN_AT },
          logger: createRecordingLogger().logger,
          logSecret: SECRET,
          config: { batch: 10, timeBudgetMs: BUDGET_MS, chunkRows: CHUNK },
        });

        const summary = await runner.runOnce();

        expect(summary.purged).toBe(people.length);
        const outcomes = (await ledger(w)).map((r) => String(r.outcome));
        expect(outcomes.filter((o) => o === 'completed_with_warnings')).toHaveLength(throwing.size);
        expect(outcomes.filter((o) => o === 'completed')).toHaveLength(people.length - throwing.size);
      }),
      { numRuns: 100 },
    );
  }, 300_000);
});

// ===================================================================================================
describe('purgeRunner: logs identify an account only by its keyed hash (Property 22, R15.1)', () => {
  it('across a failing and a purging run no log carries the user id, email, name or placeholder id', async () => {
    const w = await newWorld();
    await makePending(w, SUBJECT.id);
    const failing = harness(w, { hooks: { before: (m) => { if (m === 'listTripsOf') throw new Error('x'); } } });
    await failing.runner.runOnce();
    const ok = harness(w, { lockoutThrows: true });
    await ok.runner.runOnce();

    const text = JSON.stringify([...failing.calls, ...ok.calls]);
    expect(text).toContain(accountLogId(SUBJECT.id, SECRET));
    for (const secret of [SUBJECT.id, SUBJECT.email, SUBJECT.displayName, `deadc0de-${SUBJECT.id.slice(9)}`]) {
      expect(text).not.toContain(secret);
    }
  });
});

// ===================================================================================================
describe('purgeRunner: structure (R8.2, R8.9)', () => {
  const source = readFileSync(resolve(__dirname, '../purgeRunner.ts'), 'utf8');

  it('imports nothing from the job-queue library or a Redis client', () => {
    const specifiers = [
      ...source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm),
      ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
      ...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((m) => m[1]!);
    expect(specifiers.length).toBeGreaterThan(0); // the scan found the real imports
    expect(specifiers.every((s) => s.startsWith('./'))).toBe(true);
    for (const s of specifiers) expect(s).not.toMatch(/bullmq|ioredis|redis|upstash/i);
  });

  it('starts no Worker, Queue or Redis subscription', () => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bnew\s+(Worker|Queue|QueueEvents|Redis)\b/);
    expect(code).not.toMatch(/\.p?subscribe\s*\(/);
    expect(code).not.toMatch(/setInterval\s*\(/);
  });

  it('the registry the runner walks is the real one (a new row is picked up without editing the runner)', () => {
    expect(DISPOSITIONS.length).toBeGreaterThan(60);
    expect(source).toContain('DISPOSITIONS');
  });
});
