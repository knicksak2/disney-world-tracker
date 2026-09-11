/**
 * Fast-check property tests for Pin Showcase placement, capacity, and geometry invariants.
 *
 * Each property runs for at least 100 iterations.
 *
 * Validates: Requirements 24.1, 24.3, 24.4, 24.5, 24.11 (Properties 18, 19, 20, 22)
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  overlapsAnyOtherPin,
  placementToReferencePx,
  SHOWCASE_MAX_PINS,
  SHOWCASE_MIN_PIN_CLEARANCE,
  SHOWCASE_REFERENCE_SIZE,
  type PinShowcasePlacementDTO,
} from '@dwt/shared';

// ---------------------------------------------------------------------------
// Pure state machine simulating Showcase placement invariants
// ---------------------------------------------------------------------------

interface UserPinState {
  readonly pinId: string;
  readonly isAwarded: boolean;
  readonly isClaimed: boolean;
}

interface SimulatedShowcaseState {
  readonly ownerId: string;
  placements: Map<string, { posX: number; posY: number; zIndex: number }>;
}

function simulatePlacePin(
  state: SimulatedShowcaseState,
  userPins: ReadonlyMap<string, UserPinState>,
  pinId: string,
  posX: number,
  posY: number,
  maxPins = SHOWCASE_MAX_PINS,
  minClearance = SHOWCASE_MIN_PIN_CLEARANCE,
  referenceSize = SHOWCASE_REFERENCE_SIZE,
):
  | { success: true; placement: PinShowcasePlacementDTO }
  | { success: false; error: 'pin_not_eligible' | 'showcase_full' | 'showcase_position_overlap' } {
  // 1. Ownership check (Property 18)
  const userPin = userPins.get(pinId);
  if (!userPin || !userPin.isAwarded || !userPin.isClaimed) {
    return { success: false, error: 'pin_not_eligible' };
  }

  // 2. Capacity check (Property 20)
  const isAlreadyPlaced = state.placements.has(pinId);
  if (!isAlreadyPlaced && state.placements.size >= maxPins) {
    return { success: false, error: 'showcase_full' };
  }

  // 3. Overlap check (Property 22)
  const candidatePx = placementToReferencePx({ posX, posY }, referenceSize);
  const existingList = Array.from(state.placements.entries()).map(([pId, pos]) => ({
    pinId: pId,
    ...placementToReferencePx(pos, referenceSize),
  }));

  if (
    overlapsAnyOtherPin(
      { pinId, x: candidatePx.x, y: candidatePx.y },
      existingList,
      minClearance,
    )
  ) {
    return { success: false, error: 'showcase_position_overlap' };
  }

  // 4. Stacking order
  let maxZ = -1;
  for (const pos of state.placements.values()) {
    if (pos.zIndex > maxZ) maxZ = pos.zIndex;
  }
  const nextZ = maxZ + 1;

  const placementRecord = { posX, posY, zIndex: nextZ };
  state.placements.set(pinId, placementRecord);

  return {
    success: true,
    placement: {
      pinId,
      posX,
      posY,
      zIndex: nextZ,
    },
  };
}

describe('Showcase Property Tests (fast-check, >=100 runs)', () => {
  // Feature: pin-collection, Property 18: Placement Requires Current Ownership
  it('Property 18: Placement Requires Current Ownership', () => {
    fc.assert(
      fc.property(
        fc.record({
          pinId: fc.string({ minLength: 1, maxLength: 20 }),
          isAwarded: fc.boolean(),
          isClaimed: fc.boolean(),
          posX: fc.double({ min: 0.0, max: 1.0, noNaN: true }),
          posY: fc.double({ min: 0.0, max: 1.0, noNaN: true }),
        }),
        ({ pinId, isAwarded, isClaimed, posX, posY }) => {
          const userPins = new Map<string, UserPinState>([
            [pinId, { pinId, isAwarded, isClaimed }],
          ]);
          const state: SimulatedShowcaseState = {
            ownerId: 'user_1',
            placements: new Map(),
          };

          const result = simulatePlacePin(state, userPins, pinId, posX, posY);

          if (isAwarded && isClaimed) {
            expect(result.success).toBe(true);
            expect(state.placements.has(pinId)).toBe(true);
          } else {
            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.error).toBe('pin_not_eligible');
            }
            expect(state.placements.size).toBe(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: pin-collection, Property 19: Placement Upsert Idempotency
  it('Property 19: Placement Upsert Idempotency', () => {
    fc.assert(
      fc.property(
        fc.record({
          pinId: fc.string({ minLength: 1, maxLength: 20 }),
          pos1: fc.record({
            posX: fc.double({ min: 0.0, max: 0.4, noNaN: true }),
            posY: fc.double({ min: 0.0, max: 0.4, noNaN: true }),
          }),
          pos2: fc.record({
            posX: fc.double({ min: 0.6, max: 1.0, noNaN: true }),
            posY: fc.double({ min: 0.6, max: 1.0, noNaN: true }),
          }),
        }),
        ({ pinId, pos1, pos2 }) => {
          const userPins = new Map<string, UserPinState>([
            [pinId, { pinId, isAwarded: true, isClaimed: true }],
          ]);
          const state: SimulatedShowcaseState = {
            ownerId: 'user_1',
            placements: new Map(),
          };

          // First placement
          const res1 = simulatePlacePin(state, userPins, pinId, pos1.posX, pos1.posY);
          expect(res1.success).toBe(true);
          expect(state.placements.size).toBe(1);

          // Second placement of same pin with different coordinates
          const res2 = simulatePlacePin(state, userPins, pinId, pos2.posX, pos2.posY);
          expect(res2.success).toBe(true);
          // Crucial: exactly 1 row/entry remains (never duplicated)
          expect(state.placements.size).toBe(1);

          const finalPos = state.placements.get(pinId);
          expect(finalPos?.posX).toBe(pos2.posX);
          expect(finalPos?.posY).toBe(pos2.posY);
          if (res1.success && res2.success) {
            expect(res2.placement.zIndex).toBeGreaterThanOrEqual(res1.placement.zIndex);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: pin-collection, Property 20: Showcase Capacity Invariant
  it('Property 20: Showcase Capacity Invariant', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: SHOWCASE_MAX_PINS + 5 }),
        fc.boolean(),
        (initialCount, attemptExistingPin) => {
          const clampedInitial = Math.min(initialCount, SHOWCASE_MAX_PINS);
          const state: SimulatedShowcaseState = {
            ownerId: 'user_1',
            placements: new Map(),
          };
          const userPins = new Map<string, UserPinState>();

          // Pre-populate with clampedInitial non-overlapping placements
          for (let i = 0; i < clampedInitial; i++) {
            const pId = `pin_${i}`;
            userPins.set(pId, { pinId: pId, isAwarded: true, isClaimed: true });
            // Space them out widely
            const col = i % 4;
            const row = Math.floor(i / 4);
            state.placements.set(pId, {
              posX: 0.1 + col * 0.22,
              posY: 0.05 + row * 0.14,
              zIndex: i,
            });
          }

          const targetPinId =
            attemptExistingPin && clampedInitial > 0
              ? `pin_0`
              : `new_pin_candidate`;

          userPins.set(targetPinId, { pinId: targetPinId, isAwarded: true, isClaimed: true });

          // Attempt placement at a non-overlapping far location
          const result = simulatePlacePin(
            state,
            userPins,
            targetPinId,
            0.98,
            0.98,
          );

          if (clampedInitial >= SHOWCASE_MAX_PINS && !attemptExistingPin) {
            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.error).toBe('showcase_full');
            }
            expect(state.placements.size).toBe(SHOWCASE_MAX_PINS);
          } else {
            // Either under capacity or updating an existing pin
            expect(state.placements.size).toBeLessThanOrEqual(SHOWCASE_MAX_PINS);
          }

          // Hard invariant: never exceeds SHOWCASE_MAX_PINS
          expect(state.placements.size).toBeLessThanOrEqual(SHOWCASE_MAX_PINS);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: pin-collection, Property 22: No Two Placements Overlap
  it('Property 22: No Two Placements Overlap', () => {
    fc.assert(
      fc.property(
        fc.record({
          p1: fc.record({
            x: fc.double({ min: 50, max: 300, noNaN: true }),
            y: fc.double({ min: 50, max: 550, noNaN: true }),
          }),
          angle: fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
          distance: fc.double({ min: 1, max: 150, noNaN: true }),
        }),
        ({ p1, angle, distance }) => {
          const p2 = {
            x: p1.x + Math.cos(angle) * distance,
            y: p1.y + Math.sin(angle) * distance,
          };

          const placements = [{ pinId: 'p1', x: p1.x, y: p1.y }];
          const candidate = { pinId: 'p2', x: p2.x, y: p2.y };

          const isOverlapping = overlapsAnyOtherPin(
            candidate,
            placements,
            SHOWCASE_MIN_PIN_CLEARANCE,
          );

          if (distance < SHOWCASE_MIN_PIN_CLEARANCE - 0.001) {
            expect(isOverlapping).toBe(true);
          } else if (distance > SHOWCASE_MIN_PIN_CLEARANCE + 0.001) {
            expect(isOverlapping).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
