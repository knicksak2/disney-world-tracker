/**
 * Unit tests for Enterprise_Id derivation + document normalization.
 *
 * The real Disney Sync Gateway keys documents by a channel-prefixed Couchbase
 * `_id` (e.g. `wdw.facilities.1_0.en_us.restaurant.412260665;entityType=restaurant`)
 * rather than a bare Enterprise_Id, so `deriveEnterpriseId` /
 * `normalizeFacilityDocument` recover the clean Enterprise_Id every downstream
 * core expects. These tests pin that behavior (and the tolerant fallback that
 * keeps non-Enterprise_Id ids, e.g. test fixtures, from being dropped).
 */

import { describe, expect, it } from 'vitest';

import {
  adaptFacilityDocument,
  deriveEnterpriseId,
  normalizeFacilityDocument,
} from '../facilityDoc.js';

describe('deriveEnterpriseId', () => {
  it('returns a bare Enterprise_Id unchanged (idempotent)', () => {
    expect(deriveEnterpriseId('80010177;entityType=Attraction')).toBe(
      '80010177;entityType=Attraction',
    );
  });

  it('extracts the trailing Enterprise_Id token from a channel-prefixed _id', () => {
    expect(
      deriveEnterpriseId(
        'wdw.facilities.1_0.en_us.restaurant.412260665;entityType=restaurant',
      ),
    ).toBe('412260665;entityType=restaurant');
  });

  it('handles hyphenated entity types (theme-park, resort-area)', () => {
    expect(
      deriveEnterpriseId('wdw.facilities.1_0.en_us.theme-park.80007944;entityType=theme-park'),
    ).toBe('80007944;entityType=theme-park');
  });

  it('returns null when there is no Enterprise_Id token', () => {
    expect(deriveEnterpriseId('doc-1')).toBeNull();
    expect(deriveEnterpriseId('')).toBeNull();
    expect(deriveEnterpriseId('wdw.facilities.1_0.en_us')).toBeNull();
  });
});

describe('normalizeFacilityDocument', () => {
  it('derives the clean Enterprise_Id from a channel-prefixed _id and preserves the body', () => {
    const raw = {
      _id: 'wdw.facilities.1_0.en_us.restaurant.412260665;entityType=restaurant',
      _rev: '1-abc',
      name: 'Le Cellier',
      type: 'restaurant',
    };
    const doc = normalizeFacilityDocument(raw);
    expect(doc).not.toBeNull();
    expect(doc?.id).toBe('412260665;entityType=restaurant');
    // The raw fields are carried through untouched.
    expect(doc?.name).toBe('Le Cellier');
    expect(doc?.type).toBe('restaurant');
    expect((doc as { _id?: string })._id).toBe(raw._id);
  });

  it('keeps a clean top-level id as-is', () => {
    const doc = normalizeFacilityDocument({
      id: '80010177;entityType=Attraction',
      name: 'Space Mountain',
    });
    expect(doc?.id).toBe('80010177;entityType=Attraction');
  });

  it('prefers the Enterprise_Id token over the raw id when both an id and _id are present', () => {
    const doc = normalizeFacilityDocument({
      id: 'wdw.facilities.1_0.en_us.attraction.80010177;entityType=Attraction',
      name: 'Space Mountain',
    });
    expect(doc?.id).toBe('80010177;entityType=Attraction');
  });

  it('falls back to a non-Enterprise_Id id string rather than dropping the document', () => {
    const doc = normalizeFacilityDocument({ id: 'doc-1', name: 'Fixture' });
    expect(doc?.id).toBe('doc-1');
  });

  it('returns null only when no usable id string is present', () => {
    expect(normalizeFacilityDocument({ name: 'no id' })).toBeNull();
    expect(normalizeFacilityDocument({ id: '', _id: '' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// adaptFacilityDocument — real Sync Gateway shape → core-expected shape
// ---------------------------------------------------------------------------

describe('adaptFacilityDocument', () => {
  it('lowercases a PascalCase type so classification recognizes it', () => {
    
    expect(adaptFacilityDocument({ id: 'x', type: 'Attraction' }).type).toBe('attraction');
    expect(adaptFacilityDocument({ id: 'x', type: 'Dinner-Show' }).type).toBe('dinner-show');
    expect(adaptFacilityDocument({ id: 'x', type: 'restaurant' }).type).toBe('restaurant');
  });

  it('synthesizes an ancestors chain from the flat ancestor* fields', () => {
    
    const doc = adaptFacilityDocument({
      id: '17396838;entityType=Attraction',
      type: 'Attraction',
      ancestorThemePark: "Disney's Animal Kingdom Theme Park",
      ancestorThemeParkId: 'wdw.facilities.1_0.en_us.theme-park.80007823;entityType=theme-park',
      ancestorResortArea: "Disney's Animal Kingdom Resort Area",
      ancestorLand: 'Discovery Island',
    });
    const ancestors = doc.ancestors ?? [];
    const themePark = ancestors.find((a) => a.type === 'theme-park');
    expect(themePark?.name).toBe("Disney's Animal Kingdom Theme Park");
    // The ancestor id is normalized to the clean Enterprise_Id.
    expect(themePark?.id).toBe('80007823;entityType=theme-park');
  });

  it('coerces string coordinates to finite numbers', () => {
    
    const doc = adaptFacilityDocument({
      id: 'x',
      type: 'restaurant',
      latitude: '28.356385',
      longitude: '-81.560904',
    });
    expect(doc.latitude).toBeCloseTo(28.356385);
    expect(doc.longitude).toBeCloseTo(-81.560904);
  });

  it('converts the facets array into the grouped object the cores read', () => {
    
    const doc = adaptFacilityDocument({
      id: 'x',
      type: 'restaurant',
      facets: [
        { id: '$', name: '$ (…)', group: 'priceRangeDining' },
        { id: 'wheelchair-access', name: 'May Remain…', group: 'mobilityDisabilities' },
        { id: 'american-cuisine', name: 'American', group: 'cuisine' },
      ],
    });
    expect(doc.facets?.priceRangeDining).toEqual(['$']);
    expect(doc.facets?.accessibility).toEqual(['wheelchair-access']);
  });

  it('maps mealType/price meal periods to the cores type/priceTier', () => {
    
    const doc = adaptFacilityDocument({
      id: 'x',
      type: 'restaurant',
      mealPeriods: [{ id: '1', type: 'MealPeriod', mealType: 'Snack', price: '$ (…)' }],
    });
    expect(doc.mealPeriods).toEqual([{ type: 'Snack', priceTier: '$ (…)' }]);
  });

  it('is idempotent for a document already in the expected (fixture) shape', () => {
    
    const fixture = {
      id: '80010177;entityType=Attraction',
      type: 'attraction',
      name: 'Space Mountain',
      latitude: 28.4189,
      longitude: -81.5779,
      ancestors: [{ id: '80007944;entityType=theme-park', type: 'theme-park', name: 'Magic Kingdom Park' }],
      facets: { accessibility: ['must-transfer-wheelchair'] },
    };
    const doc = adaptFacilityDocument({ ...fixture });
    expect(doc.type).toBe('attraction');
    expect(doc.latitude).toBe(28.4189);
    expect(doc.ancestors).toEqual(fixture.ancestors);
    expect(doc.facets).toEqual(fixture.facets);
  });
});
