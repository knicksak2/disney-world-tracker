/**
 * Photos Sweep — background housekeeping pipeline:
 * 1. Resume due pending photos (up to CONCURRENCY, bounded by time budget)
 * 2. Expire stuck uploading photos -> deleted
 * 3. Expire rejected photos -> deleted
 * 4. Expire old needs_review photos -> deleted
 * 5. Reap orphans (null owner, missing target) -> deleted
 * 6. Delete objects from object store, then hard-delete photo rows
 * 7. Prune counters, usage metrics, and vision fields
 * 8. Clean up upload objects of approved/hidden photos older than 1 hour
 *
 * Implements: Task 8.4
 * Validates: Requirements 8.9, 8.16, 8.19, 18.5, 19.1, 19.3, 19.4, 19.5,
 *            19.6, 19.7, 19.8, 19.11, 19.12, 19.13
 */

import { type PhotoTargetKind } from '@dwt/shared';
import { type ObjectStore, type Clock, type Scheduler, type TargetAdapter } from './ports.js';
import { type PhotosRepo } from './repo.js';
import { photoKeys } from './domain/objectKeys.js';
import { type ModerationRunner } from './moderationRunner.js';

export interface SweepLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  debug?(obj: Record<string, unknown>, msg?: string): void;
}

export interface SweepConfig {
  readonly batch?: number; // default 200
  readonly timeBudgetMs?: number; // default 25000
  readonly uploadExpiryMinutes?: number; // default 120
  readonly rejectedRetentionHours?: number; // default 24
  readonly needsReviewMaxAgeHours?: number; // default 120
  readonly visionFieldsRetentionDays?: number; // default 30
  readonly concurrency?: number; // default 3
}

export interface SweepOptions {
  readonly repo: PhotosRepo;
  readonly objectStore: ObjectStore;
  readonly runner: ModerationRunner;
  readonly targetAdapters?: readonly TargetAdapter[] | ReadonlyMap<PhotoTargetKind, TargetAdapter>;
  readonly config?: SweepConfig;
  readonly clock?: Clock;
  readonly scheduler?: Scheduler;
  readonly logger?: SweepLogger;
}

export interface SweepReport {
  readonly resumed: number;
  readonly expiredUploading: number;
  readonly expiredRejected: number;
  readonly expiredNeedsReview: number;
  readonly reapedOrphans: number;
  readonly deletedObjects: number;
  readonly deletedRows: number;
  readonly cleanedUploads: number;
  readonly budgetExhausted: boolean;
}

export interface SweepRunner {
  tryStart(): { started: true } | { started: false; reason: 'in_flight' };
  runOnce(): Promise<SweepReport>;
}

export async function sweep(options: SweepOptions): Promise<SweepReport> {
  const {
    repo,
    objectStore: store,
    runner,
    targetAdapters: rawAdapters,
    config: cfg = {},
    clock = { now: () => new Date() },
    logger = { info: () => {}, warn: () => {}, error: () => {} },
  } = options;

  const batch = cfg.batch ?? 200;
  const timeBudgetMs = cfg.timeBudgetMs ?? 25000;
  const uploadExpiryMinutes = cfg.uploadExpiryMinutes ?? 120;
  const rejectedRetentionHours = cfg.rejectedRetentionHours ?? 24;
  const needsReviewMaxAgeHours = cfg.needsReviewMaxAgeHours ?? 120;
  const visionFieldsRetentionDays = cfg.visionFieldsRetentionDays ?? 30;
  const concurrency = cfg.concurrency ?? 3;

  const targetAdapters: TargetAdapter[] = [];
  if (Array.isArray(rawAdapters)) {
    targetAdapters.push(...rawAdapters);
  } else if (rawAdapters instanceof Map) {
    targetAdapters.push(...rawAdapters.values());
  }

  const startTime = Date.now();
  const isBudgetRemaining = () => Date.now() - startTime < timeBudgetMs;

  let resumed = 0;
  let expiredUploading = 0;
  let expiredRejected = 0;
  let expiredNeedsReview = 0;
  let reapedOrphans = 0;
  let deletedObjects = 0;
  let deletedRows = 0;
  let cleanedUploads = 0;
  let budgetExhausted = false;

  const now = clock.now();

  // 1. resumeDue (Requirement 19.13)
  if (isBudgetRemaining()) {
    const dueIds = await repo.listDuePending(concurrency, now);
    for (const photoId of dueIds) {
      if (!isBudgetRemaining()) {
        budgetExhausted = true;
        break;
      }
      await runner.process(photoId);
      resumed++;
    }
  } else {
    budgetExhausted = true;
  }

  // 2. expireUploading
  if (isBudgetRemaining()) {
    const uploadingCutoff = new Date(now.getTime() - uploadExpiryMinutes * 60 * 1000);
    const expiredIds = await repo.expireUploading(uploadingCutoff, now);
    expiredUploading += expiredIds.length;
  } else {
    budgetExhausted = true;
  }

  // 3. expireRejected
  if (isBudgetRemaining()) {
    const rejectedCutoff = new Date(now.getTime() - rejectedRetentionHours * 3600 * 1000);
    const expiredIds = await repo.expireRejected(rejectedCutoff, now);
    expiredRejected += expiredIds.length;
  } else {
    budgetExhausted = true;
  }

  // 4. expireNeedsReview
  if (isBudgetRemaining()) {
    const expiredIds = await repo.expireNeedsReview(needsReviewMaxAgeHours, now);
    expiredNeedsReview += expiredIds.length;
  } else {
    budgetExhausted = true;
  }

  // 5. reapOrphans
  if (isBudgetRemaining()) {
    const orphanIds: string[] = [];
    const nullOwnerOrphans = await repo.findOwnerNullOrphanIds(batch);
    orphanIds.push(...nullOwnerOrphans);

    for (const adapter of targetAdapters) {
      if (!isBudgetRemaining()) break;
      const adapterOrphans = await adapter.findOrphanPhotoIds(batch);
      orphanIds.push(...adapterOrphans);
    }

    if (orphanIds.length > 0) {
      const distinctIds = [...new Set(orphanIds)].slice(0, batch);
      const reaped = await repo.softDeleteByIds(distinctIds, now);
      reapedOrphans += reaped.length;
    }
  } else {
    budgetExhausted = true;
  }

  // 6. deleteObjects & hardDelete
  if (isBudgetRemaining()) {
    const deletedPhotos = await repo.listDeleted(batch);
    for (const photo of deletedPhotos) {
      if (!isBudgetRemaining()) {
        budgetExhausted = true;
        break;
      }
      const keys = photoKeys(photo.id);
      try {
        await store.delete([keys.uploadFull, keys.uploadThumb, keys.full, keys.thumb]);
        deletedObjects += 4;
        await repo.hardDelete(photo.id);
        deletedRows++;
      } catch (err) {
        await repo.incrementDeleteAttempts(photo.id);
        logger.error({ event: 'photos.sweep.delete_failed', photoId: photo.id }, 'failed deleting photo objects');
      }
    }
  } else {
    budgetExhausted = true;
  }

  // 7. prune
  if (isBudgetRemaining()) {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const visionCutoff = new Date(now.getTime() - visionFieldsRetentionDays * 24 * 3600 * 1000);

    await repo.pruneCounters(sevenDaysAgo);
    await repo.pruneUsageDaily(ninetyDaysAgo);
    await repo.pruneVisionFields(visionCutoff);
  } else {
    budgetExhausted = true;
  }

  // 8. cleanApprovedUploads (Requirement 19.12)
  if (isBudgetRemaining()) {
    const needingClean = await repo.listApprovedNeedingUploadCleanup(batch, 60, now);
    for (const photo of needingClean) {
      if (!isBudgetRemaining()) {
        budgetExhausted = true;
        break;
      }
      const keys = photoKeys(photo.id);
      try {
        await store.delete([keys.uploadFull, keys.uploadThumb]);
        await repo.markUploadCleaned(photo.id, now);
        cleanedUploads++;
      } catch {
        // Leave upload_cleaned_at null to retry next sweep
      }
    }
  } else {
    budgetExhausted = true;
  }

  return {
    resumed,
    expiredUploading,
    expiredRejected,
    expiredNeedsReview,
    reapedOrphans,
    deletedObjects,
    deletedRows,
    cleanedUploads,
    budgetExhausted,
  };
}

export function createSweepRunner(options: SweepOptions): SweepRunner {
  let inFlight = false;
  const scheduler = options.scheduler ?? { run: (job) => { void job(); } };
  const logger = options.logger ?? {
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  return {
    tryStart(): { started: true } | { started: false; reason: 'in_flight' } {
      if (inFlight) {
        return { started: false, reason: 'in_flight' };
      }

      inFlight = true;
      scheduler.run(async () => {
        try {
          await sweep(options);
        } catch (err) {
          logger.error(
            { event: 'photos.job.crashed', photoId: 'sweep', code: err instanceof Error ? err.name : 'unknown' },
            'sweep crashed'
          );
        } finally {
          inFlight = false;
        }
      });

      return { started: true };
    },

    async runOnce(): Promise<SweepReport> {
      return sweep(options);
    },
  };
}
