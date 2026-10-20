import { manipulateAsync } from 'expo-image-manipulator';
import { prepareImage } from '../imagePrep.native';
import { buildInitiatePayload } from '../uploadPlan';
import type { BlobXhr } from '../readFileBlob';

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

const UNSUPPORTED_BLOB_MESSAGE =
  'Creating blobs from ArrayBuffer and ArrayBufferView are not supported';

/** Fake XHR that answers each opened URI with a Blob of a size chosen per URI. */
function makeXhrFactory(sizesByUri: Record<string, number>) {
  const requested: string[] = [];
  class SizedXhr implements BlobXhr {
    responseType: XMLHttpRequestResponseType = '';
    timeout = 0;
    response: unknown = null;
    status = 0;
    onload: ((ev: ProgressEvent) => unknown) | null = null;
    onerror: ((ev: ProgressEvent) => unknown) | null = null;
    ontimeout: ((ev: ProgressEvent) => unknown) | null = null;

    open(_method: string, url: string): void {
      requested.push(url);
      this.response = new Blob([new Uint8Array(sizesByUri[url] ?? 0)], { type: '' });
      this.status = 200;
    }

    send(): void {
      queueMicrotask(() => this.onload?.({} as ProgressEvent));
    }
  }
  const factory = (): BlobXhr => new SizedXhr();
  return { factory, requested };
}

describe('prepareImage (native) — Expo SDK 56 fetch().blob() regression', () => {
  const manipulate = jest.mocked(manipulateAsync);
  let originalFetch: typeof global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    originalFetch = global.fetch;
    // Expo SDK 56's winter fetch: Response.blob() throws in React Native.
    fetchMock = jest.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      blob: async () => {
        throw new Error(UNSUPPORTED_BLOB_MESSAGE);
      },
    }));
    global.fetch = fetchMock;

    manipulate.mockReset();
    manipulate.mockImplementation(async (_uri, actions) => {
      const resize = (actions ?? []).find((a) => 'resize' in a);
      const isThumb = resize && 'resize' in resize && (resize.resize.width ?? 0) <= 320;
      return isThumb
        ? { uri: 'file:///cache/thumb.jpg', width: 320, height: 180 }
        : { uri: 'file:///cache/full.jpg', width: 1280, height: 720 };
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reads the re-encoded files via XHR and never calls global fetch(...).blob()', async () => {
    const { factory, requested } = makeXhrFactory({
      'file:///cache/full.jpg': 111_222,
      'file:///cache/thumb.jpg': 3_333,
    });

    const prepared = await prepareImage('file:///picked.jpg', 4000, 2250, factory);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(requested).toEqual(['file:///cache/full.jpg', 'file:///cache/thumb.jpg']);

    expect(prepared.full.uri).toBe('file:///cache/full.jpg');
    expect(prepared.full.width).toBe(1280);
    expect(prepared.full.height).toBe(720);
    expect(prepared.full.blob.size).toBe(111_222);
    expect(prepared.full.blob.type).toBe('image/jpeg');

    expect(prepared.thumb.uri).toBe('file:///cache/thumb.jpg');
    expect(prepared.thumb.width).toBe(320);
    expect(prepared.thumb.height).toBe(180);
    expect(prepared.thumb.blob.size).toBe(3_333);
  });

  it('declares byteSize/thumbByteSize from the XHR blobs (Requirement 3.9)', async () => {
    const { factory } = makeXhrFactory({
      'file:///cache/full.jpg': 200_001,
      'file:///cache/thumb.jpg': 4_002,
    });

    const prepared = await prepareImage('file:///picked.jpg', 4000, 2250, factory);
    const payload = buildInitiatePayload(prepared, {
      kind: 'food_log',
      id: '11111111-1111-4111-8111-111111111111',
    });

    expect(payload.items[0]?.byteSize).toBe(200_001);
    expect(payload.items[0]?.thumbByteSize).toBe(4_002);
  });
});
