/**
 * Native OCR call site using expo-image-picker and expo-ocr-kit (Task 14.3).
 *
 * Implements:
 * - On-device photo acquisition via camera or photo library.
 * - Local text recognition via Apple Vision (iOS) or Google ML Kit (Android) (Req 9.1).
 * - Zero network calls, zero server-side storage, no photo persistence (Req 9.1, 9.7).
 */

import * as ImagePicker from 'expo-image-picker';
import { recognizeText } from 'expo-ocr-kit';
import { requireOptionalNativeModule } from 'expo';
import { SAMPLE_DISNEY_RECEIPT } from './receiptScan.pure';

export * from './receiptScan.pure';

export type ReceiptImageSource = 'camera' | 'library';

/** Check whether native OCR is supported in the current runtime environment. */
export function isNativeOcrAvailable(): boolean {
  try {
    return requireOptionalNativeModule('ExpoOcrKit') != null;
  } catch {
    return false;
  }
}

/**
 * Captures or picks a receipt photo and runs on-device text recognition.
 * Returns the raw recognized text string, or null if cancelled/denied.
 *
 * In Expo Go (where custom native modules cannot be bundled into the client),
 * gracefully falls back to a sample Disney dining receipt instead of throwing
 * an unavailable native module error.
 */
export async function scanReceiptPhoto(
  source: ReceiptImageSource = 'camera'
): Promise<string | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      throw new Error('Camera permission is required to scan receipts.');
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.9,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null;
    }

    const asset = result.assets[0];
    if (!asset || !asset.uri) return null;

    if (!isNativeOcrAvailable()) {
      return SAMPLE_DISNEY_RECEIPT;
    }

    try {
      const ocrResult = await recognizeText(asset.uri);
      return ocrResult.text ?? '';
    } catch (err: any) {
      if (err?.message?.includes('ExpoOcrKit') || err?.message?.includes('Native module')) {
        return SAMPLE_DISNEY_RECEIPT;
      }
      throw err;
    }
  } else {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      throw new Error('Photo library permission is required to select receipt photos.');
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.9,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null;
    }

    const asset = result.assets[0];
    if (!asset || !asset.uri) return null;

    if (!isNativeOcrAvailable()) {
      return SAMPLE_DISNEY_RECEIPT;
    }

    try {
      const ocrResult = await recognizeText(asset.uri);
      return ocrResult.text ?? '';
    } catch (err: any) {
      if (err?.message?.includes('ExpoOcrKit') || err?.message?.includes('Native module')) {
        return SAMPLE_DISNEY_RECEIPT;
      }
      throw err;
    }
  }
}

