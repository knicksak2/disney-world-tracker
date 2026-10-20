import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { planResize, type PreparedImages } from './imagePrep.pure';
import { readFileAsBlob, type BlobXhrFactory } from './readFileBlob';

export * from './imagePrep.pure';

/**
 * Native image preparation using expo-image-manipulator.
 * Produces full and thumbnail JPEGs, strips EXIF/GPS, and reads each file into a Blob.
 * `createXhr` is injectable for tests; it defaults to a real XMLHttpRequest.
 */
export async function prepareImage(
  uri: string,
  originalWidth: number,
  originalHeight: number,
  createXhr?: BlobXhrFactory
): Promise<PreparedImages> {
  const plan = planResize(originalWidth, originalHeight);

  // Full image re-encode (max edge <= 1280, quality 0.75, JPEG)
  const fullResult = await manipulateAsync(
    uri,
    [{ resize: { width: plan.full.width, height: plan.full.height } }],
    { compress: 0.75, format: SaveFormat.JPEG }
  );

  // Thumbnail re-encode (max edge <= 320, quality 0.75, JPEG)
  const thumbResult = await manipulateAsync(
    uri,
    [{ resize: { width: plan.thumb.width, height: plan.thumb.height } }],
    { compress: 0.75, format: SaveFormat.JPEG }
  );

  // Read the re-encoded files as Blobs via XMLHttpRequest (responseType 'blob'). Not
  // `(await fetch(uri)).blob()`: Expo SDK 56's fetch builds that Blob from an ArrayBuffer, which
  // React Native's Blob constructor rejects. blob.size is the declared byteSize (Requirement 3.9).
  const fullBlob = await readFileAsBlob(fullResult.uri, createXhr);
  const thumbBlob = await readFileAsBlob(thumbResult.uri, createXhr);

  return {
    full: {
      uri: fullResult.uri,
      width: fullResult.width,
      height: fullResult.height,
      blob: fullBlob,
    },
    thumb: {
      uri: thumbResult.uri,
      width: thumbResult.width,
      height: thumbResult.height,
      blob: thumbBlob,
    },
  };
}
