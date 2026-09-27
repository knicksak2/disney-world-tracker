/**
 * Regression test: the resort-representing Experience (the hotel's own detail
 * page row, emitted by `toResortRepresentingExperience` via
 * `buildUpstreamCatalog`) must carry the Resort's own `resortArea`, resolved
 * from its Facility_Document's `resort-area` ancestor — the same way any
 * resort-area activity resolves it via `resolveResortArea`.
 *
 * Bug: `toResortRepresentingExperience` hardcoded `resortArea: null` and never
 * looked at the Resort's own ancestor chain, so a Disney Resort's detail page
 * always rendered with no geographic Resort_Area context (e.g. Coronado
 * Springs never showed "Animal Kingdom Resort Area") regardless of what
 * Disney's upstream Facility_Document actually carried.
 */

import { describe, expect, it } from 'vitest';

import { __internal } from '../sync.js';
import type { FacilityDocument } from '../disney/facilityDoc.js';

const { buildUpstreamCatalog } = __internal;
const EMPTY_BRIDGE: ReadonlyMap<string, string> = new Map();

describe('resort-representing Experience — resortArea resolution', () => {
  it('resolves resortArea from the Resort Facility_Document\u2019s resort-area ancestor', () => {
    const coronadoDoc: FacilityDocument = {
      id: '80007823;entityType=Resort',
      name: "Disney's Coronado Springs Resort",
      type: 'resort',
      ancestors: [
        { id: 'animal-kingdom-resort-area', name: 'Animal Kingdom Resort Area', type: 'resort-area' },
      ],
    };

    const { experiences } = buildUpstreamCatalog([coronadoDoc], EMPTY_BRIDGE);

    expect(experiences).toHaveLength(1);
    expect(experiences[0]).toMatchObject({
      name: "Disney's Coronado Springs Resort",
      category: 'Resort',
      areaType: 'Resort',
      resortArea: 'Animal Kingdom Resort Area',
    });
  });

  it('falls back to null when the Resort document carries no resort-area ancestor', () => {
    const noAncestorDoc: FacilityDocument = {
      id: '80007821;entityType=Resort',
      name: "Disney's Test Resort",
      type: 'resort',
    };

    const { experiences } = buildUpstreamCatalog([noAncestorDoc], EMPTY_BRIDGE);

    expect(experiences).toHaveLength(1);
    expect(experiences[0]?.resortArea).toBeNull();
  });

  it('resolves distinct resortArea values per Resort in the same sync', () => {
    const beachClubDoc: FacilityDocument = {
      id: '80007831;entityType=Resort',
      name: "Disney's Beach Club Resort",
      type: 'resort',
      ancestors: [
        { id: 'epcot-resort-area', name: 'EPCOT Resort Area', type: 'resort-area' },
      ],
    };
    const coronadoDoc: FacilityDocument = {
      id: '80007823;entityType=Resort',
      name: "Disney's Coronado Springs Resort",
      type: 'resort',
      ancestors: [
        { id: 'animal-kingdom-resort-area', name: 'Animal Kingdom Resort Area', type: 'resort-area' },
      ],
    };

    const { experiences } = buildUpstreamCatalog(
      [beachClubDoc, coronadoDoc],
      EMPTY_BRIDGE,
    );

    const beachClub = experiences.find((e) => e.name === "Disney's Beach Club Resort");
    const coronado = experiences.find((e) => e.name === "Disney's Coronado Springs Resort");
    expect(beachClub?.resortArea).toBe('EPCOT Resort Area');
    expect(coronado?.resortArea).toBe('Animal Kingdom Resort Area');
  });
});
