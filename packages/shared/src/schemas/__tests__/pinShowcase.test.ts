/**
 * Unit tests for Pin Showcase schemas, share payloads, and geometry helpers.
 *
 * Validates: Requirements 24.1, 24.2, 24.3, 24.5, 24.11, 24.12
 */

import { describe, expect, it } from 'vitest';

import {
  overlapsAnyOtherPin,
  placementToReferencePx,
  SHOWCASE_BOARD_MARGIN,
  SHOWCASE_MAX_PINS,
  SHOWCASE_MIN_PIN_CLEARANCE,
  SHOWCASE_PIN_SIZE,
  SHOWCASE_REFERENCE_SIZE,
} from '../../dto/PinShowcase.js';
import {
  pinShowcasePlacementSchema,
  pinShowcaseSchema,
  placePinRequestSchema,
} from '../PinShowcase.js';
import { pinShowcaseSharePayloadSchema, sharePayloadSchema } from '../Share.js';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

describe('pinShowcasePlacementSchema', () => {
  it('accepts valid placement data', () => {
    const result = pinShowcasePlacementSchema.safeParse({
      pinId: 'gold_coaster_royalty',
      posX: 0.5,
      posY: 0.25,
      zIndex: 1,
    });
    expect(result.success).toBe(true);
  });

  it('rejects posX outside [0.0, 1.0]', () => {
    expect(
      pinShowcasePlacementSchema.safeParse({
        pinId: 'p1',
        posX: -0.1,
        posY: 0.5,
        zIndex: 0,
      }).success,
    ).toBe(false);

    expect(
      pinShowcasePlacementSchema.safeParse({
        pinId: 'p1',
        posX: 1.01,
        posY: 0.5,
        zIndex: 0,
      }).success,
    ).toBe(false);
  });

  it('rejects posY outside [0.0, 1.0]', () => {
    expect(
      pinShowcasePlacementSchema.safeParse({
        pinId: 'p1',
        posX: 0.5,
        posY: -0.01,
        zIndex: 0,
      }).success,
    ).toBe(false);

    expect(
      pinShowcasePlacementSchema.safeParse({
        pinId: 'p1',
        posX: 0.5,
        posY: 1.1,
        zIndex: 0,
      }).success,
    ).toBe(false);
  });

  it('rejects empty pinId', () => {
    expect(
      pinShowcasePlacementSchema.safeParse({
        pinId: '',
        posX: 0.5,
        posY: 0.5,
        zIndex: 0,
      }).success,
    ).toBe(false);
  });

  it('rejects non-integer zIndex', () => {
    expect(
      pinShowcasePlacementSchema.safeParse({
        pinId: 'p1',
        posX: 0.5,
        posY: 0.5,
        zIndex: 1.5,
      }).success,
    ).toBe(false);
  });

  it('rejects extra unknown fields', () => {
    expect(
      pinShowcasePlacementSchema.safeParse({
        pinId: 'p1',
        posX: 0.5,
        posY: 0.5,
        zIndex: 0,
        extra: 'disallowed',
      }).success,
    ).toBe(false);
  });
});

describe('placePinRequestSchema', () => {
  it('accepts valid request', () => {
    const result = placePinRequestSchema.safeParse({
      posX: 0.1,
      posY: 0.9,
    });
    expect(result.success).toBe(true);
  });

  it('rejects out of bound values and extra fields', () => {
    expect(placePinRequestSchema.safeParse({ posX: -0.1, posY: 0.5 }).success).toBe(false);
    expect(placePinRequestSchema.safeParse({ posX: 0.5, posY: 1.2 }).success).toBe(false);
    expect(placePinRequestSchema.safeParse({ posX: 0.5, posY: 0.5, foo: 'bar' }).success).toBe(false);
  });
});

describe('pinShowcaseSchema', () => {
  it('accepts valid showcase with placements and unplaced list', () => {
    const result = pinShowcaseSchema.safeParse({
      ownerId: VALID_UUID,
      placements: [
        {
          pinId: 'gold_coaster_royalty',
          posX: 0.5,
          posY: 0.5,
          zIndex: 0,
        },
      ],
      unplaced: ['silver_squad_10', 'bronze_first_timer'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid showcase without unplaced list (friend view)', () => {
    const result = pinShowcaseSchema.safeParse({
      ownerId: VALID_UUID,
      placements: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid owner UUID', () => {
    expect(
      pinShowcaseSchema.safeParse({
        ownerId: 'not-a-uuid',
        placements: [],
      }).success,
    ).toBe(false);
  });
});

describe('pinShowcaseSharePayloadSchema', () => {
  it('accepts valid pinShowcase share payload', () => {
    const payload = {
      kind: 'pinShowcase',
      ownerId: VALID_UUID,
      ownerDisplayName: 'Mickey',
    };
    expect(pinShowcaseSharePayloadSchema.safeParse(payload).success).toBe(true);
    expect(sharePayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects missing or empty ownerDisplayName', () => {
    expect(
      pinShowcaseSharePayloadSchema.safeParse({
        kind: 'pinShowcase',
        ownerId: VALID_UUID,
        ownerDisplayName: '',
      }).success,
    ).toBe(false);
  });

  it('rejects invalid ownerId', () => {
    expect(
      pinShowcaseSharePayloadSchema.safeParse({
        kind: 'pinShowcase',
        ownerId: 'invalid-id',
        ownerDisplayName: 'Mickey',
      }).success,
    ).toBe(false);
  });
});

describe('Showcase Constants & Collision Geometry', () => {
  it('defines expected constants', () => {
    expect(SHOWCASE_MAX_PINS).toBe(24);
    expect(SHOWCASE_PIN_SIZE).toBe(72);
    expect(SHOWCASE_BOARD_MARGIN).toBe(0);
    expect(SHOWCASE_MIN_PIN_CLEARANCE).toBe(60);
    expect(SHOWCASE_REFERENCE_SIZE).toEqual({ width: 360, height: 640 });
  });

  it('converts normalized placement to reference pixels', () => {
    const px = placementToReferencePx({ posX: 0.5, posY: 0.5 });
    expect(px.x).toBe(180);
    expect(px.y).toBe(320);
  });

  it('detects collisions within clearance distance', () => {
    const existing = [
      { pinId: 'pin1', x: 100, y: 100 },
      { pinId: 'pin2', x: 200, y: 200 },
    ];

    // Candidate too close to pin1 (distance = 25 < 60)
    expect(overlapsAnyOtherPin({ pinId: 'candidate', x: 120, y: 115 }, existing)).toBe(true);

    // Candidate identical to pin1's position but same pinId is ignored
    expect(overlapsAnyOtherPin({ pinId: 'pin1', x: 100, y: 100 }, existing)).toBe(false);

    // Candidate well away from all pins (distance > 60)
    expect(overlapsAnyOtherPin({ pinId: 'candidate', x: 100, y: 300 }, existing)).toBe(false);

    // Candidate just outside clearance (distance = 61 > 60)
    expect(overlapsAnyOtherPin({ pinId: 'candidate', x: 100, y: 161 }, existing)).toBe(false);

    // Candidate just inside clearance (distance = 59 < 60)
    expect(overlapsAnyOtherPin({ pinId: 'candidate', x: 100, y: 159 }, existing)).toBe(true);
  });
});
