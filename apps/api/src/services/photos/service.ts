/**
 * Photo service — orchestrates uploads, confirmation, status polling,
 * galleries, reporting, blocking, and lifecycle operations.
 *
 * Implements: Task 8.2
 * Validates: Requirements 1.6, 3.1, 3.4, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5,
 *            4.6, 4.7, 4.8, 4.9, 4.10, 5.1, 5.3, 5.4, 5.5, 5.6, 5.7, 5.9,
 *            5.10, 5.12, 10.5, 10.8, 16.1, 16.2, 16.4, 17.1, 17.2, 17.4, 19.9
 */

import crypto from 'node:crypto';
import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import {
  type PhotoTargetKind,
  type PhotoUploadSlotDTO,
  type PhotoInitiateResponseDTO,
  type PhotoConfirmResultDTO,
  type PhotoConfirmResponseDTO,
  type MyPhotoDTO,
  type MyPhotoStatusResponseDTO,
  type FoodPhotoDTO,
  type RestaurantFoodPhotoDTO,
  type TripPhotoDTO,
  type SharedSummaryPhotoDTO,
  type PhotoPageDTO,
  type PhotoClientConfigDTO,
  type BlockedUserDTO,
  type PhotoReportReason,
  PHOTO_REJECT_MESSAGES,
  MY_PHOTOS_DEFAULT_LIMIT,
} from '@dwt/shared';
import { type PhotosRepo, type PhotoRow } from './repo.js';
import { type ReportsRepo } from './reportsRepo.js';
import {
  type ObjectStore,
  type TargetAdapter,
  type Clock,
  type PhotoLifecyclePort,
} from './ports.js';
import { photoKeys } from './domain/objectKeys.js';
import { dayKey } from './domain/quota.js';
import { readKeysFor, bylineFor } from './domain/accessPolicy.js';
import { shouldAutoHide } from './domain/reportPolicy.js';
import { encodeAlbumCursor, decodeAlbumCursor } from './domain/albumCursor.js';
import { selectRecapHighlights } from './domain/recapHighlights.js';
import { wdwToday } from '../trips/wdwClock.js';

export interface PhotoUploadItemInput {
  readonly contentType: 'image/jpeg';
  readonly byteSize: number;
  readonly thumbByteSize: number;
  readonly width: number;
  readonly height: number;
  readonly takenAt?: string | undefined;
}

export interface ModerationEnqueuer {
  enqueue(photoId: string): void;
}

export interface PhotoServiceConfig {
  readonly enabled: boolean;
  readonly foodEnabled: boolean;
  readonly tripEnabled: boolean;
  readonly maxPerFoodLog: number;
  readonly maxPerTrip: number;
  readonly maxFeedPostPhotos: number;
  readonly maxBatch: number;
  readonly maxBytes: number;
  readonly maxThumbBytes: number;
  readonly dailyUploadCap: number;
  readonly globalDailyCap: number;
  readonly putUrlTtlSeconds: number;
  readonly getUrlTtlSeconds: number;
  readonly reportAutohideFood: number;
  readonly reportAutohideTrip: number;
  readonly experienceStripMax: number;
  readonly recapHighlightMax: number;
}

export interface PhotoServiceOptions {
  readonly pool: DbPool;
  readonly repo: PhotosRepo;
  readonly reportsRepo: ReportsRepo;
  readonly objectStore: ObjectStore;
  readonly targetAdapters: readonly TargetAdapter[] | ReadonlyMap<PhotoTargetKind, TargetAdapter>;
  readonly config: PhotoServiceConfig;
  readonly clock?: Clock;
  readonly moderationEnqueuer?: ModerationEnqueuer;
  readonly recapShareGate?: {
    resolve(shareId: string, recipientId: string): Promise<unknown | null>;
  };
  readonly recapPhotoPort?: {
    isAlbumPhoto(access: unknown, recipientId: string, photoId: string): Promise<boolean>;
  };
}

export class PhotoService implements PhotoLifecyclePort {
  private readonly pool: DbPool;
  private readonly repo: PhotosRepo;
  private readonly reportsRepo: ReportsRepo;
  private readonly objectStore: ObjectStore;
  private readonly targetAdapters: Map<PhotoTargetKind, TargetAdapter>;
  private readonly config: PhotoServiceConfig;
  private readonly clock: Clock;
  private readonly moderationEnqueuer?: ModerationEnqueuer | undefined;
  private readonly recapShareGate?: {
    resolve(shareId: string, recipientId: string): Promise<unknown | null>;
  } | undefined;
  private readonly recapPhotoPort?: {
    isAlbumPhoto(access: unknown, recipientId: string, photoId: string): Promise<boolean>;
  } | undefined;

  constructor(options: PhotoServiceOptions) {
    this.pool = options.pool;
    this.repo = options.repo;
    this.reportsRepo = options.reportsRepo;
    this.objectStore = options.objectStore;
    this.config = options.config;
    this.clock = options.clock ?? { now: () => new Date() };
    this.moderationEnqueuer = options.moderationEnqueuer;
    this.recapShareGate = options.recapShareGate;
    this.recapPhotoPort = options.recapPhotoPort;

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

  get enabled(): boolean {
    return this.config.enabled;
  }

  private getTargetAdapter(kind: PhotoTargetKind): TargetAdapter {
    const adapter = this.targetAdapters.get(kind);
    if (!adapter) {
      throw new AppError('validation_failed', `Unsupported photo target kind: ${kind}`);
    }
    return adapter;
  }

  async initiate(
    userId: string,
    input: {
      readonly target: { readonly kind: PhotoTargetKind; readonly id: string };
      readonly items: readonly PhotoUploadItemInput[];
    }
  ): Promise<PhotoInitiateResponseDTO> {
    // 1. Kill switches
    if (!this.config.enabled) {
      throw new AppError('photo_uploads_disabled', 'Photo uploads are turned off right now', {
        details: { reason: 'kill_switch' },
      });
    }
    if (input.target.kind === 'food_log' && !this.config.foodEnabled) {
      throw new AppError('photo_uploads_disabled', 'Photo uploads are turned off right now', {
        details: { reason: 'kill_switch' },
      });
    }
    if (input.target.kind === 'trip' && !this.config.tripEnabled) {
      throw new AppError('photo_uploads_disabled', 'Photo uploads are turned off right now', {
        details: { reason: 'kill_switch' },
      });
    }

    // 2. Ban check
    const isBanned = await this.reportsRepo.isBanned(userId);
    if (isBanned) {
      throw new AppError('photo_uploads_banned', 'User is banned from photo uploads');
    }

    // 3. Target adapter authorization
    const adapter = this.getTargetAdapter(input.target.kind);
    const { scopeId } = await adapter.authorizeUpload(userId, input.target.id);

    const now = this.clock.now();
    const day = dayKey(now);

    // 4. Batch validation
    if (input.items.length === 0 || input.items.length > this.config.maxBatch) {
      throw new AppError(
        'photo_upload_invalid',
        `Batch size must be between 1 and ${this.config.maxBatch}`
      );
    }

    for (const item of input.items) {
      if (item.contentType !== 'image/jpeg') {
        throw new AppError('photo_upload_invalid', 'Content-Type must be image/jpeg');
      }
      if (item.byteSize > this.config.maxBytes || item.byteSize <= 0) {
        throw new AppError('photo_upload_invalid', 'Image size exceeds maximum allowed');
      }
      if (item.thumbByteSize > this.config.maxThumbBytes || item.thumbByteSize <= 0) {
        throw new AppError('photo_upload_invalid', 'Thumbnail size exceeds maximum allowed');
      }
      if (item.width < 1 || item.width > 4096 || item.height < 1 || item.height > 4096) {
        throw new AppError('photo_upload_invalid', 'Dimensions must be between 1 and 4096');
      }
    }

    // 5. Transaction: Lock target, target cap check, per-user quota, global ceiling, insert rows, presign
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN;');

      // Advisory lock on target
      await this.repo.lockTarget(input.target.id, client);

      // Target cap check (Property 37)
      const liveCount = await this.repo.countLiveForTarget(
        input.target.kind,
        input.target.id,
        now,
        this.config.putUrlTtlSeconds,
        client
      );
      if (liveCount + input.items.length > adapter.maxPerTarget) {
        throw new AppError('photo_target_full', 'Target has reached maximum photo limit');
      }

      // Reserve per-user daily quota
      const quotaRes = await this.repo.reserveQuota(
        userId,
        day,
        input.items.length,
        this.config.dailyUploadCap,
        client
      );
      if (!quotaRes.ok) {
        throw new AppError('photo_quota_exceeded', 'Daily upload quota exceeded');
      }

      // Reserve global daily ceiling
      const totalBytes = input.items.reduce(
        (sum, item) => sum + item.byteSize + item.thumbByteSize,
        0
      );
      const globalRes = await this.repo.reserveGlobalUploads(
        day,
        input.items.length,
        totalBytes,
        this.config.globalDailyCap,
        client
      );
      if (!globalRes.ok) {
        throw new AppError('photo_uploads_disabled', 'Photo uploads are full for today, try again tomorrow', {
          details: { reason: 'global_cap' },
        });
      }

      const slots: PhotoUploadSlotDTO[] = [];
      const expiresAt = new Date(now.getTime() + this.config.putUrlTtlSeconds * 1000).toISOString();

      for (const item of input.items) {
        const photoId = crypto.randomUUID();
        const keys = photoKeys(photoId);

        let sortAt = now;
        let parsedTakenAt: Date | null = null;
        if (item.takenAt) {
          const d = new Date(item.takenAt);
          if (!isNaN(d.getTime())) {
            parsedTakenAt = d;
            const maxFuture = new Date(now.getTime() + 5 * 60 * 1000);
            if (d <= maxFuture && d >= new Date('2000-01-01T00:00:00Z')) {
              sortAt = d;
            }
          }
        }

        await this.repo.insertUploading(
          {
            id: photoId,
            ownerId: userId,
            targetKind: input.target.kind,
            targetId: input.target.id,
            scopeId,
            objectKey: keys.uploadFull,
            thumbKey: keys.uploadThumb,
            byteSize: item.byteSize,
            thumbByteSize: item.thumbByteSize,
            width: item.width,
            height: item.height,
            takenAt: parsedTakenAt,
            sortAt,
            createdAt: now,
          },
          client
        );

        // Presign upload URLs for u/ keys only (Requirement 3.8)
        const putUrl = await this.objectStore.presignPut({
          key: keys.uploadFull,
          contentLength: item.byteSize,
          expiresInSeconds: this.config.putUrlTtlSeconds,
        });

        const thumbPutUrl = await this.objectStore.presignPut({
          key: keys.uploadThumb,
          contentLength: item.thumbByteSize,
          expiresInSeconds: this.config.putUrlTtlSeconds,
        });

        slots.push({
          photoId,
          putUrl,
          thumbPutUrl,
          expiresAt,
        });
      }

      await client.query('COMMIT;');
      return { slots };
    } catch (err) {
      await client.query('ROLLBACK;').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async confirm(
    userId: string,
    input: { readonly photoIds: readonly string[] }
  ): Promise<PhotoConfirmResponseDTO> {
    const now = this.clock.now();
    const results: PhotoConfirmResultDTO[] = [];

    for (const photoId of input.photoIds) {
      const photo = await this.repo.getById(photoId);
      if (!photo || photo.owner_id !== userId) {
        throw new AppError('photo_not_found', 'Photo not found');
      }

      // Idempotency: if already confirmed/past uploading
      if (
        photo.status === 'pending' ||
        photo.status === 'approved' ||
        photo.status === 'needs_review' ||
        photo.status === 'rejected' ||
        photo.status === 'hidden'
      ) {
        results.push({ photoId, result: 'already' });
        continue;
      }

      if (photo.status === 'deleted') {
        results.push({ photoId, result: 'invalid' });
        continue;
      }

      if (photo.status === 'uploading') {
        const fullHead = await this.objectStore.head(photo.object_key);
        const thumbHead = await this.objectStore.head(photo.thumb_key);

        if (!fullHead.exists || !thumbHead.exists) {
          results.push({ photoId, result: 'incomplete' });
          continue;
        }

        const isFullTooLarge = fullHead.contentLength > this.config.maxBytes;
        const isThumbTooLarge = thumbHead.contentLength > this.config.maxThumbBytes;
        const isZeroByte = fullHead.contentLength <= 0 || thumbHead.contentLength <= 0;
        const isFullWrongType =
          fullHead.contentType !== null && fullHead.contentType !== 'image/jpeg';
        const isThumbWrongType =
          thumbHead.contentType !== null && thumbHead.contentType !== 'image/jpeg';

        if (isFullTooLarge || isThumbTooLarge || isZeroByte || isFullWrongType || isThumbWrongType) {
          await this.repo.updateStatus(photoId, 'uploading', 'deleted', { moderatedAt: now });
          await this.repo.softDeleteByIds([photoId], now);
          results.push({ photoId, result: 'invalid' });
          continue;
        }

        await this.repo.recordConfirm(
          photoId,
          { fullEtag: fullHead.etag, thumbEtag: thumbHead.etag },
          now
        );
        this.moderationEnqueuer?.enqueue(photoId);
        results.push({ photoId, result: 'accepted' });
      }
    }

    return { results };
  }

  async status(userId: string, photoId: string): Promise<MyPhotoDTO> {
    const photo = await this.repo.getById(photoId);
    if (!photo || photo.owner_id !== userId || photo.status === 'deleted') {
      throw new AppError('photo_not_found', 'Photo not found');
    }

    const nowTime = this.clock.now().getTime();
    const nextAttemptTime = new Date(photo.next_attempt_at).getTime();
    const leaseUntilTime = photo.lease_until ? new Date(photo.lease_until).getTime() : null;

    if (
      photo.status === 'pending' &&
      nextAttemptTime <= nowTime &&
      (leaseUntilTime === null || leaseUntilTime < nowTime)
    ) {
      this.moderationEnqueuer?.enqueue(photo.id);
    }

    return this.mapToMyPhotoDTO(photo);
  }

  async statusBatch(
    userId: string,
    photoIds: readonly string[]
  ): Promise<MyPhotoStatusResponseDTO> {
    if (photoIds.length > 10) {
      throw new AppError('validation_failed', 'Maximum 10 photo IDs allowed per status request');
    }

    const photos = await this.repo.listOwnByIds(userId, photoIds);
    const nowTime = this.clock.now().getTime();
    const dtoList: MyPhotoDTO[] = [];

    for (const photo of photos) {
      const nextAttemptTime = new Date(photo.next_attempt_at).getTime();
      const leaseUntilTime = photo.lease_until ? new Date(photo.lease_until).getTime() : null;

      if (
        photo.status === 'pending' &&
        nextAttemptTime <= nowTime &&
        (leaseUntilTime === null || leaseUntilTime < nowTime)
      ) {
        this.moderationEnqueuer?.enqueue(photo.id);
      }
      dtoList.push(await this.mapToMyPhotoDTO(photo));
    }

    return { photos: dtoList };
  }

  async listMine(
    userId: string,
    params: {
      readonly targetKind: 'food_log' | 'trip';
      readonly scopeId: string;
      readonly cursor?: string | undefined;
      readonly limit?: number | undefined;
    }
  ): Promise<PhotoPageDTO<MyPhotoDTO>> {
    const limit = params.limit ?? 20;
    let decodedCursor: { createdAt: Date; id: string } | undefined;
    if (params.cursor) {
      const decoded = decodeAlbumCursor(params.cursor);
      if (!decoded) {
        throw new AppError('validation_failed', 'Invalid cursor');
      }
      decodedCursor = { createdAt: decoded.sortAt, id: decoded.id };
    }

    const rows = await this.repo.listMine(
      userId,
      params.targetKind,
      params.scopeId,
      decodedCursor,
      limit + 1
    );

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const items: MyPhotoDTO[] = [];
    for (const row of pageRows) {
      items.push(await this.mapToMyPhotoDTO(row));
    }

    let nextCursor: string | null = null;
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1]!;
      nextCursor = encodeAlbumCursor({ sortAt: last.created_at, id: last.id });
    }

    return { items, nextCursor };
  }

  async listAllMine(
    userId: string,
    params: {
      readonly cursor?: string | undefined;
      readonly limit?: number | undefined;
    }
  ): Promise<PhotoPageDTO<MyPhotoDTO>> {
    const limit = params.limit ?? MY_PHOTOS_DEFAULT_LIMIT;
    let decodedCursor: { createdAt: Date; id: string } | undefined;
    if (params.cursor) {
      const decoded = decodeAlbumCursor(params.cursor);
      if (!decoded) {
        throw new AppError('validation_failed', 'Invalid cursor');
      }
      decodedCursor = { createdAt: decoded.sortAt, id: decoded.id };
    }

    const rows = await this.repo.listAllMine(
      userId,
      decodedCursor,
      limit + 1
    );

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const items: MyPhotoDTO[] = [];
    for (const row of pageRows) {
      items.push(await this.mapToMyPhotoDTO(row));
    }

    let nextCursor: string | null = null;
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1]!;
      nextCursor = encodeAlbumCursor({ sortAt: last.created_at, id: last.id });
    }

    return { items, nextCursor };
  }

  async delete(userId: string, photoId: string): Promise<void> {
    const photo = await this.repo.getById(photoId);
    if (!photo || photo.status === 'deleted') {
      throw new AppError('photo_not_found', 'Photo not found');
    }

    const isOwner = photo.owner_id === userId;
    if (!isOwner) {
      const adapter = this.targetAdapters.get(photo.target_kind);
      const canDeleteOthers = adapter ? await adapter.canDeleteOthers(userId, photo.scope_id) : false;
      if (!canDeleteOthers) {
        throw new AppError('photo_not_found', 'Photo not found');
      }
    }

    const now = this.clock.now();
    await this.repo.softDeleteByIds([photoId], now);
  }

  async report(
    reporterId: string,
    photoId: string,
    input: {
      readonly reason: PhotoReportReason;
      readonly note?: string | undefined;
      readonly shareId?: string | undefined;
    }
  ): Promise<void> {
    const photo = await this.repo.getById(photoId);
    if (!photo || photo.status !== 'approved') {
      throw new AppError('photo_not_found', 'Photo not found');
    }
    if (photo.owner_id === reporterId) {
      throw new AppError('photo_not_found', 'Cannot report your own photo');
    }

    if (photo.owner_id) {
      const isBlocked = await this.reportsRepo.isBlockedEitherWay(reporterId, photo.owner_id);
      if (isBlocked) {
        throw new AppError('photo_not_found', 'Photo not found');
      }
    }

    if (photo.target_kind === 'food_log') {
      // Food photos are visible to all non-blocked signed-in users
    } else if (photo.target_kind === 'trip') {
      if (input.shareId) {
        if (!this.recapShareGate || !this.recapPhotoPort) {
          throw new AppError('photo_not_found', 'Share access unavailable');
        }
        const access = await this.recapShareGate.resolve(input.shareId, reporterId);
        if (!access) {
          throw new AppError('photo_not_found', 'Share not found or expired');
        }
        const isAlbumPhoto = await this.recapPhotoPort.isAlbumPhoto(access, reporterId, photoId);
        if (!isAlbumPhoto) {
          throw new AppError('photo_not_found', 'Photo is not available through this share');
        }
      } else {
        const adapter = this.getTargetAdapter('trip');
        const canView = await adapter.canViewScope(reporterId, photo.scope_id);
        if (!canView) {
          throw new AppError('photo_not_found', 'Trip photo not accessible');
        }
      }
    }

    await this.reportsRepo.addReport({
      photoId,
      reporterId,
      reason: input.reason,
      note: input.note ?? null,
    });

    const countedOpenReports = await this.reportsRepo.countedOpenReports(photoId);
    const shouldHide = shouldAutoHide(
      { status: photo.status, countedOpenReports, kind: photo.target_kind },
      { food: this.config.reportAutohideFood, trip: this.config.reportAutohideTrip }
    );
    if (shouldHide) {
      await this.repo.updateStatus(photoId, 'approved', 'hidden', { hiddenReason: 'reports' });
    }
  }

  async addBlock(
    blockerId: string,
    input: {
      readonly userId?: string | undefined;
      readonly photoId?: string | undefined;
      readonly shareId?: string | undefined;
    }
  ): Promise<BlockedUserDTO> {
    if (input.userId) {
      if (input.userId === blockerId) {
        throw new AppError('validation_failed', 'Cannot block yourself');
      }
      const block = await this.reportsRepo.addBlock(blockerId, input.userId);
      const friendSet = await this.repo.friendIdsAmong(blockerId, [input.userId]);
      const isFriend = friendSet.has(input.userId);
      const profile = await this.reportsRepo.getProfile(input.userId);

      return {
        blockId: block.id,
        displayName: isFriend && profile ? profile.displayName : null,
        avatarPreset: isFriend && profile ? profile.avatarPreset : null,
        createdAt: block.created_at.toISOString(),
      };
    }

    if (input.photoId) {
      const photo = await this.repo.getById(input.photoId);
      if (!photo || photo.owner_id === null) {
        throw new AppError('photo_not_found', 'Photo not found');
      }
      if (photo.owner_id === blockerId) {
        throw new AppError('validation_failed', 'Cannot block uploader of your own photo');
      }

      // Visibility check
      if (photo.status !== 'approved') {
        throw new AppError('photo_not_found', 'Photo not found');
      }
      const isBlocked = await this.reportsRepo.isBlockedEitherWay(blockerId, photo.owner_id);
      if (isBlocked) {
        throw new AppError('photo_not_found', 'Photo not found');
      }

      if (photo.target_kind === 'trip') {
        if (input.shareId) {
          if (!this.recapShareGate || !this.recapPhotoPort) {
            throw new AppError('photo_not_found', 'Share access unavailable');
          }
          const access = await this.recapShareGate.resolve(input.shareId, blockerId);
          if (!access) {
            throw new AppError('photo_not_found', 'Share not found or expired');
          }
          const isAlbumPhoto = await this.recapPhotoPort.isAlbumPhoto(access, blockerId, input.photoId);
          if (!isAlbumPhoto) {
            throw new AppError('photo_not_found', 'Photo is not available through this share');
          }
        } else {
          const adapter = this.getTargetAdapter('trip');
          const canView = await adapter.canViewScope(blockerId, photo.scope_id);
          if (!canView) {
            throw new AppError('photo_not_found', 'Trip photo not accessible');
          }
        }
      }

      const targetUserId = photo.owner_id;
      const block = await this.reportsRepo.addBlock(blockerId, targetUserId);
      const friendSet = await this.repo.friendIdsAmong(blockerId, [targetUserId]);
      const isFriend = friendSet.has(targetUserId);
      const profile = await this.reportsRepo.getProfile(targetUserId);

      return {
        blockId: block.id,
        displayName: isFriend && profile ? profile.displayName : null,
        avatarPreset: isFriend && profile ? profile.avatarPreset : null,
        createdAt: block.created_at.toISOString(),
      };
    }

    throw new AppError('validation_failed', 'Must provide userId or photoId');
  }

  async removeBlock(blockerId: string, blockId: string): Promise<boolean> {
    return this.reportsRepo.removeBlockById(blockerId, blockId);
  }

  async listBlocks(userId: string): Promise<readonly BlockedUserDTO[]> {
    const blocks = await this.reportsRepo.listBlocks(userId);
    if (blocks.length === 0) return [];

    const blockedIds = blocks.map((b) => b.blocked_id);
    const friendSet = await this.repo.friendIdsAmong(userId, blockedIds);

    return blocks.map((b) => ({
      blockId: b.id,
      displayName: friendSet.has(b.blocked_id) ? b.display_name : null,
      avatarPreset: friendSet.has(b.blocked_id) ? b.avatar_preset : null,
      createdAt: b.created_at.toISOString(),
    }));
  }

  async listFoodGallery(
    viewerId: string,
    params: {
      readonly scopeId: string;
      readonly cursor?: string | undefined;
      readonly limit?: number | undefined;
    }
  ): Promise<PhotoPageDTO<FoodPhotoDTO>> {
    const limit = params.limit ?? 40;
    let decodedCursor: { createdAt: Date; id: string } | undefined;
    if (params.cursor) {
      const decoded = decodeAlbumCursor(params.cursor);
      if (!decoded) {
        throw new AppError('validation_failed', 'Invalid cursor');
      }
      decodedCursor = { createdAt: decoded.sortAt, id: decoded.id };
    }

    const rows = await this.repo.listFoodByScope({
      scopeId: params.scopeId,
      viewerId,
      limit: limit + 1,
      ...(decodedCursor ? { cursor: decodedCursor } : {}),
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const ownerIds = Array.from(
      new Set(pageRows.map((r) => r.owner_id).filter((id): id is string => id !== null))
    );
    const friendSet = await this.repo.friendIdsAmong(viewerId, ownerIds);

    const items: FoodPhotoDTO[] = [];
    for (const row of pageRows) {
      const { url: fullUrl, thumbUrl } = await this.presignServedPair(row.id);

      const uploader = bylineFor({
        viewerId,
        ownerId: row.owner_id,
        friendIds: friendSet,
        profile: row.display_name
          ? { displayName: row.display_name, avatarPreset: row.avatar_preset }
          : null,
      });

      items.push({
        id: row.id,
        foodItemId: row.scope_id,
        thumbUrl,
        url: fullUrl,
        width: row.width,
        height: row.height,
        createdDay: wdwToday(row.created_at),
        uploader,
        mine: row.owner_id === viewerId,
      });
    }

    let nextCursor: string | null = null;
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1]!;
      nextCursor = encodeAlbumCursor({ sortAt: last.created_at, id: last.id });
    }

    return { items, nextCursor };
  }

  async listRestaurantFoodGallery(
    viewerId: string,
    params: {
      readonly experienceId?: string | undefined;
      readonly locationId?: string | undefined;
      readonly cursor?: string | undefined;
      readonly limit?: number | undefined;
    }
  ): Promise<PhotoPageDTO<RestaurantFoodPhotoDTO>> {
    const limit = params.limit ?? 40;
    let decodedCursor: { createdAt: Date; id: string } | undefined;
    if (params.cursor) {
      const decoded = decodeAlbumCursor(params.cursor);
      if (!decoded) {
        throw new AppError('validation_failed', 'Invalid cursor');
      }
      decodedCursor = { createdAt: decoded.sortAt, id: decoded.id };
    }

    let rows: readonly {
      readonly id: string;
      readonly scope_id: string;
      readonly width: number;
      readonly height: number;
      readonly created_at: Date;
      readonly owner_id: string | null;
      readonly display_name: string | null;
      readonly avatar_preset: string | null;
      readonly food_item_name?: string | null;
    }[];

    if (params.experienceId) {
      rows = await this.repo.listFoodByExperience({
        experienceId: params.experienceId,
        viewerId,
        limit: limit + 1,
        ...(decodedCursor ? { cursor: decodedCursor } : {}),
      });
    } else if (params.locationId) {
      rows = await this.repo.listFoodByLocation({
        locationId: params.locationId,
        viewerId,
        limit: limit + 1,
        ...(decodedCursor ? { cursor: decodedCursor } : {}),
      });
    } else {
      throw new AppError('validation_failed', 'Either experienceId or locationId must be provided');
    }

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const ownerIds = Array.from(
      new Set(pageRows.map((r) => r.owner_id).filter((id): id is string => id !== null))
    );
    const friendSet = await this.repo.friendIdsAmong(viewerId, ownerIds);

    const items: RestaurantFoodPhotoDTO[] = [];
    for (const row of pageRows) {
      const { url: fullUrl, thumbUrl } = await this.presignServedPair(row.id);

      const uploader = bylineFor({
        viewerId,
        ownerId: row.owner_id,
        friendIds: friendSet,
        profile: row.display_name
          ? { displayName: row.display_name, avatarPreset: row.avatar_preset }
          : null,
      });

      items.push({
        id: row.id,
        foodItemId: row.scope_id,
        foodItemName: row.food_item_name ?? '',
        thumbUrl,
        url: fullUrl,
        width: row.width,
        height: row.height,
        createdDay: wdwToday(row.created_at),
        uploader,
        mine: row.owner_id === viewerId,
      });
    }

    let nextCursor: string | null = null;
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1]!;
      nextCursor = encodeAlbumCursor({ sortAt: last.created_at, id: last.id });
    }

    return { items, nextCursor };
  }

  async getClientConfig(userId?: string): Promise<PhotoClientConfigDTO> {
    const now = this.clock.now();
    const day = dayKey(now);

    let remainingToday = 0;
    if (this.config.enabled) {
      const globalUsed = await this.repo.getGlobalDailyUploadCount(day);
      const globalRemaining = Math.max(0, this.config.globalDailyCap - globalUsed);

      let userRemaining = this.config.dailyUploadCap;
      if (userId) {
        const userUsed = await this.repo.getUserDailyUploadCount(userId, day);
        userRemaining = Math.max(0, this.config.dailyUploadCap - userUsed);
      }

      remainingToday = Math.min(userRemaining, globalRemaining);
    }

    return {
      enabled: this.config.enabled,
      foodEnabled: this.config.foodEnabled,
      tripEnabled: this.config.tripEnabled,
      maxPerFoodLog: this.config.maxPerFoodLog,
      maxPerTrip: this.config.maxPerTrip,
      maxFeedPostPhotos: this.config.maxFeedPostPhotos,
      maxBatch: this.config.maxBatch,
      maxBytes: this.config.maxBytes,
      maxThumbBytes: this.config.maxThumbBytes,
      dailyCap: this.config.dailyUploadCap,
      remainingToday,
      experienceStripMax: this.config.experienceStripMax,
    };
  }

  async getTripAlbum(
    viewerId: string,
    tripId: string,
    params: {
      readonly cursor?: string | undefined;
      readonly limit?: number | undefined;
      readonly summary?: boolean | undefined;
    }
  ): Promise<PhotoPageDTO<TripPhotoDTO> | PhotoPageDTO<SharedSummaryPhotoDTO>> {
    if (params.summary) {
      const candidates = await this.repo.listTripApprovedHighlights(tripId, viewerId);
      const mapped = candidates.map((c) => ({
        ...c,
        sortAt: c.sort_at,
      }));
      const selected = selectRecapHighlights(mapped, this.config.recapHighlightMax);
      const items: SharedSummaryPhotoDTO[] = await Promise.all(
        selected.map(async (photo) => {
          const { url, thumbUrl } = await this.presignServedPair(photo.id);
          return {
            id: photo.id,
            thumbUrl,
            url,
            width: photo.width,
            height: photo.height,
            sortAt: photo.sortAt.toISOString(),
            mine: photo.owner_id === viewerId,
          };
        })
      );
      return { items, nextCursor: null };
    }

    const limit = params.limit ?? 40;
    let decodedCursor: { sortAt: Date; id: string } | undefined;
    if (params.cursor) {
      const decoded = decodeAlbumCursor(params.cursor);
      if (!decoded) {
        throw new AppError('validation_failed', 'Invalid cursor');
      }
      decodedCursor = decoded;
    }

    const rows = await this.repo.listTripPhotos({
      tripId,
      viewerId,
      limit: limit + 1,
      ...(decodedCursor ? { cursor: decodedCursor } : {}),
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const items: TripPhotoDTO[] = [];
    for (const row of pageRows) {
      const isMine = row.owner_id === viewerId;
      const keys = readKeysFor(
        { status: row.status, viewer: isMine ? 'owner' : 'other' },
        row.id
      );

      let url: string | null = null;
      let thumbUrl: string | null = null;

      if (keys.full) {
        url = await this.objectStore.presignGet({
          key: keys.full,
          expiresInSeconds: this.config.getUrlTtlSeconds,
        });
      }
      if (keys.thumb) {
        thumbUrl = await this.objectStore.presignGet({
          key: keys.thumb,
          expiresInSeconds: this.config.getUrlTtlSeconds,
        });
      } else if (keys.uploadThumb) {
        thumbUrl = await this.objectStore.presignGet({
          key: keys.uploadThumb,
          expiresInSeconds: this.config.getUrlTtlSeconds,
        });
      }

      items.push({
        id: row.id,
        tripId: row.target_id,
        thumbUrl,
        url,
        width: row.width,
        height: row.height,
        sortAt: row.sort_at.toISOString(),
        createdAt: row.created_at.toISOString(),
        uploader: {
          userId: row.owner_id ?? '',
          displayName: row.uploader_display_name ?? 'Crew member',
          avatarPreset: row.uploader_avatar_preset,
        },
        mine: isMine,
        status: row.status,
        feedItemId: row.feed_item_id,
      });
    }

    let nextCursor: string | null = null;
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1]!;
      nextCursor = encodeAlbumCursor({ sortAt: last.sort_at, id: last.id });
    }

    return { items, nextCursor };
  }

  async deleteAllForUser(userId: string, opts?: { limit?: number }): Promise<readonly string[]> {
    return this.repo.softDeleteByOwner(userId, this.clock.now(), undefined, opts?.limit);
  }

  async softDeleteForTarget(kind: PhotoTargetKind, targetId: string): Promise<readonly string[]> {
    return this.repo.softDeleteByTarget(kind, targetId, this.clock.now());
  }

  /**
   * Presigns the serving objects `p/<id>/full.jpg` and `p/<id>/thumb.jpg` for an APPROVED
   * photo. The keys come from the photo id (`photoKeys`), never from the row's
   * `object_key` / `thumb_key` columns: those keep the `u/` upload keys forever, and the
   * upload objects are deleted once the photo is approved and copied to `p/`.
   */
  private async presignServedPair(
    photoId: string
  ): Promise<{ readonly url: string; readonly thumbUrl: string }> {
    const keys = photoKeys(photoId);
    const [url, thumbUrl] = await Promise.all([
      this.objectStore.presignGet({ key: keys.full, expiresInSeconds: this.config.getUrlTtlSeconds }),
      this.objectStore.presignGet({ key: keys.thumb, expiresInSeconds: this.config.getUrlTtlSeconds }),
    ]);
    return { url, thumbUrl };
  }

  private async mapToMyPhotoDTO(
    photo: Pick<
      PhotoRow,
      | 'id'
      | 'status'
      | 'target_kind'
      | 'target_id'
      | 'scope_id'
      | 'reject_reason'
      | 'width'
      | 'height'
      | 'feed_item_id'
      | 'created_at'
    >
  ): Promise<MyPhotoDTO> {
    const keys = readKeysFor({ status: photo.status, viewer: 'owner' }, photo.id);
    let url: string | null = null;
    let thumbUrl: string | null = null;

    if (keys.full) {
      url = await this.objectStore.presignGet({
        key: keys.full,
        expiresInSeconds: this.config.getUrlTtlSeconds,
      });
    }
    if (keys.thumb) {
      thumbUrl = await this.objectStore.presignGet({
        key: keys.thumb,
        expiresInSeconds: this.config.getUrlTtlSeconds,
      });
    } else if (keys.uploadThumb) {
      thumbUrl = await this.objectStore.presignGet({
        key: keys.uploadThumb,
        expiresInSeconds: this.config.getUrlTtlSeconds,
      });
    }

    return {
      id: photo.id,
      targetKind: photo.target_kind,
      targetId: photo.target_id,
      scopeId: photo.scope_id,
      status: photo.status,
      rejectReason: photo.reject_reason,
      rejectMessage: photo.reject_reason
        ? PHOTO_REJECT_MESSAGES[photo.reject_reason] ?? null
        : null,
      thumbUrl,
      url,
      width: photo.width,
      height: photo.height,
      feedItemId: photo.feed_item_id,
      createdAt: photo.created_at.toISOString(),
    };
  }
}
