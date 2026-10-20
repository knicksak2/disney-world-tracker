import { describe, it, expect, vi } from 'vitest';
import { R2ObjectStore } from '../r2ObjectStore.js';
import { S3Client } from '@aws-sdk/client-s3';
import { ObjectMissingError, ObjectTooLargeError } from '../../ports.js';

describe('R2ObjectStore adapter', () => {
  const options = {
    endpoint: 'https://test-account.r2.cloudflarestorage.com',
    bucket: 'test-bucket',
    accessKeyId: 'test-access-key-id',
    secretAccessKey: 'test-secret-access-key',
  };

  it('presignPut and presignGet generate distinct URLs, assert signed headers and expiry, and reject non-upload keys', async () => {
    const store = new R2ObjectStore(options);

    const putUrl = await store.presignPut({
      key: 'u/photo-123/full.jpg',
      contentLength: 54321,
      expiresInSeconds: 900,
    });

    const parsedPut = new URL(putUrl);
    expect(parsedPut.hostname).toBe('test-account.r2.cloudflarestorage.com');
    expect(parsedPut.pathname).toContain('u/photo-123/full.jpg');
    expect(parsedPut.searchParams.get('X-Amz-Expires')).toBe('900');

    // Requirement 3.11: X-Amz-SignedHeaders check
    const signedHeaders = parsedPut.searchParams.get('X-Amz-SignedHeaders') ?? '';
    expect(signedHeaders).toContain('content-type');
    expect(signedHeaders).toContain('content-length');

    const getUrl = await store.presignGet({
      key: 'p/photo-123/full.jpg',
      expiresInSeconds: 3600,
    });
    const parsedGet = new URL(getUrl);
    expect(parsedGet.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(putUrl).not.toBe(getUrl);

    // presignPut throws for non-upload keys
    await expect(
      store.presignPut({
        key: 'p/photo-123/full.jpg',
        contentLength: 100,
        expiresInSeconds: 300,
      })
    ).rejects.toThrow(/refused for non-upload key/);
  });

  it('HEAD returns etag and maps 404 to exists: false', async () => {
    const mockClient = new S3Client({
      region: 'auto',
      endpoint: options.endpoint,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });

    const sendSpy = vi.spyOn(mockClient, 'send');

    // 1. Existing object
    sendSpy.mockResolvedValueOnce({
      ContentType: 'image/jpeg',
      ContentLength: 1024,
      ETag: '"etag-123"',
    } as any);

    const store = new R2ObjectStore({ ...options, s3Client: mockClient });
    const head1 = await store.head('u/photo-1/full.jpg');
    expect(head1).toEqual({
      exists: true,
      contentType: 'image/jpeg',
      contentLength: 1024,
      etag: '"etag-123"',
    });

    // 2. 404 NotFound
    const notFoundErr = new Error('NotFound');
    (notFoundErr as any).name = 'NotFound';
    (notFoundErr as any).$metadata = { httpStatusCode: 404 };
    sendSpy.mockRejectedValueOnce(notFoundErr);

    const head2 = await store.head('u/photo-missing/full.jpg');
    expect(head2).toEqual({ exists: false });
  });

  it('getBytes returns bytes and ETag, throws ObjectTooLargeError past maxBytes, and ObjectMissingError on 404', async () => {
    const mockClient = new S3Client({
      region: 'auto',
      endpoint: options.endpoint,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
    const sendSpy = vi.spyOn(mockClient, 'send');
    const store = new R2ObjectStore({ ...options, s3Client: mockClient });

    // 1. Success
    const sampleBytes = new Uint8Array([1, 2, 3, 4]);
    sendSpy.mockResolvedValueOnce({
      ETag: '"etag-456"',
      Body: {
        transformToByteArray: async () => sampleBytes,
      },
    } as any);

    const res = await store.getBytes('u/photo-1/full.jpg', 10);
    expect(res.bytes).toEqual(sampleBytes);
    expect(res.etag).toBe('"etag-456"');

    // 2. Too large
    sendSpy.mockResolvedValueOnce({
      ETag: '"etag-456"',
      Body: {
        transformToByteArray: async () => sampleBytes,
      },
    } as any);
    await expect(store.getBytes('u/photo-1/full.jpg', 3)).rejects.toThrow(ObjectTooLargeError);

    // 3. NoSuchKey / 404
    const noSuchKeyErr = new Error('NoSuchKey');
    (noSuchKeyErr as any).name = 'NoSuchKey';
    (noSuchKeyErr as any).$metadata = { httpStatusCode: 404 };
    sendSpy.mockRejectedValueOnce(noSuchKeyErr);
    await expect(store.getBytes('u/missing/full.jpg', 1000)).rejects.toThrow(ObjectMissingError);
  });

  it('copy handles success, source_changed (412 or destination mismatch), source_missing, and retryable errors', async () => {
    const mockClient = new S3Client({
      region: 'auto',
      endpoint: options.endpoint,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
    const sendSpy = vi.spyOn(mockClient, 'send');
    const store = new R2ObjectStore({ ...options, s3Client: mockClient });

    // 1. Success: copy succeeds and destination head matches expected ETag
    sendSpy.mockResolvedValueOnce({} as any); // CopyObjectCommand
    sendSpy.mockResolvedValueOnce({ ETag: '"valid-etag"', ContentLength: 50, ContentType: 'image/jpeg' } as any); // HeadObjectCommand
    const outcome1 = await store.copy({
      srcKey: 'u/photo-1/full.jpg',
      dstKey: 'p/photo-1/full.jpg',
      expectedEtag: '"valid-etag"',
    });
    expect(outcome1).toEqual({ kind: 'ok', etag: '"valid-etag"' });

    // 2. 412 PreconditionFailed -> source_changed
    const precFailedErr = new Error('PreconditionFailed');
    (precFailedErr as any).name = 'PreconditionFailed';
    (precFailedErr as any).$metadata = { httpStatusCode: 412 };
    sendSpy.mockRejectedValueOnce(precFailedErr);
    const outcome2 = await store.copy({
      srcKey: 'u/photo-1/full.jpg',
      dstKey: 'p/photo-1/full.jpg',
      expectedEtag: '"valid-etag"',
    });
    expect(outcome2).toEqual({ kind: 'source_changed' });

    // 3. 404 source missing -> source_missing
    const missingErr = new Error('NotFound');
    (missingErr as any).name = 'NotFound';
    (missingErr as any).$metadata = { httpStatusCode: 404 };
    sendSpy.mockRejectedValueOnce(missingErr);
    const outcome3 = await store.copy({
      srcKey: 'u/photo-1/full.jpg',
      dstKey: 'p/photo-1/full.jpg',
      expectedEtag: '"valid-etag"',
    });
    expect(outcome3).toEqual({ kind: 'source_missing' });

    // 4. Destination ETag mismatch after copy: deletes destination and returns source_changed
    sendSpy.mockResolvedValueOnce({} as any); // CopyObjectCommand succeeds
    sendSpy.mockResolvedValueOnce({ ETag: '"different-etag"', ContentLength: 50, ContentType: 'image/jpeg' } as any); // HeadObjectCommand returns different
    sendSpy.mockResolvedValueOnce({} as any); // DeleteObjectsCommand called
    const outcome4 = await store.copy({
      srcKey: 'u/photo-1/full.jpg',
      dstKey: 'p/photo-1/full.jpg',
      expectedEtag: '"valid-etag"',
    });
    expect(outcome4).toEqual({ kind: 'source_changed' });

    // 5. Transient error -> retryable
    const transientErr = new Error('ServiceUnavailable');
    (transientErr as any).name = 'ServiceUnavailable';
    sendSpy.mockRejectedValueOnce(transientErr);
    const outcome5 = await store.copy({
      srcKey: 'u/photo-1/full.jpg',
      dstKey: 'p/photo-1/full.jpg',
      expectedEtag: '"valid-etag"',
    });
    expect(outcome5).toEqual({ kind: 'retryable', code: 'ServiceUnavailable' });
  });

  it('delete succeeds for absent keys and sanitizes credentials on errors', async () => {
    const mockClient = new S3Client({
      region: 'auto',
      endpoint: options.endpoint,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
    const sendSpy = vi.spyOn(mockClient, 'send');
    const store = new R2ObjectStore({ ...options, s3Client: mockClient });

    // Empty keys array is no-op
    await store.delete([]);
    expect(sendSpy).not.toHaveBeenCalled();

    // 404 treated as success
    const notFoundErr = new Error('NotFound');
    (notFoundErr as any).name = 'NotFound';
    sendSpy.mockRejectedValueOnce(notFoundErr);
    await expect(store.delete(['u/absent.jpg'])).resolves.toBeUndefined();

    // Sensitive error message is sanitized
    const credError = new Error('Connection failed for accessKeyId=test-access-key-id and secretAccessKey=test-secret-access-key');
    (credError as any).name = 'InternalError';
    sendSpy.mockRejectedValueOnce(credError);
    await expect(store.delete(['u/item.jpg'])).rejects.toThrow(/accessKeyId=REDACTED/);
  });
});
