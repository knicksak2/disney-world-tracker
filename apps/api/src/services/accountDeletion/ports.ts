/**
 * Structural ports and shared types for the account-deletion service (design, "Ports",
 * "Repo surface" and "Supporting types and helpers"). Types only: no runtime code, so a test can
 * substitute a fake for every dependency and nothing here reaches for `process.env` or a clock.
 *
 * It also holds the service/runner dependency bags (`AccountDeletionServiceDeps`, `PurgeRunnerDeps`), `LoggerPort`
 * and `Scheduler` (design, "Factories and dependencies"). `Budget`, `PurgeRunSummary` and `PurgeRunner` live next to
 * the runner in `purgeRunner.ts`.
 */
import type { PoolClient } from 'pg';

import type { DispositionEntry } from './dispositions.js';

// ---------------------------------------------------------------------------
// Ports consumed by the repo and, later, the service and runner
// ---------------------------------------------------------------------------

export interface PhotoDeletionPort {
  /**
   * Satisfied by `PhotoService.deleteAllForUser` (optional `{ limit }`, additive) and, when photos are
   * disabled, by `photosRepo.softDeleteByOwner(userId, now, undefined, limit)`. Marks at most `limit`
   * non-deleted photos `deleted` and returns their ids; the runner repeats until fewer than `limit` come back.
   */
  deleteAllForUser(userId: string, opts?: { limit?: number }): Promise<readonly string[]>;
}

export interface TripPurgePhotoPort {
  /**
   * Satisfied in `composeServices.ts` by
   * `(tripId, now, client) => createPhotosRepo(pool).softDeleteByTarget('trip', tripId, now, client)`.
   * It takes the purge transaction's client so the photo soft-delete commits or rolls back with
   * `DELETE FROM trips`.
   */
  softDeleteTripPhotos(tripId: string, now: Date, client: PoolClient): Promise<readonly string[]>;
}

export interface AggregatePort {
  recomputeFromScratch(experienceId: string): Promise<unknown>;
}

export interface LockoutPort {
  isLocked(userId: string): Promise<boolean>;
  recordFailure(userId: string, now?: number): Promise<boolean>;
  clearOnSuccess(userId: string): Promise<void>;
}

export interface AccountDeletionMail {
  sendDeletionScheduled(input: { to: string; scheduledPurgeAt: Date; graceDays: number }): Promise<void>;
  sendDeletionCancelled(input: { to: string }): Promise<void>;
}

export interface AccountRestorePort {
  /** Login path: one conditional UPDATE (its own statement), then the best-effort "deletion cancelled" email. */
  restore(userId: string, now: Date): Promise<'restored' | 'not_restorable'>;
  /**
   * Reset path (R4.11): the same conditional UPDATE on the RESET transaction's client, so the restore, the
   * password change and the code consumption commit or roll back together. Sends no mail.
   */
  restoreInTx(client: PoolClient, userId: string, now: Date): Promise<'restored' | 'not_needed' | 'not_restorable'>;
  /** Reset path, called AFTER the reset transaction committed with 'restored': the best-effort email. */
  notifyRestored(userId: string): Promise<void>;
}

export interface PasswordVerifier {
  verify(hash: string, plain: string): Promise<boolean>;
}

export interface Clock {
  now(): Date;
}

/**
 * The only logging seam. A pino Logger (`createLogger()`), a Fastify logger and a recording fake all satisfy it
 * structurally. The first argument is always an object; callers put only `account` (the `accountLogId`), `stage`,
 * `attempts`, error names and counts in it, never an id, email, password or grant (Property 22).
 */
export interface LoggerPort {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

/** Mirrors `photos/ports.ts`; declared here so this service imports nothing from another service folder. */
export interface Scheduler {
  run(job: () => Promise<void>): void;
}

// ---------------------------------------------------------------------------
// Purge types
// ---------------------------------------------------------------------------

/**
 * Returned by `claimDue`. `claimedAt` is the fencing token: the exact JS Date passed as `$1` to the claim
 * (Postgres TIMESTAMPTZ keeps microseconds, a JS Date has milliseconds, so the value round-trips exactly
 * because the application chose it). Every fenced statement compares `purge_claimed_at = $claimedAt`.
 */
export interface ClaimedAccount {
  /** `users.id`. Never logged; log `accountLogId(id, secret)`. */
  readonly id: string;
  /** `users.placeholder_id`; becomes the tombstone id in `ensureTombstone`. */
  readonly placeholderId: string;
  /** Becomes `account_deletion_ledger.requested_at`. */
  readonly deletionRequestedAt: Date;
  /** Fencing token. */
  readonly claimedAt: Date;
  /** `purge_stage` at claim time, 0..4 (completed stages). */
  readonly stage: number;
  /** `purge_attempts` at claim time. */
  readonly attempts: number;
}

/** Maps to `purge_trips_transferred`, `purge_trips_deleted`, `purge_photos_deleted`. */
export interface PurgeCounters {
  tripsTransferred: number;
  tripsDeleted: number;
  photosDeleted: number;
}

export interface TripResolveDeps {
  readonly photoPort: TripPurgePhotoPort;
  readonly now: Date;
  /** Test seam only: awaited right after the trips row is locked (step 1). Never set by composeServices.ts. */
  readonly afterTripLocked?: (client: PoolClient) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Service and runner dependency bags
// ---------------------------------------------------------------------------

export interface AccountDeletionServiceDeps {
  readonly repo: AccountDeletionRepo;
  readonly lockout: LockoutPort;
  readonly mail: AccountDeletionMail;
  /** `auth/password.ts` `verify`. */
  readonly verify: PasswordVerifier['verify'];
  readonly clock: Clock;
  readonly logger: LoggerPort;
  /** `config.accountDeletion`. */
  readonly config: { readonly graceDays: number; readonly reauthWindowSeconds: number };
  /** `config.session.secret`, the HMAC key of `accountLogId`. */
  readonly logSecret: string;
  /** Test seam; default `generatePlaceholderId(() => randomBytes(16))`. */
  readonly newPlaceholderId?: () => string;
}

export interface ReauthResult {
  readonly reauthGrant: string;
  readonly expiresAt: Date;
  readonly graceDays: number;
}

export interface DeletionRequestResult {
  readonly status: 'pending_deletion';
  readonly scheduledPurgeAt: Date;
  readonly graceDays: number;
}

export interface AccountDeletionService extends AccountRestorePort {
  /**
   * Throws AppError `account_locked` (423, before any password work) or `reauth_failed` (403, after one
   * `recordFailure`). Never calls `clearOnSuccess` (R2.13). A lockout or Redis error propagates and answers
   * `internal_error` (fails closed).
   */
  reauth(userId: string, sessionId: string, password: string): Promise<ReauthResult>;
  /**
   * Throws AppError `account_deletion_confirmation_invalid` (400; checked first, before the repo, so the grant is
   * not consumed) or `reauth_required` (403; the repo outcome is `reauth_required` or `not_active`). A repo failure
   * propagates (the transaction rolled back). A mail failure is caught and logged at `warn` without the recipient.
   */
  requestDeletion(
    userId: string,
    sessionId: string,
    grant: string,
    confirmation: string,
  ): Promise<DeletionRequestResult>;
  /**
   * Session-less web deletion (`POST /account-deletion`, R19.4–R19.9):
   * 1. Validates `confirmation.trim() === DELETE_ACCOUNT_CONFIRMATION_PHRASE` (`account_deletion_confirmation_invalid`, 400).
   * 2. Looks up the active user by email (`repo.findActiveUserByEmail`). If none, throws `reauth_failed` (403) without lockout or password work.
   * 3. Checks `lockout.isLocked(user.id)` (`account_locked`, 423) before password work.
   * 4. Verifies password (`verify`). On mismatch, calls `lockout.recordFailure(user.id)` once and throws `reauth_failed` (403). Never calls `clearOnSuccess`.
   * 5. Calls `repo.requestDeletionForUser` and sends the best-effort scheduled email (`mail.sendDeletionScheduled`).
   */
  requestDeletionByPassword(
    email: string,
    password: string,
    confirmation: string,
  ): Promise<DeletionRequestResult>;
  /** Configured grace period in days (`ACCOUNT_DELETION_GRACE_DAYS`, default 30). */
  getGraceDays(): number;
}

export interface PurgeRunnerDeps {
  readonly repo: AccountDeletionRepo;
  readonly photos: PhotoDeletionPort;
  /** Becomes `TripResolveDeps.photoPort`. */
  readonly tripPhotos: TripPurgePhotoPort;
  readonly aggregate: AggregatePort;
  /**
   * End-of-stage-4 `clearOnSuccess` cleanup (R9.11). BEST-EFFORT: a Redis failure is caught, logged at `warn` and
   * counted with `recordWarning` (the ledger then reads `completed_with_warnings`); it never fails the account
   * (design review round 5, NIT 2).
   */
  readonly lockout: LockoutPort;
  /** The budget (`createBudget`) and every `now` the runner passes. */
  readonly clock: Clock;
  readonly logger: LoggerPort;
  /** `accountLogId` key. */
  readonly logSecret: string;
  readonly config: { readonly batch: number; readonly timeBudgetMs: number; readonly chunkRows: number };
  /** Default `{ run: (job) => { void job(); } }`, as `createSweepRunner`. */
  readonly scheduler?: Scheduler;
  /** Test seam only, forwarded into `TripResolveDeps`; never set by `composeServices.ts`. */
  readonly afterTripLocked?: (client: PoolClient) => Promise<void>;
}

// ---------------------------------------------------------------------------
// The repo
// ---------------------------------------------------------------------------

export type DeletionRequestOutcome =
  | { outcome: 'ok'; email: string }
  | { outcome: 'reauth_required' }
  | { outcome: 'not_active' };

export interface AccountDeletionRepo {
  // ---- request / restore -------------------------------------------------------------------------------
  /**
   * One transaction: consume the grant (bound to user and session, unexpired), flip `active` to
   * `pending_deletion`, revoke every session (including the caller's), expire unused reset tokens, delete
   * `push_registrations`. A grant that does not match yields `reauth_required`; an account that is not `active`
   * yields `not_active`; in both cases nothing is changed (the grant stays unconsumed).
   */
  consumeGrantAndRequestDeletion(args: {
    userId: string;
    sessionId: string;
    grantHash: string;
    now: Date;
    scheduledPurgeAt: Date;
    placeholderId: string;
  }): Promise<DeletionRequestOutcome>;
  /**
   * Looks up an `active` user by email (`deletion_state = 'active'`). Returns `null` for unknown or
   * non-active (`pending_deletion`, `purging`, `tombstone`) accounts.
   */
  findActiveUserByEmail(email: string): Promise<{ id: string; email: string; passwordHash: string } | null>;
  /**
   * One transaction (web deletion path, after password verification): transitions `active` -> `pending_deletion`,
   * revokes all sessions, expires unused password-reset tokens, and deletes `push_registrations`.
   */
  requestDeletionForUser(args: {
    userId: string;
    now: Date;
    scheduledPurgeAt: Date;
    placeholderId: string;
  }): Promise<{ outcome: 'ok'; email: string } | { outcome: 'not_active' }>;
  /** One transaction: prune expired grants, then replace-on-issue by session. The only pruner. */
  issueGrant(args: { userId: string; sessionId: string; grantHash: string; expiresAt: Date; now: Date }): Promise<void>;
  /** Login path restore: one conditional UPDATE (`pending_deletion` and `now < scheduled_purge_at`). */
  restore(userId: string, now: Date): Promise<{ restored: boolean; email: string | null }>;
  /** The same conditional UPDATE on a caller-supplied transaction client. Never sends mail. */
  restoreInTx(client: PoolClient, userId: string, now: Date): Promise<'restored' | 'not_needed' | 'not_restorable'>;
  getPasswordHash(userId: string): Promise<string | null>;
  /** `SELECT email FROM users WHERE id = $1`; never logged. */
  getEmail(userId: string): Promise<string | null>;

  // ---- purge: claim and fencing ------------------------------------------------------------------------
  /** The single claim statement (R8.11a), results in claim order (`purge_attempts`, `scheduled_purge_at`, `id`). */
  claimDue(now: Date, limit: number): Promise<readonly ClaimedAccount[]>;
  /** Fenced. Sets `purge_claimed_at = NULL`. false = fenced out (harmless). */
  releaseClaim(c: ClaimedAccount): Promise<boolean>;
  /** Fenced. Sets `purge_stage = completed`, resets `purge_attempts` to 0, adds `deltas` to the counters. */
  advanceStage(c: ClaimedAccount, completed: number, deltas?: Partial<PurgeCounters>): Promise<boolean>;
  /** Fenced. Adds `deltas` to the counters and changes NOTHING else (not `purge_stage`, not `purge_attempts`). */
  addCounters(c: ClaimedAccount, deltas: Partial<PurgeCounters>): Promise<boolean>;
  /** Fenced. The only code that moves `purge_stage` backwards; the runner calls it with 0 after `refs_remain`. */
  rewindStage(c: ClaimedAccount, stage: 0): Promise<boolean>;
  /**
   * Fenced. Sets `purge_last_attempt_at`, releases the claim and writes the attempts: relative
   * (`LEAST(purge_attempts + 1, 32767)`) when `absoluteAttempts` is omitted, absolute
   * (`LEAST(absoluteAttempts, 32767)`) when given. Returns the new count, or null when fenced out.
   */
  recordFailedAttempt(c: ClaimedAccount, now: Date, absoluteAttempts?: number): Promise<number | null>;
  /** Fenced. `purge_warnings + 1` (saturating); called when the best-effort Redis cleanup throws. */
  recordWarning(c: ClaimedAccount): Promise<boolean>;

  // ---- purge: stages -----------------------------------------------------------------------------------
  /** Trips the user is a member of, UNION trips they created. */
  listTripsOf(userId: string): Promise<readonly string[]>;
  resolveTrip(
    c: ClaimedAccount,
    tripId: string,
    deps: TripResolveDeps,
  ): Promise<'deleted' | 'transferred' | 'unchanged' | 'fenced'>;
  /** Inserts the tombstone `users` + `profiles` rows (ON CONFLICT DO NOTHING). Returns the placeholder id. */
  ensureTombstone(c: ClaimedAccount): Promise<string>;
  /**
   * One chunk (at most `chunkRows` rows) of one registry entry's anonymize statement. For
   * `anonymize_then_delete` entries only the rows matching `retainWhere` are re-pointed (and `blank` columns nulled).
   */
  anonymizeChunk(c: ClaimedAccount, entry: DispositionEntry, tombstoneId: string): Promise<number>;
  /**
   * One keyset chunk of the share-payload scrub (pinShowcase and tripSummary shares sent by the user or the
   * tombstone). Pass the previous `lastId` as `afterId`; `lastId = null` means the page was empty (done).
   */
  scrubShares(
    c: ClaimedAccount,
    tombstoneId: string,
    afterId?: string | null,
  ): Promise<{ lastId: string | null; scrubbed: number }>;
  /** One keyset chunk of the rated-experience enqueue. `lastId = null` means the page was empty (done). */
  enqueueRatedChunk(userId: string, afterExperienceId: string | null): Promise<{ lastId: string | null; count: number }>;
  /** One chunk of one `delete` / `session` / `nullify` / `anonymize_then_delete` (remaining rows) statement. */
  applyDeleteOrNullChunk(c: ClaimedAccount, entry: DispositionEntry): Promise<number>;
  /** Per `anonymize`, `nullify`, `trip` entry (and the `retainWhere` rows of `anonymize_then_delete`): rows still naming the user. Empty = clean. */
  countRemainingReferences(userId: string): Promise<readonly { table: string; column: string; count: number }[]>;
  /**
   * Guard + `DELETE FROM users` + ledger row, one transaction. `refs_remain` and `fenced` change nothing; the
   * RUNNER then calls `rewindStage(c, 0)` and `recordFailedAttempt(c, now, c.attempts + 1)` for `refs_remain`.
   */
  finalize(c: ClaimedAccount, now: Date): Promise<'purged' | 'fenced' | 'refs_remain'>;
  /** Recomputes up to `limit` queued experiences; a recomputed id is removed from the queue. Returns how many succeeded. */
  drainRecomputeQueue(limit: number, recompute: (experienceId: string) => Promise<unknown>): Promise<number>;
}
