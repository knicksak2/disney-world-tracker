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
 * Guaranteed to satisfy the server's canonical SHOWCASE_REFERENCE_SIZE
 * clearance constraint, and if boardSize is provided, also avoids
 * collisions on the physical device screen.
 *
 * Returns null if no valid position with sufficient clearance is found.
 */
export function findAvailablePlacement(
  pinId: string,
  existingPlacements: readonly PinShowcasePlacementDTO[],
  boardSize?: { readonly width: number; readonly height: number },
  referenceSize: { readonly width: number; readonly height: number } = SHOWCASE_REFERENCE_SIZE,
  clearance: number = SHOWCASE_MIN_PIN_CLEARANCE,
): PlacementCandidate | null {
  // Always evaluate against canonical reference space (360x640) because the server enforces this
  const existingRef = existingPlacements.map((p) => ({
    pinId: p.pinId,
    x: p.posX * referenceSize.width,
    y: p.posY * referenceSize.height,
  }));

  const hasScreenCheck =
    boardSize !== undefined &&
    (boardSize.width !== referenceSize.width || boardSize.height !== referenceSize.height);

  const existingScreen = hasScreenCheck
    ? existingPlacements.map((p) => ({
        pinId: p.pinId,
        x: p.posX * boardSize.width,
        y: p.posY * boardSize.height,
      }))
    : [];

  // Safe inner margins to prevent placing right against the wooden frame border
  const minX = 48;
  const maxX = referenceSize.width - 48;
  const minY = 52;
  const maxY = referenceSize.height - 52;

  const stepX = 12;
  const stepY = 12;

  let fallbackRefSpot: PlacementCandidate | null = null;

  for (let y = minY; y <= maxY; y += stepY) {
    for (let x = minX; x <= maxX; x += stepX) {
      const candidateRef = { pinId, x, y };
      // 1. Mandatory server reference space check
      if (!overlapsAnyOtherPin(candidateRef, existingRef, clearance)) {
        const candidate: PlacementCandidate = {
          posX: x / referenceSize.width,
          posY: y / referenceSize.height,
        };

        if (!fallbackRefSpot) {
          fallbackRefSpot = candidate;
        }

        // 2. If screen dimensions are provided, also ensure no collision in screen space
        if (hasScreenCheck) {
          const candidateScreen = {
            pinId,
            x: candidate.posX * boardSize.width,
            y: candidate.posY * boardSize.height,
          };
          if (!overlapsAnyOtherPin(candidateScreen, existingScreen, clearance)) {
            return candidate;
          }
        } else {
          return candidate;
        }
      }
    }
  }

  return fallbackRefSpot;
}
