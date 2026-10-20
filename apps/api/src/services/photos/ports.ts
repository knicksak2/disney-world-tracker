import {
  type PhotoTargetKind,
  type TripPostPhotoSlotDTO,
} from '@dwt/shared';
import { type VisionFields } from './domain/visionVerdict.js';

export type CopyOutcome =
  | { kind: 'ok'; etag: string }
  | { kind: 'source_missing' }
  | { kind: 'source_changed' }
  | { kind: 'retryable'; code: string };

export class ObjectTooLargeError extends Error {
  constructor(message = 'Object exceeds maximum permitted size') {
    super(message);
    this.name = 'ObjectTooLargeError';
  }
}

export class ObjectMissingError extends Error {
  constructor(message = 'Object does not exist') {
    super(message);
    this.name = 'ObjectMissingError';
  }
}

export interface ObjectStore {
  presignPut(i: { key: string; contentLength: number; expiresInSeconds: number }): Promise<string>;
  presignGet(i: { key: string; expiresInSeconds: number }): Promise<string>;
  head(key: string): Promise<
    | { exists: false }
    | { exists: true; contentType: string | null; contentLength: number; etag: string }
  >;
  getBytes(key: string, maxBytes: number): Promise<{ bytes: Uint8Array; etag: string }>;
  copy(i: { srcKey: string; dstKey: string; expectedEtag: string }): Promise<CopyOutcome>;
  delete(keys: readonly string[]): Promise<void>;
}

export type HarmOutcome =
  | { kind: 'ok'; flagged: boolean; categories: Record<string, boolean>; categoryScores: Record<string, number> }
  | { kind: 'invalid_image' }
  | { kind: 'retryable'; code: string };

export interface HarmModerator {
  check(jpeg: Uint8Array): Promise<HarmOutcome>;
}

export type VisionOutcome =
  | { kind: 'ok'; fields: VisionFields; usage: { promptTokens: number; outputTokens: number } }
  | { kind: 'retryable'; code: string };

export interface VisionChecker {
  check(jpeg: Uint8Array): Promise<VisionOutcome>;
}

export interface Clock {
  now(): Date;
}

export interface Scheduler {
  run(job: () => Promise<void>): void;
}

export interface TargetAdapter {
  readonly kind: PhotoTargetKind;
  readonly screen: 'harm_and_vision' | 'harm_only';
  readonly maxPerTarget: number;
  readonly enabled: boolean;
  authorizeUpload(userId: string, targetId: string): Promise<{ scopeId: string }>;
  canViewScope(viewerId: string, scopeId: string): Promise<boolean>;
  canDeleteOthers(userId: string, scopeId: string): Promise<boolean>;
  findOrphanPhotoIds(limit: number): Promise<readonly string[]>;
}

export interface PhotoLifecyclePort {
  softDeleteForTarget(kind: PhotoTargetKind, targetId: string): Promise<readonly string[]>;
}

export interface FeedPostPhotos {
  authorId: string;
  slots: TripPostPhotoSlotDTO[];
}

export interface FeedPhotoPort {
  slotsForFeedItems(
    tripId: string,
    viewerId: string,
    feedItemIds: readonly string[]
  ): Promise<Map<string, FeedPostPhotos>>;
}
