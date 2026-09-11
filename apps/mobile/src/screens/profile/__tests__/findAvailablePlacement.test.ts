/**
 * Tests for findAvailablePlacement (Task 19.1, Requirement 24.17, Property 24).
 */

import {
  SHOWCASE_MIN_PIN_CLEARANCE,
  SHOWCASE_REFERENCE_SIZE,
  overlapsAnyOtherPin,
} from '@dwt/shared';
import type { PinShowcasePlacementDTO } from '@dwt/shared';
import { findAvailablePlacement } from '../findAvailablePlacement';

describe('findAvailablePlacement (Task 19.1, Requirement 24.17, Property 24)', () => {
  it('finds a valid non-overlapping coordinate on an empty board', () => {
    const candidate = findAvailablePlacement('test-pin-1', []);
    expect(candidate).not.toBeNull();
    expect(candidate!.posX).toBeGreaterThanOrEqual(0);
    expect(candidate!.posX).toBeLessThanOrEqual(1);
    expect(candidate!.posY).toBeGreaterThanOrEqual(0);
    expect(candidate!.posY).toBeLessThanOrEqual(1);
  });

  it('avoids existing placed pins by at least SHOWCASE_MIN_PIN_CLEARANCE', () => {
    // Place a pin at (0.133, 0.081) which corresponds to (48, 52)
    const existing: PinShowcasePlacementDTO[] = [
      { pinId: 'existing-1', posX: 48 / 360, posY: 52 / 640, zIndex: 0 },
    ];

    const result = findAvailablePlacement('test-pin-2', existing);
    expect(result).not.toBeNull();

    const candRef = {
      pinId: 'test-pin-2',
      x: result!.posX * SHOWCASE_REFERENCE_SIZE.width,
      y: result!.posY * SHOWCASE_REFERENCE_SIZE.height,
    };
    const existRef = existing.map((p) => ({
      pinId: p.pinId,
      x: p.posX * SHOWCASE_REFERENCE_SIZE.width,
      y: p.posY * SHOWCASE_REFERENCE_SIZE.height,
    }));

    expect(overlapsAnyOtherPin(candRef, existRef, SHOWCASE_MIN_PIN_CLEARANCE)).toBe(false);
  });

  it('finds a spot when multiple pins are already placed', () => {
    const existing: PinShowcasePlacementDTO[] = [
      { pinId: 'p1', posX: 0.2, posY: 0.2, zIndex: 0 },
      { pinId: 'p2', posX: 0.5, posY: 0.5, zIndex: 1 },
      { pinId: 'p3', posX: 0.8, posY: 0.8, zIndex: 2 },
    ];

    const result = findAvailablePlacement('new-pin', existing);
    expect(result).not.toBeNull();

    const candRef = {
      pinId: 'new-pin',
      x: result!.posX * SHOWCASE_REFERENCE_SIZE.width,
      y: result!.posY * SHOWCASE_REFERENCE_SIZE.height,
    };
    const existRef = existing.map((p) => ({
      pinId: p.pinId,
      x: p.posX * SHOWCASE_REFERENCE_SIZE.width,
      y: p.posY * SHOWCASE_REFERENCE_SIZE.height,
    }));

    expect(overlapsAnyOtherPin(candRef, existRef, SHOWCASE_MIN_PIN_CLEARANCE)).toBe(false);
  });
});
