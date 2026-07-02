// Feature: disney-facilities-catalog-source, Property 10: Resort production has one record per resort document and excludes resort-area
/**
 * Property-based tests for Resort production in the Catalog_Sync orchestrator
 * (design.md → "Catalog_Sync flow" split step, and sync.ts
 * `__internal.buildUpstreamCatalog` / `toUpstreamResort`).
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4
 *
 * Property 10 — Resort production has one record per resort document and
 * excludes resort-area:
 *
 *   - **One record per resort document (R6.1).** The split produces exactly one
 *     `UpstreamResort` for every Facility_Document whose `type` is `resort` —
 *     no more, no fewer. The set of produced resort `upstreamEntityId`s is
 *     precisely the set of `resort`-type document ids.
 *   - **`resort-area` is excluded (R6.2).** The structural `resort-area`
 *     Facility_Type is never `resort`, so no `resort-area` document ever appears
 *     in the Resort set. More broadly, no non-`resort` document (experience,
 *     non-experience, or `resort-area`) contributes a Resort record.
 *   - **Descriptive fields copied, null when absent (R6.3, R6.4).** Each Resort
 *     record carries `name`, `description`, `imageUrl`, `latitude`, `longitude`,
 *     `address`, and `phone` copied from its source document; an omitted
 *     `description`, `latitude`, `longitude`, `address`, or `phone` becomes
 *     `null` on the record. Imagery follows the shared `selectImageUrl`
 *     precedence (R6.5).
 *
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { __internal } from '../../sync.js';
import { selectImageUrl } from '../imagery.js';
import {
  EXPERIENCE_ELIGIBLE_TYPES,
  NON_EXPERIENCE_TYPES,
  RESORT_TYPE,
  type FacilityDocument,
} from '../facilityDoc.js';
import { assignInternalId } from '../bridge.js';

const NUM_RUNS = 100;

/** The structural type that must be excluded from the Resort set (R6.2). */
const RESORT_AREA_TYPE = 'resort-area';

/** An empty Bridge_Map: ids derive purely via UUIDv5 (no continuity entries). */
const EMPTY_BRIDGE: ReadonlyMap<string, string> = new Map();

/**
 * The full type space the split classifies over: `resort`, the excluded
 * `resort-area`, every Experience_Eligible_Type, and every other
 * Non_Experience_Type. Drawn from the shared source-of-truth sets so this test
 * cannot drift from the classification code.
 */
const ALL_TYPES: readonly string[] = [
  RESORT_TYPE,
  RESORT_AREA_TYPE,
  ...EXPERIENCE_ELIGIBLE_TYPES,
  ...[...NON_EXPERIENCE_TYPES].filter((t) => t !== RESORT_AREA_TYPE),
];

/** A finite coordinate within a realistic range (never NaN/Infinity). */
const coordArb = fc.double({ min: -180, max: 180, noNaN: true });

/** An optional coordinate: either a finite number or omitted. */
const coordFieldArb = coordArb;

/** A non-blank display name (normalization guarantees name is present + non-blank). */
const nameArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .map((s) => `Resort ${s}`);

/** An image field that is a real url, an empty string, whitespace, or arbitrary text. */
const imageArb = fc.oneof(
  fc.webUrl(),
  fc.constant(''),
  fc.constant('   '),
  fc.string(),
);

/**
 * A generated Facility_Document spec (everything except the id, which is
 * assigned per-index so ids are globally unique within a run).
 */
interface DocSpec {
  readonly type: string;
  readonly name: string;
  readonly description?: string;
  readonly detailImageUrl?: string;
  readonly listImageUrl?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly address?: string;
  readonly phone?: string;
}

const docSpecArb: fc.Arbitrary<DocSpec> = fc.record(
  {
    // Bias toward `resort` and `resort-area` so both branches are well exercised.
    type: fc.oneof(
      { weight: 3, arbitrary: fc.constant(RESORT_TYPE) },
      { weight: 2, arbitrary: fc.constant(RESORT_AREA_TYPE) },
      { weight: 3, arbitrary: fc.constantFrom(...ALL_TYPES) },
    ),
    name: nameArb,
    description: fc.string(),
    detailImageUrl: imageArb,
    listImageUrl: imageArb,
    latitude: coordFieldArb,
    longitude: coordFieldArb,
    address: fc.string(),
    phone: fc.string(),
  },
  { requiredKeys: ['type', 'name'] },
);

/** Turn a list of specs into Facility_Documents with globally-unique ids. */
function toDocuments(specs: readonly DocSpec[]): readonly FacilityDocument[] {
  return specs.map((spec, index) => {
    const doc: Record<string, unknown> = {
      id: `${100000 + index};entityType=${spec.type}`,
      type: spec.type,
      name: spec.name,
    };
    if (spec.description !== undefined) doc.description = spec.description;
    if (spec.detailImageUrl !== undefined) doc.detailImageUrl = spec.detailImageUrl;
    if (spec.listImageUrl !== undefined) doc.listImageUrl = spec.listImageUrl;
    if (spec.latitude !== undefined) doc.latitude = spec.latitude;
    if (spec.longitude !== undefined) doc.longitude = spec.longitude;
    if (spec.address !== undefined) doc.address = spec.address;
    if (spec.phone !== undefined) doc.phone = spec.phone;
    return doc as unknown as FacilityDocument;
  });
}

describe('Resort production — Property 10: one record per resort document, excludes resort-area', () => {
  it('produces exactly one Resort record per `resort` document and none for other types (R6.1, R6.2)', () => {
    fc.assert(
      fc.property(fc.array(docSpecArb, { maxLength: 40 }), (specs) => {
        const documents = toDocuments(specs);
        const { resorts } = __internal.buildUpstreamCatalog(documents, EMPTY_BRIDGE);

        const resortDocIds = documents
          .filter((d) => d.type === RESORT_TYPE)
          .map((d) => d.id);

        // Exactly one record per resort document: same cardinality...
        expect(resorts).toHaveLength(resortDocIds.length);

        // ...and the produced upstream ids are precisely the resort-doc ids.
        const producedIds = resorts.map((r) => r.upstreamEntityId).sort();
        expect(producedIds).toEqual([...resortDocIds].sort());

        // No duplicates: each resort document maps to a single record.
        expect(new Set(producedIds).size).toBe(producedIds.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never produces a Resort record from a `resort-area` document (R6.2)', () => {
    fc.assert(
      fc.property(fc.array(docSpecArb, { maxLength: 40 }), (specs) => {
        const documents = toDocuments(specs);
        const { resorts } = __internal.buildUpstreamCatalog(documents, EMPTY_BRIDGE);

        const resortAreaIds = new Set(
          documents.filter((d) => d.type === RESORT_AREA_TYPE).map((d) => d.id),
        );
        for (const record of resorts) {
          expect(resortAreaIds.has(record.upstreamEntityId)).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('copies descriptive fields from the source document, nulling absent ones (R6.3, R6.4)', () => {
    fc.assert(
      fc.property(fc.array(docSpecArb, { maxLength: 40 }), (specs) => {
        const documents = toDocuments(specs);
        const byId = new Map(documents.map((d) => [d.id, d]));
        const { resorts } = __internal.buildUpstreamCatalog(documents, EMPTY_BRIDGE);

        for (const record of resorts) {
          const doc = byId.get(record.upstreamEntityId);
          expect(doc).toBeDefined();
          if (doc === undefined) continue;

          // Internal_Id derived via the same Bridge_Map path (R6.6, R10).
          expect(record.id).toBe(assignInternalId(doc.id, EMPTY_BRIDGE));

          // name copied + trimmed (R6.3).
          expect(record.name).toBe((doc.name as string).trim());

          // description / address / phone: copied, null when absent (R6.3, R6.4).
          expect(record.description).toBe(doc.description ?? null);
          expect(record.address).toBe(doc.address ?? null);
          expect(record.phone).toBe(doc.phone ?? null);

          // coordinates: copied when finite, null when absent (R6.4).
          expect(record.latitude).toBe(
            Number.isFinite(doc.latitude) ? doc.latitude : null,
          );
          expect(record.longitude).toBe(
            Number.isFinite(doc.longitude) ? doc.longitude : null,
          );

          // imagery via the shared precedence (R6.5).
          expect(record.imageUrl).toBe(selectImageUrl(doc));
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is total and never throws over the full type space', () => {
    fc.assert(
      fc.property(fc.array(docSpecArb, { maxLength: 40 }), (specs) => {
        const documents = toDocuments(specs);
        expect(() =>
          __internal.buildUpstreamCatalog(documents, EMPTY_BRIDGE),
        ).not.toThrow();
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('Resort production — Property 10 fixed regression examples', () => {
  it('produces one fully-populated Resort record from a complete resort document (R6.1, R6.3)', () => {
    const doc: FacilityDocument = {
      id: '80010408;entityType=resort',
      type: 'resort',
      name: "  Disney's Polynesian Village Resort  ",
      description: 'A South Seas paradise.',
      detailImageUrl: 'https://cdn.disney.com/poly-detail.jpg',
      listImageUrl: 'https://cdn.disney.com/poly-list.jpg',
      latitude: 28.4056,
      longitude: -81.5836,
      address: '1600 Seven Seas Drive',
      phone: '(407) 824-2000',
    };
    const { resorts } = __internal.buildUpstreamCatalog([doc], EMPTY_BRIDGE);

    expect(resorts).toHaveLength(1);
    expect(resorts[0]).toEqual({
      id: assignInternalId(doc.id, EMPTY_BRIDGE),
      upstreamEntityId: '80010408;entityType=resort',
      name: "Disney's Polynesian Village Resort",
      description: 'A South Seas paradise.',
      imageUrl: 'https://cdn.disney.com/poly-detail.jpg',
      latitude: 28.4056,
      longitude: -81.5836,
      address: '1600 Seven Seas Drive',
      phone: '(407) 824-2000',
    });
  });

  it('nulls every absent descriptive field on a bare resort document (R6.4, R6.5)', () => {
    const doc: FacilityDocument = {
      id: '80010409;entityType=resort',
      type: 'resort',
      name: 'Bare Resort',
    };
    const { resorts } = __internal.buildUpstreamCatalog([doc], EMPTY_BRIDGE);

    expect(resorts).toHaveLength(1);
    expect(resorts[0]).toEqual({
      id: assignInternalId(doc.id, EMPTY_BRIDGE),
      upstreamEntityId: '80010409;entityType=resort',
      name: 'Bare Resort',
      description: null,
      imageUrl: null,
      latitude: null,
      longitude: null,
      address: null,
      phone: null,
    });
  });

  it('excludes a resort-area document from the Resort set (R6.2)', () => {
    const resortArea: FacilityDocument = {
      id: '80007798;entityType=resort-area',
      type: 'resort-area',
      name: 'Magic Kingdom Resort Area',
    };
    const resort: FacilityDocument = {
      id: '80010408;entityType=resort',
      type: 'resort',
      name: 'Grand Floridian',
    };
    const { resorts } = __internal.buildUpstreamCatalog(
      [resortArea, resort],
      EMPTY_BRIDGE,
    );

    expect(resorts).toHaveLength(1);
    expect(resorts[0]?.upstreamEntityId).toBe('80010408;entityType=resort');
  });
});
