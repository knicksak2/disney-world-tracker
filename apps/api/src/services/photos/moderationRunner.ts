/**
 * Moderation Runner — asynchronous pipeline for photo harm & vision screening,
 * queue management, lease claims & renewals, and publish-on-approval.
 *
 * Implements: Task 8.3
 * Validates: Requirements 2.7, 2.8, 6.1, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9,
 *            7.1, 7.2, 7.11, 7.13, 8.1, 8.3, 8.4, 8.5, 8.6, 8.7, 8.10,
 *            8.11, 8.12, 8.13, 8.14, 8.15, 8.17, 8.19, 8.20, 12.4, 19.12,
 *            21.1, 21.2
 */

import {
  type PhotoTargetKind,
  type PhotoRejectReason,
} from '@dwt/shared';
import {
  type ObjectStore,
  type HarmModerator,
  type HarmOutcome,
  type VisionChecker,
  type Clock,
  type Scheduler,
  type TargetAdapter,
  ObjectMissingError,
  ObjectTooLargeError,
} from './ports.js';
import { type PhotosRepo } from './repo.js';
import { type ModerationEnqueuer } from './service.js';
import { photoKeys } from './domain/objectKeys.js';
import { isJpeg } from './domain/sniff.js';
import { hasExifSegment } from './domain/exifScan.js';
import { computeHarmVerdict } from './domain/harmVerdict.js';
import {
  computeVisionVerdict,
  parseVisionFields,
  DEFAULT_VISION_THRESHOLDS,
  type VisionThresholds,
} from './domain/visionVerdict.js';
import { servingCleanupAfterZeroRows } from './domain/statusMachine.js';
import { nextAttemptAt, shouldEscalate } from './domain/retryPolicy.js';
import { dayKey } from './domain/quota.js';

export interface ModerationLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  debug?(obj: Record<string, unknown>, msg?: string): void;
}

export interface ModerationRunnerConfig {
  readonly concurrency?: number;
  readonly queueLimit?: number;
  readonly leaseSeconds?: number;
  readonly maxAttempts?: number;
  readonly maxBytes?: number;
  readonly maxThumbBytes?: number;
  readonly exifPolicy?: 'log' | 'reject';
  readonly exifScanBytes?: number;
  readonly harmCheckThumb?: boolean;
  readonly harmThreshold?: number;
  readonly visionThresholds?: VisionThresholds;
}

export interface ModerationRunnerOptions {
  readonly repo: PhotosRepo;
  readonly objectStore: ObjectStore;
  readonly harmModerator: HarmModerator;
  readonly visionChecker: VisionChecker;
  readonly targetAdapters: readonly TargetAdapter[] | ReadonlyMap<PhotoTargetKind, TargetAdapter>;
  readonly config?: ModerationRunnerConfig;
  readonly clock?: Clock;
  readonly scheduler?: Scheduler;
  readonly logger?: ModerationLogger;
}

function errorCodeOf(err: unknown): string {
  if (err && typeof err === 'object') {
    if ('code' in err && typeof (err as { code: unknown }).code === 'string') {
      return (err as { code: string }).code;
    }
    if ('name' in err && typeof (err as { name: unknown }).name === 'string') {
      return (err as { name: string }).name;
    }
  }
  return 'unknown_error';
}

export class ModerationRunner implements ModerationEnqueuer {
  private readonly repo: PhotosRepo;
  private readonly store: ObjectStore;
  private readonly harm: HarmModerator;
  private readonly vision: VisionChecker;
  private readonly targetAdapters: Map<PhotoTargetKind, TargetAdapter>;
  private readonly clock: Clock;
  private readonly scheduler: Scheduler;
  private readonly logger: ModerationLogger;

  private readonly concurrency: number;
  private readonly queueLimit: number;
  private readonly leaseSeconds: number;
  private readonly maxAttempts: number;
  private readonly maxBytes: number;
  private readonly maxThumbBytes: number;
  private readonly exifPolicy: 'log' | 'reject';
  private readonly exifScanBytes: number;
  private readonly harmCheckThumb: boolean;
  private readonly harmThreshold: number;
  private readonly visionThresholds: VisionThresholds;

  private readonly queue: string[] = [];
  private activeJobs = 0;

  constructor(options: ModerationRunnerOptions) {
    this.repo = options.repo;
    this.store = options.objectStore;
    this.harm = options.harmModerator;
    this.vision = options.visionChecker;
    this.clock = options.clock ?? { now: () => new Date() };
    this.scheduler = options.scheduler ?? { run: (job) => { void job(); } };
    this.logger = options.logger ?? {
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    const cfg = options.config ?? {};
    this.concurrency = cfg.concurrency ?? 3;
    this.queueLimit = cfg.queueLimit ?? 200;
    this.leaseSeconds = cfg.leaseSeconds ?? 180;
    this.maxAttempts = cfg.maxAttempts ?? 6;
    this.maxBytes = cfg.maxBytes ?? 1048576;
    this.maxThumbBytes = cfg.maxThumbBytes ?? 65536;
    this.exifPolicy = cfg.exifPolicy ?? 'log';
    this.exifScanBytes = cfg.exifScanBytes ?? 65536;
    this.harmCheckThumb = cfg.harmCheckThumb ?? true;
    this.harmThreshold = cfg.harmThreshold ?? 0.5;
    this.visionThresholds = cfg.visionThresholds ?? DEFAULT_VISION_THRESHOLDS;

    this.targetAdapters = new Map();
    if (Array.isArray(options.targetAdapters)) {
      for (const adapter of options.targetAdapters) {
        this.targetAdapters.set(adapter.kind, adapter);
      }
    } else if (options.targetAdapters instanceof Map) {
      for (const [kind, adapter] of options.targetAdapters) {
        this.targetAdapters.set(kind, adapter);
      }
    }
  }

  /**
   * Enqueues a photo ID for processing.
   * If the bounded queue is full, the photo is dropped from memory and stays 'pending' for the sweep.
   */
  enqueue(photoId: string): void {
    if (this.queue.length >= this.queueLimit) {
      this.logger.warn({ event: 'photos.queue.overflow', photoId }, 'moderation queue full, photo remains pending');
      return;
    }
    this.queue.push(photoId);
    this.pump();
  }

  /**
   * Detached job container with top-level error trapping and slot release.
   */
  runContained(label: string, job: () => Promise<void>): void {
    this.scheduler.run(async () => {
      try {
        await job();
      } catch (err) {
        this.logger.error(
          { event: 'photos.job.crashed', photoId: label, code: errorCodeOf(err) },
          'photo job crashed'
        );
      } finally {
        this.activeJobs = Math.max(0, this.activeJobs - 1);
        this.pump();
      }
    });
  }

  private pump(): void {
    while (this.activeJobs < this.concurrency && this.queue.length > 0) {
      const nextId = this.queue.shift();
      if (!nextId) break;
      this.activeJobs++;
      this.runContained(nextId, () => this.process(nextId));
    }
  }

  /**
   * Process a single photo through moderation.
   */
  async process(photoId: string): Promise<void> {
    const now = this.clock.now();
    const day = dayKey(now);

    // 1. Claim photo
    const row = await this.repo.claim(photoId, this.leaseSeconds, this.maxAttempts, now);
    if (!row) {
      // Check if photo exists with status pending and attempts >= maxAttempts
      const existing = await this.repo.getById(photoId);
      if (existing && existing.status === 'pending' && existing.attempts >= this.maxAttempts) {
        await this.repo.escalateToNeedsReview(photoId, this.maxAttempts, now);
      }
      return;
    }

    const adapter = this.targetAdapters.get(row.target_kind);
    if (!adapter) {
      this.logger.error({ event: 'photos.adapter.missing', photoId, kind: row.target_kind }, 'no adapter for target kind');
      return;
    }

    const keys = photoKeys(row.id);

    // Helper: conditional rejection write and zero-row cleanup
    const rejectConditional = async (
      reason: PhotoRejectReason,
      patch: {
        harmVerdict?: 'flag' | null;
        visionVerdict?: 'reject' | null;
        visionFields?: unknown | null;
      } = {},
      servingKeysToDelete: readonly string[] = []
    ): Promise<void> => {
      const updated = await this.repo.updateStatus(row.id, 'pending', 'rejected', {
        rejectReason: reason,
        harmVerdict: patch.harmVerdict ?? null,
        visionVerdict: patch.visionVerdict ?? null,
        visionFields: patch.visionFields ?? null,
        moderatedAt: this.clock.now(),
      });
      await this.repo.incrementUsageCounters(day, { rejections: 1 });

      if (servingKeysToDelete.length > 0) {
        if (updated) {
          await this.store.delete(servingKeysToDelete);
        } else {
          const current = await this.repo.getById(row.id);
          const cleanup = servingCleanupAfterZeroRows(current?.status ?? 'deleted');
          if (cleanup === 'delete_serving_keys') {
            await this.store.delete(servingKeysToDelete);
          }
        }
      }
    };

    // Helper: record retryable failure (or escalate to needs_review if attempts reached max)
    const handleRetryable = async (errorCode: string): Promise<void> => {
      const nextTime = nextAttemptAt(now, row.attempts);
      if (shouldEscalate(row.attempts, this.maxAttempts)) {
        await this.repo.updateStatus(row.id, 'pending', 'needs_review', {
          rejectReason: null,
          moderatedAt: null,
        });
        await this.repo.recordRetryable(row.id, errorCode, nextTime);
        await this.repo.incrementUsageCounters(day, { needsReview: 1 });
      } else {
        await this.repo.recordRetryable(row.id, errorCode, nextTime);
      }
    };

    // 2. Read full and thumb objects from upload keys
    let full: { bytes: Uint8Array; etag: string };
    let thumb: { bytes: Uint8Array; etag: string };
    try {
      full = await this.store.getBytes(keys.uploadFull, this.maxBytes);
      thumb = await this.store.getBytes(keys.uploadThumb, this.maxThumbBytes);
    } catch (err) {
      if (err instanceof ObjectMissingError || err instanceof ObjectTooLargeError) {
        await rejectConditional('invalid_image');
        return;
      }
      throw err;
    }

    // 3. Verify ETags against recorded confirm ETags
    if (full.etag !== row.full_etag || thumb.etag !== row.thumb_etag) {
      await rejectConditional('invalid_image');
      return;
    }

    // 4. Sniff JPEG headers
    if (!isJpeg(full.bytes) || !isJpeg(thumb.bytes)) {
      await rejectConditional('invalid_image');
      return;
    }

    // 5. Exif scan
    const exifPresent =
      hasExifSegment(full.bytes, this.exifScanBytes) ||
      hasExifSegment(thumb.bytes, this.exifScanBytes);
    if (exifPresent) {
      await this.repo.incrementUsageCounters(day, { exifPresent: 1 });
      this.logger.warn({ event: 'photos.exif_detected', photoId: row.id }, 'EXIF segment detected');
      if (this.exifPolicy === 'reject') {
        await rejectConditional('invalid_image');
        return;
      }
    }

    // 6. Harm check step
    if (row.harm_verdict === null) {
      const renewed = await this.repo.renewLease(row.id, row.attempts, this.leaseSeconds, this.clock.now());
      if (!renewed) {
        return;
      }

      const h1 = await this.harm.check(full.bytes);
      let h2: HarmOutcome | null = null;
      if (this.harmCheckThumb) {
        h2 = await this.harm.check(thumb.bytes);
      }

      if (h1.kind === 'retryable' || h2?.kind === 'retryable') {
        const code = h1.kind === 'retryable' ? h1.code : (h2 && h2.kind === 'retryable' ? h2.code : 'retryable');
        await handleRetryable(code);
        return;
      }

      if (h1.kind === 'invalid_image' || h2?.kind === 'invalid_image') {
        await rejectConditional('invalid_image');
        return;
      }

      const v1 = computeHarmVerdict(h1, this.harmThreshold);
      const v2 = h2 ? computeHarmVerdict(h2, this.harmThreshold) : 'pass';
      const harmCallsCount = h2 ? 2 : 1;
      await this.repo.incrementUsageCounters(day, { harmCalls: harmCallsCount });

      if (v1 === 'flag' || v2 === 'flag') {
        await rejectConditional('harm', { harmVerdict: 'flag' });
        return;
      }

      // Harm passed
      await this.repo.updateStatus(row.id, 'pending', 'pending', { harmVerdict: 'pass' });
    }

    // 7. Vision check step (food only)
    if (adapter.screen === 'harm_and_vision' && row.vision_verdict === null) {
      const renewed = await this.repo.renewLease(row.id, row.attempts, this.leaseSeconds, this.clock.now());
      if (!renewed) {
        return;
      }

      const v = await this.vision.check(full.bytes);
      if (v.kind === 'retryable') {
        await handleRetryable(v.code);
        return;
      }

      const parsed = parseVisionFields(v.fields);
      if (!parsed.ok) {
        await handleRetryable('vision_parse_error');
        return;
      }

      await this.repo.incrementUsageCounters(day, {
        visionCalls: 1,
        promptTokens: v.usage.promptTokens,
        outputTokens: v.usage.outputTokens,
      });

      const verdict = computeVisionVerdict(parsed.fields, this.visionThresholds);
      if (verdict.decision === 'reject') {
        await rejectConditional(verdict.primary, {
          visionVerdict: 'reject',
          visionFields: parsed.fields,
        });
        return;
      }

      // Vision passed
      await this.repo.updateStatus(row.id, 'pending', 'pending', {
        visionVerdict: 'pass',
        visionFields: parsed.fields,
      });
    }

    // 8. Publish step
    const renewed = await this.repo.renewLease(row.id, row.attempts, this.leaseSeconds, this.clock.now());
    if (!renewed) {
      return;
    }

    const c1 = await this.store.copy({
      srcKey: keys.uploadFull,
      dstKey: keys.full,
      expectedEtag: row.full_etag,
    });
    const c2 = await this.store.copy({
      srcKey: keys.uploadThumb,
      dstKey: keys.thumb,
      expectedEtag: row.thumb_etag,
    });

    if (
      c1.kind === 'source_changed' ||
      c1.kind === 'source_missing' ||
      c2.kind === 'source_changed' ||
      c2.kind === 'source_missing'
    ) {
      await rejectConditional('invalid_image', {}, [keys.full, keys.thumb]);
      return;
    }

    if (c1.kind === 'retryable' || c2.kind === 'retryable') {
      const code = c1.kind === 'retryable' ? c1.code : (c2 as { code: string }).code;
      await handleRetryable(code);
      return;
    }

    // Conditional approval write
    const currentTime = this.clock.now();
    const updated = await this.repo.markApproved({
      id: row.id,
      harmVerdict: 'pass',
      visionVerdict: adapter.screen === 'harm_and_vision' ? 'pass' : null,
      moderatedAt: currentTime,
      servedAt: currentTime,
      allowedStatus: 'pending',
    });

    if (!updated) {
      // Zero-row rule: re-read status
      const current = await this.repo.getById(row.id);
      const cleanup = servingCleanupAfterZeroRows(current?.status ?? 'deleted');
      if (cleanup === 'delete_serving_keys') {
        await this.store.delete([keys.full, keys.thumb]);
      }
      return;
    }

    // Approval succeeded -> clean up upload objects best effort
    try {
      await this.store.delete([keys.uploadFull, keys.uploadThumb]);
      await this.repo.markUploadCleaned(row.id, currentTime);
    } catch {
      // Best-effort; sweep cleans it up if failed
    }
  }

  /**
   * Operator approve action for photos in 'needs_review' state.
   */
  async operatorApprove(photoId: string): Promise<boolean> {
    const photo = await this.repo.getById(photoId);
    if (!photo || photo.status !== 'needs_review' || !photo.full_etag || !photo.thumb_etag) {
      return false;
    }

    const adapter = this.targetAdapters.get(photo.target_kind);
    const keys = photoKeys(photo.id);

    // HEAD upload objects to verify existence and ETags
    const headFull = await this.store.head(keys.uploadFull);
    const headThumb = await this.store.head(keys.uploadThumb);

    if (!headFull.exists || !headThumb.exists) {
      await this.repo.updateStatus(photo.id, 'needs_review', 'rejected', {
        rejectReason: 'invalid_image',
        moderatedAt: this.clock.now(),
      });
      return false;
    }

    if (headFull.etag !== photo.full_etag || headThumb.etag !== photo.thumb_etag) {
      await this.repo.updateStatus(photo.id, 'needs_review', 'rejected', {
        rejectReason: 'invalid_image',
        moderatedAt: this.clock.now(),
      });
      return false;
    }

    // Copy to serving keys
    const c1 = await this.store.copy({
      srcKey: keys.uploadFull,
      dstKey: keys.full,
      expectedEtag: photo.full_etag,
    });
    const c2 = await this.store.copy({
      srcKey: keys.uploadThumb,
      dstKey: keys.thumb,
      expectedEtag: photo.thumb_etag,
    });

    if (
      c1.kind === 'source_changed' ||
      c1.kind === 'source_missing' ||
      c2.kind === 'source_changed' ||
      c2.kind === 'source_missing'
    ) {
      await this.repo.updateStatus(photo.id, 'needs_review', 'rejected', {
        rejectReason: 'invalid_image',
        moderatedAt: this.clock.now(),
      });
      await this.store.delete([keys.full, keys.thumb]);
      return false;
    }

    if (c1.kind === 'retryable' || c2.kind === 'retryable') {
      return false;
    }

    // Conditional approval write from needs_review
    const currentTime = this.clock.now();
    const updated = await this.repo.markApproved({
      id: photo.id,
      harmVerdict: 'pass',
      visionVerdict: adapter?.screen === 'harm_and_vision' ? 'pass' : null,
      approvedByOperator: true,
      moderatedAt: currentTime,
      servedAt: currentTime,
      allowedStatus: 'needs_review',
    });

    if (!updated) {
      const current = await this.repo.getById(photo.id);
      const cleanup = servingCleanupAfterZeroRows(current?.status ?? 'deleted');
      if (cleanup === 'delete_serving_keys') {
        await this.store.delete([keys.full, keys.thumb]);
      }
      return false;
    }

    // Clean up upload objects
    try {
      await this.store.delete([keys.uploadFull, keys.uploadThumb]);
      await this.repo.markUploadCleaned(photo.id, currentTime);
    } catch {
      // Best-effort
    }

    return true;
  }
}
