import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  type ObjectStore,
  type CopyOutcome,
  ObjectMissingError,
  ObjectTooLargeError,
} from '../ports.js';

export interface R2ObjectStoreOptions {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  s3Client?: S3Client;
}

export class R2ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: R2ObjectStoreOptions) {
    this.bucket = options.bucket;
    this.client =
      options.s3Client ??
      new S3Client({
        region: options.region ?? 'auto',
        endpoint: options.endpoint,
        forcePathStyle: true,
        credentials: {
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey,
        },
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
  }

  async presignPut(i: { key: string; contentLength: number; expiresInSeconds: number }): Promise<string> {
    if (!i.key.startsWith('u/')) {
      throw new Error(`presignPut refused for non-upload key: ${i.key}`);
    }
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: i.key,
      ContentType: 'image/jpeg',
      ContentLength: i.contentLength,
    });
    return getSignedUrl(this.client, command, {
      expiresIn: i.expiresInSeconds,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
  }

  async presignGet(i: { key: string; expiresInSeconds: number }): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: i.key,
    });
    return getSignedUrl(this.client, command, {
      expiresIn: i.expiresInSeconds,
    });
  }

  async head(key: string): Promise<
    | { exists: false }
    | { exists: true; contentType: string | null; contentLength: number; etag: string }
  > {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      return {
        exists: true,
        contentType: res.ContentType ?? null,
        contentLength: res.ContentLength ?? 0,
        etag: res.ETag ?? '',
      };
    } catch (err: unknown) {
      if (this.isNotFound(err)) {
        return { exists: false };
      }
      throw this.sanitizeError(err, 'Failed to HEAD object');
    }
  }

  async getBytes(key: string, maxBytes: number): Promise<{ bytes: Uint8Array; etag: string }> {
    let res;
    try {
      res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
    } catch (err: unknown) {
      if (this.isNotFound(err)) {
        throw new ObjectMissingError(`Object does not exist: ${key}`);
      }
      throw this.sanitizeError(err, 'Failed to get object');
    }

    if (!res.Body) {
      throw new ObjectMissingError(`Object body empty or missing: ${key}`);
    }

    let bytes: Uint8Array;
    try {
      bytes = await res.Body.transformToByteArray();
    } catch (err: unknown) {
      throw this.sanitizeError(err, 'Failed to read object stream');
    }

    if (bytes.length > maxBytes) {
      throw new ObjectTooLargeError(`Object size ${bytes.length} exceeds limit ${maxBytes}`);
    }

    return { bytes, etag: res.ETag ?? '' };
  }

  async copy(i: { srcKey: string; dstKey: string; expectedEtag: string }): Promise<CopyOutcome> {
    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          Key: i.dstKey,
          CopySource: `${this.bucket}/${i.srcKey}`,
          CopySourceIfMatch: i.expectedEtag,
        })
      );
    } catch (err: unknown) {
      if (this.isPreconditionFailed(err)) {
        return { kind: 'source_changed' };
      }
      if (this.isNotFound(err)) {
        return { kind: 'source_missing' };
      }
      const code = this.getErrorCode(err);
      return { kind: 'retryable', code: code || 'copy_failed' };
    }

    // Verify destination ETag after copy
    try {
      const destHead = await this.head(i.dstKey);
      if (!destHead.exists || destHead.etag !== i.expectedEtag) {
        // Destination mismatch: delete destination and return source_changed
        await this.delete([i.dstKey]);
        return { kind: 'source_changed' };
      }
      return { kind: 'ok', etag: destHead.etag };
    } catch (err: unknown) {
      const code = this.getErrorCode(err);
      return { kind: 'retryable', code: code || 'dest_head_failed' };
    }
  }

  async delete(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }
    try {
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: keys.map((Key) => ({ Key })),
            Quiet: true,
          },
        })
      );
    } catch (err: unknown) {
      // Absent keys count as success; if storage error, sanitize and throw
      if (!this.isNotFound(err)) {
        throw this.sanitizeError(err, 'Failed to delete objects');
      }
    }
  }

  private isNotFound(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    return (
      e.name === 'NotFound' ||
      e.name === 'NoSuchKey' ||
      e.$metadata?.httpStatusCode === 404
    );
  }

  private isPreconditionFailed(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    return (
      e.name === 'PreconditionFailed' ||
      e.$metadata?.httpStatusCode === 412
    );
  }

  private getErrorCode(err: unknown): string {
    if (!err || typeof err !== 'object') return 'storage_error';
    const e = err as { name?: string; code?: string };
    return e.code || e.name || 'storage_error';
  }

  private sanitizeError(err: unknown, fallbackMessage: string): Error {
    const message = err instanceof Error ? err.message : fallbackMessage;
    // Strip any possible credential or token from error message
    const sanitized = message
      .replace(/accessKeyId=[^& ]+/gi, 'accessKeyId=REDACTED')
      .replace(/secretAccessKey=[^& ]+/gi, 'secretAccessKey=REDACTED')
      .replace(/Authorization:[^, ]+/gi, 'Authorization: REDACTED');
    return new Error(sanitized);
  }
}
