/**
 * Unit tests for `resolveResortArea` (disney/resortArea.ts).
 *
 * The Resort_Area is a broad geographic zone of the WDW property (e.g. "EPCOT
 * Resort Area"). It is resolved from the `resort-area` ancestor and is
 * meaningful only for a `Resort` Area_Type: for a ThemePark/WaterPark/
 * DisneySprings Experience the owning Park/Destination already conveys the
 * zone, so it returns `null` there.
 */

import { describe, expect, it } from 'vitest';

import type { AreaResolution } from '../area.js';
import type { AncestorRef, FacilityDocument } from '../facilityDoc.js';
import { resolveResortArea } from '../resortArea.js';

function docWith(ancestors: readonly AncestorRef[]): FacilityDocument {
  return { id: '1;entityType=restaurant', ancestors };
}

const RESORT: AreaResolution = { areaType: 'Resort' };
const RESORT_WITH_ID: AreaResolution = {
  areaType: 'Resort',
  resortEnterpriseId: '80069789;entityType=resort',
};

describe('resolveResortArea', () => {
  it('returns the resort-area ancestor name for a Resort-area Experience', () => {
    const doc = docWith([
      { id: '80069789;entityType=resort', type: 'resort', name: 'Swan Hotel' },
      { id: '1262;entityType=resort-area', type: 'resort-area', name: 'EPCOT Resort Area' },
    ]);
    expect(resolveResortArea(doc, RESORT_WITH_ID)).toBe('EPCOT Resort Area');
  });

  it('resolves for a catch-all Resort area (no specific resort)', () => {
    const doc = docWith([
      { id: '1262;entityType=resort-area', type: 'resort-area', name: 'Magic Kingdom Resort Area' },
    ]);
    expect(resolveResortArea(doc, RESORT)).toBe('Magic Kingdom Resort Area');
  });

  it('is null for a ThemePark Experience even when a resort-area ancestor exists', () => {
    const doc = docWith([
      { id: '80007944;entityType=theme-park', type: 'theme-park', name: 'EPCOT' },
      { id: '1262;entityType=resort-area', type: 'resort-area', name: 'EPCOT Resort Area' },
    ]);
    expect(resolveResortArea(doc, { areaType: 'ThemePark', park: 'EPCOT' })).toBeNull();
  });

  it('is null for a DisneySprings Experience', () => {
    const doc = docWith([
      { id: '1262;entityType=resort-area', type: 'resort-area', name: 'Disney Springs Resort Area' },
    ]);
    expect(
      resolveResortArea(doc, { areaType: 'DisneySprings', park: 'Disney Springs' }),
    ).toBeNull();
  });

  it('is null when no resort-area ancestor is present', () => {
    const doc = docWith([
      { id: '80069789;entityType=resort', type: 'resort', name: 'Swan Hotel' },
    ]);
    expect(resolveResortArea(doc, RESORT_WITH_ID)).toBeNull();
  });

  it('trims whitespace and treats a blank name as null', () => {
    const trimmed = docWith([
      { id: 'x', type: 'resort-area', name: '  EPCOT Resort Area  ' },
    ]);
    expect(resolveResortArea(trimmed, RESORT)).toBe('EPCOT Resort Area');

    const blank = docWith([{ id: 'x', type: 'resort-area', name: '   ' }]);
    expect(resolveResortArea(blank, RESORT)).toBeNull();
  });
});
