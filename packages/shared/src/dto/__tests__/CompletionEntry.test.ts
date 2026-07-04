/**
 * Unit tests for the updated `CompletionEntryDTO` shape.
 *
 * The resort-tracking feature makes hotel content trackable by:
 *   - making `park` nullable (`Park | null`) so resort-area and
 *     resort-representing entries — which have no owning Park — can be
 *     surfaced, and
 *   - adding a required `areaType` (from the closed `AREA_TYPES` set) so the
 *     mobile grouping fold can partition entries by Area_Type and surface the
 *     resort group.
 *
 * `CompletionEntryDTO` is a type-only interface (no Zod schema), so these
 * tests assert the structural/serialization contract: a resort-area / resort
 * entry serializes with `park: null` and a valid `areaType`, while an
 * in-Park entry keeps a concrete `Park` value.
 *
 * Validates: Requirements 5.2
 */

import { describe, expect, it } from 'vitest';

import { AREA_TYPES, PARKS } from '../../enums.js';
import type { CompletionEntryDTO } from '../CompletionEntry.js';

/**
 * A resort-area / resort entry: no owning Park (`park: null`) and an
 * `areaType` of `Resort`. This is the case the DTO change exists to support.
 */
const RESORT_ENTRY: CompletionEntryDTO = {
  experienceId: '22222222-2222-5222-8222-222222222222',
  experienceName: "Victoria & Albert's",
  park: null,
  areaType: 'Resort',
  category: 'Restaurant',
  completedOn: '2024-05-01',
  rating: 9,
  sharedNote: null,
};

/**
 * An in-Park entry retained for contrast: a concrete `Park` and a non-resort
 * `areaType` still round-trip unchanged.
 */
const THEME_PARK_ENTRY: CompletionEntryDTO = {
  experienceId: '11111111-1111-5111-8111-111111111111',
  experienceName: 'Space Mountain',
  park: 'Magic Kingdom',
  areaType: 'ThemePark',
  category: 'Ride',
  completedOn: '2024-04-15',
  rating: null,
  sharedNote: null,
};

describe('CompletionEntryDTO — updated shape', () => {
  it('serializes a resort entry with park: null and a valid areaType', () => {
    const serialized = JSON.parse(JSON.stringify(RESORT_ENTRY)) as CompletionEntryDTO;

    expect(serialized.park).toBeNull();
    expect(AREA_TYPES).toContain(serialized.areaType);
    expect(serialized.areaType).toBe('Resort');
  });

  it('preserves the resort entry field values through serialization', () => {
    const serialized = JSON.parse(JSON.stringify(RESORT_ENTRY)) as CompletionEntryDTO;

    expect(serialized).toEqual(RESORT_ENTRY);
    // `park: null` must survive JSON serialization rather than being dropped.
    expect(Object.prototype.hasOwnProperty.call(serialized, 'park')).toBe(true);
  });

  it('keeps a concrete Park and non-resort areaType for an in-Park entry', () => {
    const serialized = JSON.parse(JSON.stringify(THEME_PARK_ENTRY)) as CompletionEntryDTO;

    expect(serialized.park).toBe('Magic Kingdom');
    expect(PARKS).toContain(serialized.park);
    expect(AREA_TYPES).toContain(serialized.areaType);
    expect(serialized.areaType).toBe('ThemePark');
  });

  it('accepts a null park for every Area_Type value', () => {
    for (const areaType of AREA_TYPES) {
      const entry: CompletionEntryDTO = {
        experienceId: '33333333-3333-5333-8333-333333333333',
        experienceName: `Sample ${areaType} item`,
        park: null,
        areaType,
        category: 'Other',
        completedOn: '2024-06-01',
        rating: null,
        sharedNote: null,
      };

      const serialized = JSON.parse(JSON.stringify(entry)) as CompletionEntryDTO;
      expect(serialized.park).toBeNull();
      expect(serialized.areaType).toBe(areaType);
    }
  });
});
