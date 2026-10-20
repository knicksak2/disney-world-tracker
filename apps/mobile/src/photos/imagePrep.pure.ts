export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

export interface ResizePlan {
  readonly full: ImageDimensions;
  readonly thumb: ImageDimensions;
}

export interface PreparedImage {
  readonly uri: string;
  readonly width: number;
  readonly height: number;
  readonly blob: Blob;
}

export interface PreparedImages {
  readonly full: PreparedImage;
  readonly thumb: PreparedImage;
}

export const MAX_FULL_DIMENSION = 1280;
export const MAX_THUMB_DIMENSION = 320;

/**
 * Pure function to calculate resize dimensions for full image and thumbnail.
 *
 * Rules:
 * - Full image long edge <= 1280, never exceeds source in either dimension.
 * - Thumbnail long edge <= 320, never exceeds source in either dimension.
 * - Aspect ratio preserved within rounding.
 * - Source within limits is not enlarged.
 */
export function planResize(width: number, height: number): ResizePlan {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const longEdge = Math.max(w, h);

  // Full image plan: scale down if long edge exceeds 1280, otherwise keep original
  let fullWidth = w;
  let fullHeight = h;
  if (longEdge > MAX_FULL_DIMENSION) {
    const fullScale = MAX_FULL_DIMENSION / longEdge;
    fullWidth = Math.max(1, Math.round(w * fullScale));
    fullHeight = Math.max(1, Math.round(h * fullScale));
  }

  // Thumbnail plan: scale down if long edge exceeds 320, otherwise keep original
  let thumbWidth = w;
  let thumbHeight = h;
  if (longEdge > MAX_THUMB_DIMENSION) {
    const thumbScale = MAX_THUMB_DIMENSION / longEdge;
    thumbWidth = Math.max(1, Math.round(w * thumbScale));
    thumbHeight = Math.max(1, Math.round(h * thumbScale));
  }

  return {
    full: {
      width: fullWidth,
      height: fullHeight,
    },
    thumb: {
      width: thumbWidth,
      height: thumbHeight,
    },
  };
}
