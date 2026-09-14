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

  it('guarantees server reference-space clearance even when device boardSize has different aspect ratio / scale (regression guard)', () => {
    // Exact pin placements from user defect report where red pin is near top row
    const existing: PinShowcasePlacementDTO[] = [
      { pinId: 'dome', posX: 0.32945448, posY: 0.09085953, zIndex: 0 },
      { pinId: 'red_pin', posX: 0.49059543, posY: 0.11609187, zIndex: 1 },
      { pinId: 'purple_pin', posX: 0.1168, posY: 0.1944, zIndex: 2 },
      { pinId: 'purple_cross', posX: 0.2392, posY: 0.4309, zIndex: 3 },
      { pinId: 'green_map', posX: 0.5480, posY: 0.3990, zIndex: 4 },
      { pinId: 'filmstrip', posX: 0.7137, posY: 0.7737, zIndex: 5 },
    ];

    // On a 412x500 device screen, the old code returned a spot that was 66px away in screen space
    // but compressed to 58px on the server (< 60px SHOWCASE_MIN_PIN_CLEARANCE), causing backend rejection
    const deviceBoardSize = { width: 412, height: 500 };
    const result = findAvailablePlacement('new-pin', existing, deviceBoardSize);
    expect(result).not.toBeNull();

    // 1. MUST satisfy server reference clearance (360x640)
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

    // Specifically verify distance to red_pin on server is >= SHOWCASE_MIN_PIN_CLEARANCE
    const redPinRef = existRef.find((p) => p.pinId === 'red_pin')!;
    const distToRedPin = Math.hypot(candRef.x - redPinRef.x, candRef.y - redPinRef.y);
    expect(distToRedPin).toBeGreaterThanOrEqual(SHOWCASE_MIN_PIN_CLEARANCE);

    // 2. MUST also satisfy screen clearance on device
    const candScreen = {
      pinId: 'new-pin',
      x: result!.posX * deviceBoardSize.width,
      y: result!.posY * deviceBoardSize.height,
    };
    const existScreen = existing.map((p) => ({
      pinId: p.pinId,
      x: p.posX * deviceBoardSize.width,
      y: p.posY * deviceBoardSize.height,
    }));
    expect(overlapsAnyOtherPin(candScreen, existScreen, SHOWCASE_MIN_PIN_CLEARANCE)).toBe(false);
  });
});
