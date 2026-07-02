// Feature: catalog-navigation-redesign, Property 9: Canonical grid order
//
// Validates: Requirements 4.1, 6.1, 7.1, 8.1
//
// Property 9 (from tasks.md → 8.2):
//   `DESTINATIONS` always lists the eight Destinations in the fixed
//   Catalog_Home grid order — the four theme parks, then the two water parks,
//   then Disney Springs, then the aggregate Resorts Destination (R4.1) — and
//   `destinationCatalogFilter` maps each Destination to the correct
//   `GET /catalog` filter that fetches that Destination's active Experiences:
//   a park Destination (theme park, water park, or Disney Springs) maps to
//   `{ parkId }` equal to its `Park` identifier (R6.1, R7.1), while the
//   aggregate Resorts Destination maps to `{ areaType: 'Resort' }` (R8.1).
//
// Test strategy:
//   - `DESTINATIONS` is a module-level constant, so its exact ordering and
//     content are pinned with a deterministic assertion against an independent
//     expected sequence built straight from the requirement text (R4.1). This
//     is the canonical-order half of the property.
//   - The filter-mapping half is a genuine property: draw an arbitrary
//     Destination — both from the real `DESTINATIONS` set and from freely
//     generated `{ id, kind, title }` shapes spanning every `DestinationKind`
//     and a wide id space — and assert `destinationCatalogFilter` returns
//     exactly `{ areaType: 'Resort' }` for a `resorts` Destination and exactly
//     `{ parkId: d.id }` for every non-`resorts` Destination, with no stray
//     keys. Generating ids beyond the eight canonical values proves the
//     mapping is total and driven only by `kind`/`id`, not a lookup table.

import fc from 'fast-check';

import {
  DESTINATIONS,
  destinationCatalogFilter,
  type Destination,
  type DestinationId,
  type DestinationKind,
} from '../destinations';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Independent expected canonical order (encodes R4.1 directly)
// ---------------------------------------------------------------------------

// The eight Destinations in the fixed Catalog_Home grid order: four theme
// parks → two water parks → Disney Springs → aggregate Resorts (R4.1). Each
// carries the Level-2 grouping `kind` its Destination_Screen renders (R6/R7/R8)
// and the human-facing title.
const EXPECTED_DESTINATIONS: readonly Destination[] = [
  { id: 'Magic Kingdom', kind: 'themeOrWaterPark', title: 'Magic Kingdom' },
  { id: 'EPCOT', kind: 'themeOrWaterPark', title: 'EPCOT' },
  { id: 'Hollywood Studios', kind: 'themeOrWaterPark', title: 'Hollywood Studios' },
  { id: 'Animal Kingdom', kind: 'themeOrWaterPark', title: 'Animal Kingdom' },
  { id: 'Typhoon Lagoon', kind: 'themeOrWaterPark', title: 'Typhoon Lagoon' },
  { id: 'Blizzard Beach', kind: 'themeOrWaterPark', title: 'Blizzard Beach' },
  { id: 'Disney Springs', kind: 'disneySprings', title: 'Disney Springs' },
  { id: 'Resorts', kind: 'resorts', title: 'Resorts' },
];

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const kindArb: fc.Arbitrary<DestinationKind> = fc.constantFrom(
  'themeOrWaterPark',
  'disneySprings',
  'resorts',
);

// A freely generated Destination whose id ranges over the eight canonical ids
// AND arbitrary strings, so the filter mapping is exercised as a total
// function of (kind, id) rather than a lookup restricted to real Destinations.
const canonicalIdArb: fc.Arbitrary<DestinationId> = fc.constantFrom(
  ...(DESTINATIONS.map((d) => d.id) as DestinationId[]),
);
const anyIdArb = fc.oneof(
  { weight: 3, arbitrary: canonicalIdArb },
  { weight: 1, arbitrary: fc.string({ minLength: 1, maxLength: 16 }) as fc.Arbitrary<DestinationId> },
);

const generatedDestinationArb: fc.Arbitrary<Destination> = fc.record({
  id: anyIdArb,
  kind: kindArb,
  title: fc.string({ maxLength: 20 }),
});

// Also draw straight from the real Destination set so the property covers the
// exact objects the grid renders in addition to the synthetic shapes.
const realDestinationArb: fc.Arbitrary<Destination> = fc.constantFrom(
  ...(DESTINATIONS as readonly Destination[]),
);

const destinationArb: fc.Arbitrary<Destination> = fc.oneof(
  realDestinationArb,
  generatedDestinationArb,
);

// ---------------------------------------------------------------------------
// Property 9 — canonical order
// ---------------------------------------------------------------------------

describe('Property 9: DESTINATIONS is the fixed eight-Destination grid order (R4.1)', () => {
  it('lists the four theme parks, two water parks, Disney Springs, then Resorts in order', () => {
    // Deterministic: DESTINATIONS is a constant, so pin its full content and
    // order against the independently-derived expected sequence (R4.1).
    expect(DESTINATIONS).toEqual(EXPECTED_DESTINATIONS);

    // Exactly eight Destinations, ids in the fixed order.
    expect(DESTINATIONS).toHaveLength(8);
    expect(DESTINATIONS.map((d) => d.id)).toEqual([
      'Magic Kingdom',
      'EPCOT',
      'Hollywood Studios',
      'Animal Kingdom',
      'Typhoon Lagoon',
      'Blizzard Beach',
      'Disney Springs',
      'Resorts',
    ]);

    // Every id is unique — no Destination is duplicated in the grid.
    expect(new Set(DESTINATIONS.map((d) => d.id)).size).toBe(DESTINATIONS.length);

    // Exactly one aggregate Resorts Destination, and it is positioned last.
    const resortsDestinations = DESTINATIONS.filter((d) => d.kind === 'resorts');
    expect(resortsDestinations).toHaveLength(1);
    expect(DESTINATIONS[DESTINATIONS.length - 1]!.id).toBe('Resorts');
  });
});

// ---------------------------------------------------------------------------
// Property 9 — destination → catalog filter mapping
// ---------------------------------------------------------------------------

describe('Property 9: destinationCatalogFilter maps each Destination to the correct catalog filter (R6.1, R7.1, R8.1)', () => {
  it('maps the Resorts Destination to { areaType: "Resort" } and every park Destination to { parkId: id }', () => {
    fc.assert(
      fc.property(destinationArb, (d) => {
        const filter = destinationCatalogFilter(d);

        if (d.kind === 'resorts') {
          // R8.1: the aggregate Resorts Destination fetches every active
          // Resort-area Experience via areaType, with no parkId.
          expect(filter).toEqual({ areaType: 'Resort' });
        } else {
          // R6.1, R7.1: a park Destination (theme/water park or Disney
          // Springs) fetches by parkId equal to its Park identifier, with no
          // areaType.
          expect(filter).toEqual({ parkId: d.id });
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('produces the expected filter for each of the eight canonical Destinations', () => {
    // Concrete pinning of every real Destination's filter (R6.1, R7.1, R8.1).
    for (const d of DESTINATIONS) {
      const filter = destinationCatalogFilter(d);
      if (d.id === 'Resorts') {
        expect(filter).toEqual({ areaType: 'Resort' });
      } else {
        expect(filter).toEqual({ parkId: d.id });
      }
    }
  });
});
