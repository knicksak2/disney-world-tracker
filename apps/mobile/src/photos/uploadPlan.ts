import type { PhotoTargetKind } from '@dwt/shared';
import type { PreparedImages } from './imagePrep.pure';

export interface UploadTarget {
  readonly kind: PhotoTargetKind;
  readonly id: string;
}

export interface PhotoInitiateItemPayload {
  readonly contentType: 'image/jpeg';
  readonly byteSize: number;
  readonly thumbByteSize: number;
  readonly width: number;
  readonly height: number;
  readonly takenAt?: string;
}

export interface PhotoInitiatePayload {
  readonly target: UploadTarget;
  readonly items: readonly PhotoInitiateItemPayload[];
}

export interface PutRequestPlan {
  readonly url: string;
  readonly method: 'PUT';
  readonly headers: Record<string, string>;
  readonly body: Blob;
}

/**
 * Builds initiate payload reading byteSize and thumbByteSize solely from Blob.size.
 */
export function buildInitiatePayload(
  prepared: PreparedImages | readonly { prepared: PreparedImages; takenAt?: string }[],
  target: UploadTarget,
  takenAt?: string
): PhotoInitiatePayload {
  if (!('full' in prepared)) {
    return {
      target,
      items: prepared.map((item) => ({
        contentType: 'image/jpeg' as const,
        byteSize: item.prepared.full.blob.size,
        thumbByteSize: item.prepared.thumb.blob.size,
        width: item.prepared.full.width,
        height: item.prepared.full.height,
        ...(item.takenAt ? { takenAt: item.takenAt } : {}),
      })),
    };
  }

  return {
    target,
    items: [
      {
        contentType: 'image/jpeg' as const,
        byteSize: prepared.full.blob.size,
        thumbByteSize: prepared.thumb.blob.size,
        width: prepared.full.width,
        height: prepared.full.height,
        ...(takenAt ? { takenAt } : {}),
      },
    ],
  };
}

/**
 * Builds the two direct-to-storage PUT request plans for full and thumbnail blobs.
 * Enforces:
 * - Exact same Blob instances as bodies.
 * - Only 'Content-Type: image/jpeg' in headers.
 * - Never includes 'Content-Length' or Authorization headers.
 */
export function buildPutPlans(
  prepared: PreparedImages,
  slot: { putUrl: string; thumbPutUrl: string }
): readonly [PutRequestPlan, PutRequestPlan] {
  return [
    {
      url: slot.putUrl,
      method: 'PUT',
      headers: {
        'Content-Type': 'image/jpeg',
      },
      body: prepared.full.blob,
    },
    {
      url: slot.thumbPutUrl,
      method: 'PUT',
      headers: {
        'Content-Type': 'image/jpeg',
      },
      body: prepared.thumb.blob,
    },
  ];
}
