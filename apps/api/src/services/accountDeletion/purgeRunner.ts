/**
 * Purge runner: claims due accounts and runs the five purge stages for each, within a time budget
 * (design, "Purge procedure", "Run shape", "Stuck accounts").
 *
 *  - Single-flight `tryStart()`, the same shape as `photos/sweep.ts`. Work runs in-process; there is no queue,
 *    no worker and no Redis subscription (this file imports nothing from the job-queue library).
 *  - An idle pass is exactly two statements and no write: the recompute-queue read and a claim that matches nothing.
 *  - The budget is checked before the claim, between accounts, before every stage and before every chunk. On expiry
 *    the claim of anything unfinished is released and `purge_stage` stays at the number of completed stages.
 *  - One account's failure never stops the others: each runs in its own `try/catch`.
 *  - Logs identify an account only by `accountLogId`.
 *
 * Validates: Requirements 8.2, 8.3, 8.4, 8.5, 8.6, 8.9, 8.10, 8.11, 8.12, 8.13, 9.1, 9.7, 9.11, 12.5, 15.1
 */
import { PURGE_ATTEMPTS_ALERT } from './deletionState.js';
import { DISPOSITIONS, type DispositionEntry } from './dispositions.js';
import { accountLogId } from './logId.js';
import type { ClaimedAccount, Clock, PurgeRunnerDeps } from './ports.js';

export interface Budget {
  expired(): boolean;
}

/** `Date.now() - start >= timeBudgetMs`, on the injected clock so tests can expire it at a chosen statement. */
export function createBudget(timeBudgetMs: number, clock: Clock): Budget {
  const start = clock.now().getTime();
  return { expired: () => clock.now().getTime() - start >= timeBudgetMs };
}

export interface PurgeRunSummary {
  readonly claimed: number;
  readonly purged: number;
  /** Claims given back because the budget ran out (including accounts claimed but never started). */
  readonly released: number;
  /** Accounts with a thrown stage or `refs_remain` this run. */
  readonly failed: number;
  readonly fenced: number;
  readonly recomputed: number;
  readonly budgetExpired: boolean;
}

export interface PurgeRunner {
  tryStart(): { started: true } | { started: false; reason: 'in_flight' };
  runOnce(now?: Date): Promise<PurgeRunSummary>;
}

type StepResult = 'done' | 'budget' | 'fenced';
type AccountOutcome = 'purged' | 'budget' | 'fenced' | 'failed';

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : 'unknown';
}

const isAnonymizing = (e: DispositionEntry): boolean =>
  e.disposition === 'anonymize' || e.disposition === 'anonymize_then_delete';

export function createPurgeRunner(deps: PurgeRunnerDeps): PurgeRunner {
  const { repo, photos, tripPhotos, aggregate, lockout, clock, logger, logSecret, config } = deps;
  const scheduler = deps.scheduler ?? { run: (job: () => Promise<void>) => { void job(); } };
  let inFlight = false;

  /** Recompute-queue drain. Aggregate trouble must never block or fail a purge, so a throw is logged and swallowed. */
  async function drain(): Promise<number> {
    try {
      return await repo.drainRecomputeQueue(config.chunkRows, (id) => aggregate.recomputeFromScratch(id));
    } catch (err) {
      logger.warn({ event: 'account_deletion.purge.recompute_drain_failed', error: errorName(err) }, 'recompute drain failed');
      return 0;
    }
  }

  async function runAccount(c: ClaimedAccount, budget: Budget, at: () => Date): Promise<AccountOutcome> {
    const account = accountLogId(c.id, logSecret);
    let stage = 'photos';

    /** Repeats one chunk statement until it changes nothing; the budget is checked before every chunk. */
    async function chunkLoop(step: () => Promise<number>): Promise<'done' | 'budget'> {
      for (;;) {
        if (budget.expired()) return 'budget';
        if ((await step()) === 0) return 'done';
      }
    }

    // ---- stage 1: photos -----------------------------------------------------------------------------------
    async function stagePhotos(): Promise<StepResult> {
      for (;;) {
        if (budget.expired()) return 'budget';
        const ids = await photos.deleteAllForUser(c.id, { limit: config.chunkRows });
        // Counter-only and fenced: correct even if the budget stops the stage midway.
        if (ids.length > 0 && !(await repo.addCounters(c, { photosDeleted: ids.length }))) return 'fenced';
        if (ids.length < config.chunkRows) break;
      }
      return (await repo.advanceStage(c, 1)) ? 'done' : 'fenced';
    }

    // ---- stage 2: trips ------------------------------------------------------------------------------------
    async function stageTrips(): Promise<StepResult> {
      for (const tripId of await repo.listTripsOf(c.id)) {
        if (budget.expired()) return 'budget';
        const res = await repo.resolveTrip(c, tripId, {
          photoPort: tripPhotos,
          now: at(),
          ...(deps.afterTripLocked ? { afterTripLocked: deps.afterTripLocked } : {}),
        });
        if (res === 'fenced') return 'fenced';
      }
      return (await repo.advanceStage(c, 2)) ? 'done' : 'fenced';
    }

    // ---- stage 3: anonymize --------------------------------------------------------------------------------
    async function stageAnonymize(): Promise<StepResult> {
      const remaining = await repo.countRemainingReferences(c.id);
      const pending = DISPOSITIONS.filter(
        (e) => isAnonymizing(e) && remaining.some((r) => r.table === e.table && r.column === e.column),
      );
      if (pending.length > 0) {
        const tombstoneId = await repo.ensureTombstone(c);
        for (const entry of pending) {
          if ((await chunkLoop(() => repo.anonymizeChunk(c, entry, tombstoneId))) === 'budget') return 'budget';
        }
      }
      // The share scrub always runs. It selects by sender (the user OR the tombstone), so a run that crashed after
      // the re-point but before the scrub is repaired here even though no reference to the user remains.
      let cursor: string | null = null;
      for (;;) {
        if (budget.expired()) return 'budget';
        const page: { lastId: string | null } = await repo.scrubShares(c, c.placeholderId, cursor);
        if (page.lastId === null) break;
        cursor = page.lastId;
      }
      return (await repo.advanceStage(c, 3)) ? 'done' : 'fenced';
    }

    // ---- stage 4: personal data ----------------------------------------------------------------------------
    async function stagePersonalData(): Promise<StepResult> {
      // The rated experience ids are durable BEFORE the first `ratings` row is deleted.
      let cursor: string | null = null;
      for (;;) {
        if (budget.expired()) return 'budget';
        const page: { lastId: string | null } = await repo.enqueueRatedChunk(c.id, cursor);
        if (page.lastId === null) break;
        cursor = page.lastId;
      }
      for (const entry of DISPOSITIONS) {
        if (entry.disposition === 'anonymize' || entry.disposition === 'trip') continue;
        if ((await chunkLoop(() => repo.applyDeleteOrNullChunk(c, entry))) === 'budget') return 'budget';
      }
      // Best-effort Redis cleanup: a failure is a warning on the ledger, never a failed account (R9.11).
      try {
        await lockout.clearOnSuccess(c.id);
      } catch (err) {
        logger.warn({ event: 'account_deletion.purge.lockout_cleanup_failed', account, error: errorName(err) }, 'lockout cleanup failed');
        if (!(await repo.recordWarning(c))) return 'fenced';
      }
      return (await repo.advanceStage(c, 4)) ? 'done' : 'fenced';
    }

    /** Logs the alert once, exactly when the attempts reach the threshold. */
    function alertIfDue(attempts: number): void {
      if (attempts === PURGE_ATTEMPTS_ALERT) {
        logger.error({ event: 'account_deletion.purge.attempts_alert', account, attempts }, 'account purge keeps failing');
      }
    }

    try {
      const stages: readonly [number, string, () => Promise<StepResult>][] = [
        [0, 'photos', stagePhotos],
        [1, 'trips', stageTrips],
        [2, 'anonymize', stageAnonymize],
        [3, 'personal_data', stagePersonalData],
      ];
      for (const [firstRunsAt, name, run] of stages) {
        if (c.stage > firstRunsAt) continue; // already completed in an earlier run
        if (budget.expired()) return 'budget';
        stage = name;
        const res = await run();
        if (res === 'budget') return 'budget';
        if (res === 'fenced') {
          logger.info({ event: 'account_deletion.purge.fenced', account, stage }, 'claim lost, stopping');
          return 'fenced';
        }
      }

      if (budget.expired()) return 'budget';
      stage = 'finalize';
      const verdict = await repo.finalize(c, at());
      if (verdict === 'purged') return 'purged';
      if (verdict === 'fenced') {
        logger.info({ event: 'account_deletion.purge.fenced', account, stage }, 'claim lost, stopping');
        return 'fenced';
      }

      // refs_remain: a data-integrity signal. Names and counts only, never ids.
      let leftovers: readonly { table: string; column: string; count: number }[] = [];
      try {
        leftovers = await repo.countRemainingReferences(c.id);
      } catch {
        // the log is best-effort; the rewind below is what matters
      }
      logger.error({ event: 'account_deletion.purge.refs_remain', account, remaining: leftovers }, 'references remain, rewinding');
      if (!(await repo.rewindStage(c, 0))) return 'fenced';
      // Absolute write from the claim-time value: the stages just re-run would reset a relative counter to 0.
      const attempts = await repo.recordFailedAttempt(c, at(), c.attempts + 1);
      if (attempts === null) return 'fenced';
      alertIfDue(attempts);
      return 'failed';
    } catch (err) {
      let attempts: number | null | undefined;
      try {
        attempts = await repo.recordFailedAttempt(c, at());
      } catch (inner) {
        logger.warn({ event: 'account_deletion.purge.record_failed', account, error: errorName(inner) }, 'could not record the failed attempt');
      }
      logger.warn(
        { event: 'account_deletion.purge.stage_failed', account, stage, error: errorName(err), attempts: attempts ?? undefined },
        'purge stage failed',
      );
      if (attempts === null) return 'fenced';
      if (attempts !== undefined) alertIfDue(attempts);
      return 'failed';
    }
  }

  async function release(c: ClaimedAccount): Promise<void> {
    try {
      await repo.releaseClaim(c);
    } catch (err) {
      logger.warn({ event: 'account_deletion.purge.release_failed', account: accountLogId(c.id, logSecret), error: errorName(err) }, 'could not release a claim');
    }
  }

  async function runOnce(now?: Date): Promise<PurgeRunSummary> {
    const at = (): Date => now ?? clock.now();
    const budget = createBudget(config.timeBudgetMs, clock);

    // The drain precedes the claim so a crashed earlier run's recompute is repaired even when nothing is due.
    let recomputed = await drain();
    if (budget.expired()) {
      return { claimed: 0, purged: 0, released: 0, failed: 0, fenced: 0, recomputed, budgetExpired: true };
    }

    const claimed = await repo.claimDue(at(), config.batch);
    let purged = 0;
    let released = 0;
    let failed = 0;
    let fenced = 0;
    let stopped = false;

    for (const c of claimed) {
      if (stopped || budget.expired()) {
        stopped = true;
        await release(c);
        released += 1;
        continue;
      }
      const outcome = await runAccount(c, budget, at);
      if (outcome === 'purged') purged += 1;
      else if (outcome === 'failed') failed += 1;
      else if (outcome === 'fenced') fenced += 1;
      else {
        stopped = true;
        await release(c);
        released += 1;
        logger.info({ event: 'account_deletion.purge.budget', account: accountLogId(c.id, logSecret) }, 'time budget reached, claim released');
      }
    }

    // Only when something was claimed (an idle pass stays at two statements), and only inside the budget.
    if (claimed.length > 0 && !stopped && !budget.expired()) recomputed += await drain();

    return { claimed: claimed.length, purged, released, failed, fenced, recomputed, budgetExpired: stopped };
  }

  return {
    tryStart() {
      if (inFlight) return { started: false as const, reason: 'in_flight' as const };
      inFlight = true;
      scheduler.run(async () => {
        try {
          await runOnce();
        } catch (err) {
          logger.error({ event: 'account_deletion.purge.crashed', error: errorName(err) }, 'purge run crashed');
        } finally {
          inFlight = false;
        }
      });
      return { started: true as const };
    },
    runOnce,
  };
}
