/**
 * Account-deletion service: re-authentication, the deletion request, and the restore port consumed by auth.
 * Everything it touches arrives through `AccountDeletionServiceDeps` (design, "Factories and dependencies"),
 * so a test substitutes a fake for the repo, lockout, mail, password check, clock and logger.
 *
 * Nothing here logs or returns a password, a grant, the confirmation text or an address. An account appears in
 * a log only as `accountLogId` (Property 22).
 *
 * Validates: Requirements 2.2, 2.4, 2.5, 2.8, 2.10, 2.13, 3.4, 3.5, 4.7
 */
import { randomBytes } from 'node:crypto';

import type { PoolClient } from 'pg';

import { DELETE_ACCOUNT_CONFIRMATION_PHRASE } from '@dwt/shared';

import { AppError } from '../../errors/AppError.js';
import { computeScheduledPurgeAt } from './deletionState.js';
import { accountLogId } from './logId.js';
import { generatePlaceholderId } from './placeholderId.js';
import type {
  AccountDeletionService,
  AccountDeletionServiceDeps,
  DeletionRequestResult,
  ReauthResult,
} from './ports.js';
import { generateGrant, hashGrant } from './reauthGrant.js';

/**
 * Precomputed PHC-formatted Argon2id hash (`m=65536,t=3,p=1`, matching `auth/password.ts`)
 * verified when `requestDeletionByPassword` receives an unknown or non-active email so
 * response timing matches an active account's password check without touching lockout.
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=1$c29tZXJhbmRvbXNhbHQxMjM0$RdescudvJCsgt3ub+b+dWRWJTmaaJObG';

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : 'unknown';
}

export function createAccountDeletionService(deps: AccountDeletionServiceDeps): AccountDeletionService {
  const { repo, lockout, mail, verify, clock, logger, config, logSecret } = deps;
  const newPlaceholderId = deps.newPlaceholderId ?? (() => generatePlaceholderId(() => randomBytes(16)));

  /** Best-effort "deletion cancelled" mail: a failure is logged without the recipient and never thrown. */
  async function sendCancelled(userId: string, to: string): Promise<void> {
    try {
      await mail.sendDeletionCancelled({ to });
    } catch (err) {
      logger.warn(
        { event: 'account_deletion.mail_failed', kind: 'cancelled', account: accountLogId(userId, logSecret), error: errorName(err) },
        'deletion cancelled email could not be sent',
      );
    }
  }

  async function reauth(userId: string, sessionId: string, password: string): Promise<ReauthResult> {
    // 1. Locked accounts are refused before any password work (R2.5).
    if (await lockout.isLocked(userId)) {
      throw new AppError('account_locked', 'Account is temporarily locked.');
    }

    // 2. Verify the current password. A missing hash (the user vanished between session and call) is a failure too.
    const storedHash = await repo.getPasswordHash(userId);
    const ok = storedHash !== null && (await verify(storedHash, password));

    // 3. One failure is recorded exactly once; the response reveals nothing beyond the code (R2.4).
    if (!ok) {
      await lockout.recordFailure(userId);
      throw new AppError('reauth_failed', 'Password is incorrect.');
    }

    // 4. Success only issues the grant. It deliberately never calls `clearOnSuccess`: a stolen session must not be
    //    able to reset the counter that protects the password through this route (R2.13).
    const now = clock.now();
    const expiresAt = new Date(now.getTime() + config.reauthWindowSeconds * 1000);
    const { grant, hash } = generateGrant();
    await repo.issueGrant({ userId, sessionId, grantHash: hash, expiresAt, now });
    return { reauthGrant: grant, expiresAt, graceDays: config.graceDays };
  }

  async function requestDeletion(
    userId: string,
    sessionId: string,
    grant: string,
    confirmation: string,
  ): Promise<DeletionRequestResult> {
    // The phrase is checked before any repo call, so a wrong phrase never consumes the grant (R2.8).
    if (confirmation.trim() !== DELETE_ACCOUNT_CONFIRMATION_PHRASE) {
      throw new AppError('account_deletion_confirmation_invalid', 'Confirmation text does not match.');
    }

    // The date is computed once and used for both the stored value and the response (R3.1).
    const now = clock.now();
    const scheduledPurgeAt = computeScheduledPurgeAt(now, config.graceDays);

    const outcome = await repo.consumeGrantAndRequestDeletion({
      userId,
      sessionId,
      grantHash: hashGrant(grant),
      now,
      scheduledPurgeAt,
      placeholderId: newPlaceholderId(),
    });
    if (outcome.outcome !== 'ok') {
      // `reauth_required` and `not_active` look the same to the caller; nothing was changed either way.
      throw new AppError('reauth_required', 'Please confirm your password again.');
    }

    // Best-effort mail: the request is committed, a mail failure never fails it (R3.5).
    try {
      await mail.sendDeletionScheduled({ to: outcome.email, scheduledPurgeAt, graceDays: config.graceDays });
    } catch (err) {
      logger.warn(
        { event: 'account_deletion.mail_failed', kind: 'scheduled', account: accountLogId(userId, logSecret), error: errorName(err) },
        'deletion scheduled email could not be sent',
      );
    }

    return { status: 'pending_deletion', scheduledPurgeAt, graceDays: config.graceDays };
  }

  async function requestDeletionByPassword(
    email: string,
    password: string,
    confirmation: string,
  ): Promise<DeletionRequestResult> {
    if (confirmation.trim() !== DELETE_ACCOUNT_CONFIRMATION_PHRASE) {
      throw new AppError('account_deletion_confirmation_invalid', 'Confirmation text does not match.');
    }

    const user = await repo.findActiveUserByEmail(email.trim());
    if (user === null) {
      await verify(DUMMY_PASSWORD_HASH, password);
      throw new AppError('reauth_failed', 'Invalid email or password.');
    }

    if (await lockout.isLocked(user.id)) {
      throw new AppError('account_locked', 'Account is temporarily locked.');
    }

    const ok = await verify(user.passwordHash, password);
    if (!ok) {
      await lockout.recordFailure(user.id);
      throw new AppError('reauth_failed', 'Invalid email or password.');
    }

    const now = clock.now();
    const scheduledPurgeAt = computeScheduledPurgeAt(now, config.graceDays);
    const outcome = await repo.requestDeletionForUser({
      userId: user.id,
      now,
      scheduledPurgeAt,
      placeholderId: newPlaceholderId(),
    });
    if (outcome.outcome !== 'ok') {
      throw new AppError('reauth_failed', 'Invalid email or password.');
    }

    try {
      await mail.sendDeletionScheduled({
        to: outcome.email,
        scheduledPurgeAt,
        graceDays: config.graceDays,
      });
    } catch (err) {
      logger.warn(
        {
          event: 'account_deletion.mail_failed',
          kind: 'scheduled',
          account: accountLogId(user.id, logSecret),
          error: errorName(err),
        },
        'deletion scheduled email could not be sent',
      );
    }

    return { status: 'pending_deletion', scheduledPurgeAt, graceDays: config.graceDays };
  }

  function getGraceDays(): number {
    return config.graceDays;
  }

  async function restore(userId: string, now: Date): Promise<'restored' | 'not_restorable'> {
    const res = await repo.restore(userId, now);
    if (!res.restored) return 'not_restorable';
    if (res.email !== null) await sendCancelled(userId, res.email);
    return 'restored';
  }

  async function restoreInTx(
    client: PoolClient,
    userId: string,
    now: Date,
  ): Promise<'restored' | 'not_needed' | 'not_restorable'> {
    // Sends nothing: the reset handler calls `notifyRestored` after its transaction commits.
    return repo.restoreInTx(client, userId, now);
  }

  async function notifyRestored(userId: string): Promise<void> {
    let email: string | null;
    try {
      email = await repo.getEmail(userId);
    } catch (err) {
      logger.warn(
        { event: 'account_deletion.mail_failed', kind: 'cancelled', account: accountLogId(userId, logSecret), error: errorName(err) },
        'deletion cancelled email could not be sent',
      );
      return;
    }
    if (email !== null) await sendCancelled(userId, email);
  }

  return {
    reauth,
    requestDeletion,
    requestDeletionByPassword,
    getGraceDays,
    restore,
    restoreInTx,
    notifyRestored,
  };
}
