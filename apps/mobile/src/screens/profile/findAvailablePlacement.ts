/**
 * findAvailablePlacement.ts
 *
 * Pure placement geometry utility for Pin Showcase (Requirement 24.17, Property 24).
 * Finds the first available non-overlapping (posX, posY) position on the board.
 */

import {
  SHOWCASE_MIN_PIN_CLEARANCE,
  SHOWCASE_REFERENCE_SIZE,
  overlapsAnyOtherPin,
} from '@dwt/shared';
import type { PinShowcasePlacementDTO } from '@dwt/shared';

export interface PlacementCandidate {
  readonly posX: number;
  readonly posY: number;
}

/**
 * Finds the first available non-overlapping position on the cork board
 * in normalized (0.0 - 1.0) coordinates.
 *
 * Returns null if no valid position with sufficient clearance is found.
 */
export function findAvailablePlacement(
  pinId: string,
  existingPlacements: readonly PinShowcasePlacementDTO[],
  referenceSize: { readonly width: number; readonly height: number } = SHOWCASE_REFERENCE_SIZE,
  clearance: number = SHOWCASE_MIN_PIN_CLEARANCE,
): PlacementCandidate | null {
  const existingRef = existingPlacements.map((p) => ({
    pinId: p.pinId,
    x: p.posX * referenceSize.width,
    y: p.posY * referenceSize.height,
  }));

  // Safe inner margins to prevent placing right against the wooden frame border
  const minX = 48;
  const maxX = referenceSize.width - 48;
  const minY = 52;
  const maxY = referenceSize.height - 52;

  const stepX = 20;
  const stepY = 20;

  for (let y = minY; y <= maxY; y += stepY) {
    for (let x = minX; x <= maxX; x += stepX) {
      const candidate = { pinId, x, y };
      if (!overlapsAnyOtherPin(candidate, existingRef, clearance)) {
        return {
          posX: x / referenceSize.width,
          posY: y / referenceSize.height,
        };
      }
    }
  }

  return null;
}
