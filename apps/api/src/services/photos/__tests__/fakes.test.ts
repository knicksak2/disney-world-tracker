import { describe, it, expect } from 'vitest';
import { FakeObjectStore } from './fakes.js';
import { ObjectMissingError, ObjectTooLargeError } from '../ports.js';

describe('FakeObjectStore self-test', () => {
  it('overwrite changes the ETag', () => {
    const store = new FakeObjectStore();
    const bytes1 = new Uint8Array([1, 2, 3]);
    const bytes2 = new Uint8Array([4, 5, 6]);

    const obj1 = store.put('u/test/full.jpg', bytes1);
    const initialEtag = obj1.etag;

    const obj2 = store.overwrite('u/test/full.jpg', bytes2);
    expect(obj2.etag).not.toBe(initialEtag);
  });

  it('copy with a stale ETag returns source_changed', async () => {
    const store = new FakeObjectStore();
    const bytes = new Uint8Array([1, 2, 3]);
    store.put('u/test/full.jpg', bytes);

    const outcome = await store.copy({
      srcKey: 'u/test/full.jpg',
      dstKey: 'p/test/full.jpg',
      expectedEtag: '"wrong-etag"',
    });
    expect(outcome).toEqual({ kind: 'source_changed' });
  });

  it('copy of a deleted or absent source returns source_missing', async () => {
    const store = new FakeObjectStore();

    const outcome = await store.copy({
      srcKey: 'u/missing/full.jpg',
      dstKey: 'p/missing/full.jpg',
      expectedEtag: '"some-etag"',
    });
    expect(outcome).toEqual({ kind: 'source_missing' });
  });

  it('getBytes of a deleted or absent key throws ObjectMissingError', async () => {
    const store = new FakeObjectStore();
    store.put('u/test/full.jpg', new Uint8Array([1]));
    await store.delete(['u/test/full.jpg']);

    await expect(store.getBytes('u/test/full.jpg', 1000)).rejects.toThrow(ObjectMissingError);
  });

  it('getBytes past maxBytes throws ObjectTooLargeError', async () => {
    const store = new FakeObjectStore();
    store.put('u/test/full.jpg', new Uint8Array([1, 2, 3, 4, 5]));

    await expect(store.getBytes('u/test/full.jpg', 4)).rejects.toThrow(ObjectTooLargeError);
  });

  it('presignPut records the request and rejects non-upload keys', async () => {
    const store = new FakeObjectStore();

    const putUrl = await store.presignPut({
      key: 'u/photo-1/full.jpg',
      contentLength: 12345,
      expiresInSeconds: 900,
    });
    expect(putUrl).toContain('u/photo-1/full.jpg');
    expect(store.presignedPuts).toEqual([
      {
        key: 'u/photo-1/full.jpg',
        contentLength: 12345,
        expiresInSeconds: 900,
      },
    ]);

    await expect(
      store.presignPut({
        key: 'p/photo-1/full.jpg',
        contentLength: 100,
        expiresInSeconds: 300,
      })
    ).rejects.toThrow(/refused for non-upload key/);
  });

  it('successful copy duplicates object and preserves ETag', async () => {
    const store = new FakeObjectStore();
    const bytes = new Uint8Array([10, 20, 30]);
    const original = store.put('u/photo-1/full.jpg', bytes);

    const outcome = await store.copy({
      srcKey: 'u/photo-1/full.jpg',
      dstKey: 'p/photo-1/full.jpg',
      expectedEtag: original.etag,
    });
    expect(outcome).toEqual({ kind: 'ok', etag: original.etag });

    const head = await store.head('p/photo-1/full.jpg');
    expect(head.exists).toBe(true);
    if (head.exists) {
      expect(head.etag).toBe(original.etag);
      expect(head.contentLength).toBe(3);
    }
  });
});
