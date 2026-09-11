/**
 * Pin Showcase DTOs and pure placement geometry (Feature: pin-collection, Requirement 24).
 */

/** One Pin's placement on a Showcase. `posX`/`posY` are fractions of the board's own
 *  rendered width/height (Requirement 24.2, 24.3) — device-size-independent. */
export interface PinShowcasePlacementDTO {
  readonly pinId: string;
  readonly posX: number; // 0.0-1.0
  readonly posY: number; // 0.0-1.0
  readonly zIndex: number;
}

/** A full Showcase read — either the owner's own (editable) or a Friend's (read-only). */
export interface PinShowcaseDTO {
  readonly ownerId: string;
  readonly placements: readonly PinShowcasePlacementDTO[];
  /** Pins the User has claimed but has NOT placed — only present on the owner's own read,
   *  omitted (undefined) on a Friend's read, since a Friend never sees the unplaced pool. */
  readonly unplaced?: readonly string[];
}

/** Body for `PUT /me/pin-showcase/:pinId` — place or move one Pin. */
export interface PlacePinRequest {
  readonly posX: number;
  readonly posY: number;
}

// ---------------------------------------------------------------------------
// Constants & Pure Geometry (Requirement 24.5, 24.11; Properties 20, 22)
// ---------------------------------------------------------------------------

export const SHOWCASE_MAX_PINS = 24;
export const SHOWCASE_PIN_SIZE = 72;
export const SHOWCASE_MIN_PIN_CLEARANCE = 46; // ~64% of pin size, allowing rims to touch/nestle without dead-center collision
export const SHOWCASE_REFERENCE_SIZE = { width: 360, height: 640 } as const;

/**
 * Checks whether candidate point (in board-space pixels) collides with any other placed pin.
 * Center-to-center Euclidean distance must be >= clearance.
 */
export function overlapsAnyOtherPin(
  candidate: { readonly pinId: string; readonly x: number; readonly y: number },
  placements: readonly { readonly pinId: string; readonly x: number; readonly y: number }[],
  clearance: number = SHOWCASE_MIN_PIN_CLEARANCE,
): boolean {
  return placements.some(
    (p) =>
      p.pinId !== candidate.pinId &&
      Math.hypot(p.x - candidate.x, p.y - candidate.y) < clearance,
  );
}

/**
 * Converts a normalized placement fraction (0.0-1.0) to pixel coordinates in reference space.
 */
export function placementToReferencePx(
  placement: { readonly posX: number; readonly posY: number },
  referenceSize: { readonly width: number; readonly height: number } = SHOWCASE_REFERENCE_SIZE,
): { readonly x: number; readonly y: number } {
  return {
    x: placement.posX * referenceSize.width,
    y: placement.posY * referenceSize.height,
  };
}
