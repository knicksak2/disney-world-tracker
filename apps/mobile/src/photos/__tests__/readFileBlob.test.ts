import { readFileAsBlob, READ_FILE_TIMEOUT_MS, type BlobXhr } from '../readFileBlob';

/** A controllable stand-in for React Native's XMLHttpRequest. */
class FakeXhr implements BlobXhr {
  responseType: XMLHttpRequestResponseType = '';
  timeout = 0;
  response: unknown = null;
  status = 0;
  onload: ((ev: ProgressEvent) => unknown) | null = null;
  onerror: ((ev: ProgressEvent) => unknown) | null = null;
  ontimeout: ((ev: ProgressEvent) => unknown) | null = null;
  openedWith: { method: string; url: string } | null = null;
  sent = false;

  open(method: string, url: string): void {
    this.openedWith = { method, url };
  }

  send(): void {
    this.sent = true;
  }

  fire(handler: ((ev: ProgressEvent) => unknown) | null): void {
    if (!handler) throw new Error('handler was not assigned before send');
    handler({} as ProgressEvent);
  }
}

describe('readFileAsBlob (Expo SDK 56 Response.blob() regression)', () => {
  it('requests the URI with GET and responseType "blob", and preserves the real byte size', async () => {
    const xhr = new FakeXhr();
    const promise = readFileAsBlob('file:///cache/full.jpg', () => xhr);

    expect(xhr.openedWith).toEqual({ method: 'GET', url: 'file:///cache/full.jpg' });
    expect(xhr.responseType).toBe('blob');
    expect(xhr.timeout).toBe(READ_FILE_TIMEOUT_MS);
    expect(xhr.sent).toBe(true);

    xhr.response = new Blob([new Uint8Array(54321)], { type: '' });
    xhr.status = 200;
    xhr.fire(xhr.onload);

    const blob = await promise;
    expect(blob.size).toBe(54321);
  });

  it('stamps image/jpeg on the blob even when the file response reports no type', async () => {
    const xhr = new FakeXhr();
    const promise = readFileAsBlob('file:///cache/thumb.jpg', () => xhr);

    xhr.response = new Blob([new Uint8Array(10)], { type: '' });
    xhr.status = 0; // local file reads can report status 0
    xhr.fire(xhr.onload);

    const blob = await promise;
    expect(blob.type).toBe('image/jpeg');
    expect(blob.size).toBe(10);
  });

  it('rejects with a clear error on xhr.onerror', async () => {
    const xhr = new FakeXhr();
    const promise = readFileAsBlob('file:///missing.jpg', () => xhr);
    xhr.fire(xhr.onerror);
    await expect(promise).rejects.toThrow(/Could not read photo file/);
  });

  it('rejects with a clear error on xhr.ontimeout', async () => {
    const xhr = new FakeXhr();
    const promise = readFileAsBlob('file:///slow.jpg', () => xhr);
    xhr.fire(xhr.ontimeout);
    await expect(promise).rejects.toThrow(/timed out/);
  });

  it('rejects on a non-2xx, non-0 status', async () => {
    const xhr = new FakeXhr();
    const promise = readFileAsBlob('file:///bad.jpg', () => xhr);
    xhr.response = new Blob([new Uint8Array(5)]);
    xhr.status = 404;
    xhr.fire(xhr.onload);
    await expect(promise).rejects.toThrow(/unexpected status 404/);
  });

  it('rejects when the response is not a Blob', async () => {
    const xhr = new FakeXhr();
    const promise = readFileAsBlob('file:///odd.jpg', () => xhr);
    xhr.response = 'not a blob';
    xhr.status = 200;
    xhr.fire(xhr.onload);
    await expect(promise).rejects.toThrow(/no data returned/);
  });

  it('rejects when the file is empty so a zero-byte upload is never declared', async () => {
    const xhr = new FakeXhr();
    const promise = readFileAsBlob('file:///empty.jpg', () => xhr);
    xhr.response = new Blob([]);
    xhr.status = 200;
    xhr.fire(xhr.onload);
    await expect(promise).rejects.toThrow(/file is empty/);
  });
});
