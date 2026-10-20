import crypto from 'node:crypto';
import {
  type ObjectStore,
  type CopyOutcome,
  type HarmModerator,
  type HarmOutcome,
  type VisionChecker,
  type VisionOutcome,
  type Clock,
  type Scheduler,
  type TargetAdapter,
  ObjectMissingError,
  ObjectTooLargeError,
} from '../ports.js';
import { type PhotoTargetKind } from '@dwt/shared';

export function computeFakeEtag(bytes: Uint8Array): string {
  return `"${crypto.createHash('sha256').update(bytes).digest('hex')}"`;
}

export interface StoredObject {
  bytes: Uint8Array;
  etag: string;
  contentType: string;
}

export type StoreStepHook = (step: string, context?: unknown) => Promise<void> | void;

export class FakeObjectStore implements ObjectStore {
  readonly objects = new Map<string, StoredObject>();
  readonly presignedPuts: Array<{ key: string; contentLength: number; expiresInSeconds: number }> = [];
  readonly presignedGets: Array<{ key: string; expiresInSeconds: number }> = [];
  readonly deletedKeys: string[] = [];
  stepHook?: StoreStepHook;

  put(key: string, bytes: Uint8Array, contentType = 'image/jpeg'): StoredObject {
    const etag = computeFakeEtag(bytes);
    const obj: StoredObject = { bytes, etag, contentType };
    this.objects.set(key, obj);
    return obj;
  }

  overwrite(key: string, bytes: Uint8Array): StoredObject {
    return this.put(key, bytes);
  }

  async presignPut(i: { key: string; contentLength: number; expiresInSeconds: number }): Promise<string> {
    if (!i.key.startsWith('u/')) {
      throw new Error(`presignPut refused for non-upload key: ${i.key}`);
    }
    this.presignedPuts.push(i);
    return `https://fake-r2.invalid/${i.key}?signed=true&expires=${i.expiresInSeconds}`;
  }

  async presignGet(i: { key: string; expiresInSeconds: number }): Promise<string> {
    this.presignedGets.push(i);
    return `https://fake-r2.invalid/${i.key}?get=true&expires=${i.expiresInSeconds}`;
  }

  /** Every key a presignGet was minted for, in call order. */
  mintedGetKeys(): string[] {
    return this.presignedGets.map((g) => g.key);
  }

  /** Minted GET keys that do not exist in the store (a URL that would 404 in production). */
  missingGetKeys(): string[] {
    return this.mintedGetKeys().filter((key) => !this.objects.has(key));
  }

  /** Extracts the object key from a URL minted by `presignGet`. */
  static keyFromUrl(url: string): string {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\//, '');
  }

  async head(key: string): Promise<
    | { exists: false }
    | { exists: true; contentType: string | null; contentLength: number; etag: string }
  > {
    const obj = this.objects.get(key);
    if (!obj) {
      return { exists: false };
    }
    return {
      exists: true,
      contentType: obj.contentType,
      contentLength: obj.bytes.length,
      etag: obj.etag,
    };
  }

  async getBytes(key: string, maxBytes: number): Promise<{ bytes: Uint8Array; etag: string }> {
    const obj = this.objects.get(key);
    if (!obj) {
      throw new ObjectMissingError(`Object not found: ${key}`);
    }
    if (obj.bytes.length > maxBytes) {
      throw new ObjectTooLargeError(`Object size ${obj.bytes.length} exceeds limit ${maxBytes}`);
    }
    return { bytes: obj.bytes, etag: obj.etag };
  }

  async copy(i: { srcKey: string; dstKey: string; expectedEtag: string }): Promise<CopyOutcome> {
    if (this.stepHook) {
      await this.stepHook('before_copy', i);
    }

    const src = this.objects.get(i.srcKey);
    if (!src) {
      return { kind: 'source_missing' };
    }

    if (src.etag !== i.expectedEtag) {
      return { kind: 'source_changed' };
    }

    if (this.stepHook) {
      await this.stepHook('during_copy', i);
    }

    const copied: StoredObject = {
      bytes: new Uint8Array(src.bytes),
      etag: src.etag,
      contentType: src.contentType,
    };
    this.objects.set(i.dstKey, copied);

    if (this.stepHook) {
      await this.stepHook('after_copy', i);
    }

    return { kind: 'ok', etag: copied.etag };
  }

  async delete(keys: readonly string[]): Promise<void> {
    for (const key of keys) {
      this.deletedKeys.push(key);
      this.objects.delete(key);
    }
  }
}

export class FakeHarmModerator implements HarmModerator {
  readonly calls: Uint8Array[] = [];
  private queuedOutcomes: HarmOutcome[] = [];
  checkFn?: (jpeg: Uint8Array) => Promise<HarmOutcome> | HarmOutcome;

  queueOutcome(outcome: HarmOutcome): void {
    this.queuedOutcomes.push(outcome);
  }

  async check(jpeg: Uint8Array): Promise<HarmOutcome> {
    this.calls.push(jpeg);
    if (this.checkFn) {
      return this.checkFn(jpeg);
    }
    if (this.queuedOutcomes.length > 0) {
      return this.queuedOutcomes.shift()!;
    }
    return {
      kind: 'ok',
      flagged: false,
      categories: {},
      categoryScores: {},
    };
  }
}

export class FakeVisionChecker implements VisionChecker {
  readonly calls: Uint8Array[] = [];
  private queuedOutcomes: VisionOutcome[] = [];
  checkFn?: (jpeg: Uint8Array) => Promise<VisionOutcome> | VisionOutcome;

  queueOutcome(outcome: VisionOutcome): void {
    this.queuedOutcomes.push(outcome);
  }

  async check(jpeg: Uint8Array): Promise<VisionOutcome> {
    this.calls.push(jpeg);
    if (this.checkFn) {
      return this.checkFn(jpeg);
    }
    if (this.queuedOutcomes.length > 0) {
      return this.queuedOutcomes.shift()!;
    }
    return {
      kind: 'ok',
      fields: {
        description: 'Test dish photo',
        isFoodOrDrink: true,
        foodConfidence: 0.95,
        prominentFaceCount: 0,
        minorFaceVisible: false,
        anyPersonPartVisible: false,
        largeText: false,
        textFraction: 0.05,
        textSeen: '',
      },
      usage: {
        promptTokens: 1200,
        outputTokens: 150,
      },
    };
  }
}

export class FakeClock implements Clock {
  private currentTime: Date;

  constructor(initial: Date = new Date('2025-06-01T12:00:00Z')) {
    this.currentTime = new Date(initial);
  }

  now(): Date {
    return new Date(this.currentTime);
  }

  set(time: Date): void {
    this.currentTime = new Date(time);
  }

  advance(ms: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + ms);
  }
}

export class SyncScheduler implements Scheduler {
  run(job: () => Promise<void>): void {
    void job();
  }
}

export class FakeTargetAdapter implements TargetAdapter {
  readonly kind: PhotoTargetKind;
  readonly screen: 'harm_and_vision' | 'harm_only';
  readonly maxPerTarget: number;
  enabled = true;

  authorizeFn?: (userId: string, targetId: string) => Promise<{ scopeId: string }>;
  canViewScopeFn?: (viewerId: string, scopeId: string) => Promise<boolean>;
  canDeleteOthersFn?: (userId: string, scopeId: string) => Promise<boolean>;
  findOrphansFn?: (limit: number) => Promise<readonly string[]>;

  constructor(
    kind: PhotoTargetKind = 'food_log',
    screen: 'harm_and_vision' | 'harm_only' = 'harm_and_vision',
    maxPerTarget = 4
  ) {
    this.kind = kind;
    this.screen = screen;
    this.maxPerTarget = maxPerTarget;
  }

  async authorizeUpload(userId: string, targetId: string): Promise<{ scopeId: string }> {
    if (this.authorizeFn) {
      return this.authorizeFn(userId, targetId);
    }
    return { scopeId: `scope-${targetId}` };
  }

  async canViewScope(viewerId: string, scopeId: string): Promise<boolean> {
    if (this.canViewScopeFn) {
      return this.canViewScopeFn(viewerId, scopeId);
    }
    return true;
  }

  async canDeleteOthers(userId: string, scopeId: string): Promise<boolean> {
    if (this.canDeleteOthersFn) {
      return this.canDeleteOthersFn(userId, scopeId);
    }
    return false;
  }

  async findOrphanPhotoIds(limit: number): Promise<readonly string[]> {
    if (this.findOrphansFn) {
      return this.findOrphansFn(limit);
    }
    return [];
  }
}
