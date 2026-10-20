/**
 * Reads a local file:// URI into a React Native Blob using XMLHttpRequest.
 *
 * Why not `(await fetch(uri)).blob()`: on Expo SDK 56 the global `fetch` is Expo's "winter"
 * fetch, whose `Response.blob()` calls `new Blob([arrayBuffer])`. React Native's Blob
 * constructor rejects ArrayBuffer parts ("Creating blobs from ArrayBuffer and ArrayBufferView
 * are not supported"), so that path always throws on a device. React Native's XMLHttpRequest
 * with `responseType = 'blob'` hands back a native-backed Blob without that constructor call.
 *
 * Kept free of platform imports (the XHR is injected) so it can be unit tested in Jest.
 */

/** The JPEG content type every prepared upload object carries (Requirement 3). */
export const UPLOAD_BLOB_CONTENT_TYPE = 'image/jpeg';

/** How long a single local file read may take before it is treated as failed. */
export const READ_FILE_TIMEOUT_MS = 30_000;

/** The subset of XMLHttpRequest this helper relies on (lets tests inject a fake). */
export interface BlobXhr {
  responseType: XMLHttpRequestResponseType;
  timeout: number;
  readonly response: unknown;
  readonly status: number;
  onload: ((ev: ProgressEvent) => unknown) | null;
  onerror: ((ev: ProgressEvent) => unknown) | null;
  ontimeout: ((ev: ProgressEvent) => unknown) | null;
  open(method: string, url: string): void;
  send(): void;
}

export type BlobXhrFactory = () => BlobXhr;

const defaultXhrFactory: BlobXhrFactory = () => new XMLHttpRequest();

function isBlobLike(value: unknown): value is Blob {
  return (
    typeof value === 'object' &&
    value !== null &&
    'size' in value &&
    typeof value.size === 'number' &&
    'slice' in value &&
    typeof value.slice === 'function'
  );
}

/**
 * Resolves the file at `uri` as a Blob whose `size` is the real byte length of the file and whose
 * `type` is `image/jpeg`. The type is set explicitly because Expo's fetch copies `blob.type` into
 * the request's Content-Type header when a Blob is the PUT body, and a file:// response can report
 * an empty type, which would break the presigned `Content-Type` signature.
 */
export function readFileAsBlob(
  uri: string,
  createXhr: BlobXhrFactory = defaultXhrFactory
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const xhr = createXhr();
    xhr.responseType = 'blob';
    xhr.timeout = READ_FILE_TIMEOUT_MS;

    xhr.onload = () => {
      // Local file reads can report status 0; anything outside 0 and 2xx is a failure.
      const ok = xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300);
      if (!ok) {
        reject(new Error(`Could not read photo file: unexpected status ${xhr.status}`));
        return;
      }
      const response = xhr.response;
      if (!isBlobLike(response)) {
        reject(new Error('Could not read photo file: no data returned'));
        return;
      }
      if (response.size <= 0) {
        reject(new Error('Could not read photo file: file is empty'));
        return;
      }
      // slice() keeps the same bytes and size but stamps the JPEG content type.
      resolve(response.slice(0, response.size, UPLOAD_BLOB_CONTENT_TYPE));
    };
    xhr.onerror = () => {
      reject(new Error('Could not read photo file: network error reading local file'));
    };
    xhr.ontimeout = () => {
      reject(new Error('Could not read photo file: timed out reading local file'));
    };

    xhr.open('GET', uri);
    xhr.send();
  });
}
