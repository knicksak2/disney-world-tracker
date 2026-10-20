import type { PreparedImages } from './imagePrep.pure';

export * from './imagePrep.pure';

/**
 * Platform entry point for non-native / Jest runtimes.
 * In React Native builds, Metro automatically selects imagePrep.native.ts.
 */
export async function prepareImage(
  _uri: string,
  _originalWidth: number,
  _originalHeight: number
): Promise<PreparedImages> {
  throw new Error('prepareImage must be run in a native environment or mocked in Jest tests');
}
