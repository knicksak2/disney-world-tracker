// Feature: catalog-navigation-redesign — property tests for the pure grouping
// cores in `catalogGrouping.ts` (tasks.md → 8.4).
//
// This suite implements four of the feature's correctness properties against
// the framework-free grouping folds that carry the Level-2 Destination_Screen
// grouping / ordering / partition guarantees. Each property runs with
// `fast-check` at `numRuns: 100`.
//
//   - Property 10 — Land grouping totality and ordering (groupByLand).
//       Validates: Requirements 6.2, 6.3, 6.6
//   - Property 11 — Category-filtered grouping (groupByLandFiltered).
//       Validates: Requirements 6.7, 6.8, 6.9
//   - Property 12 — Category grouping order (groupByCategory).
//       Validates: Requirements 7.2, 7.5
//   - Property 13 — Resort rows totality (buildResortRows).
//       Validates: Requirements 8.2, 8.3, 8.4
//
// The grouping cores never clone an Experience/Resort, so every item an output
// section/row holds is the *same object reference* as the corresponding input.
// The properties exploit this: within-section ordering is checked with a
// case-insensitive-name oracle, and the "exactly one section" / total-partition
// guarantees are checked by reference identity, which is unambiguous because
// fast-check produces a fresh object for every generated item.

import fc from 'fast-check';

import { AREA_TYPES, EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type { ExperienceDTO, ResortDTO } from '@dwt/shared';

import {
  browseLandOf,
  buildResortRows,
  groupByCategory,
  groupByLand,
  groupByLandFiltered,
  groupByPavilionFiltered,
  LAND_CATCHALL_KEY,
  RESORT_CATCHALL_ID,
} from '../catalogGrouping';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Oracles
// ---------------------------------------------------------------------------

/**
 * Independent reference for the case-insensitive ascending comparison the cores
 * use for ordering Land sections, Experiences-within-section, and Resort
 * anchors (R6.2, R6.3, R8.3). Mirrors `localeCompare(..., { sensitivity: 'base' })`.
 */
function compareCI(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

/** Whether a persisted Land value is a usable, non-empty section name. */
function isNamedLand(land: string | null | undefined): land is string {
  return typeof land === 'string' && land.trim().length > 0;
}

/**
 * Assert `flat` and `expected` are the same multiset *by reference identity*:
 * identical length, no duplicate reference in `flat`, and identical membership
 * both ways. Because every generated item is a distinct object, this proves
 * each input item appears in the output exactly once (total partition).
 */
function expectSameByReference<T>(flat: readonly T[], expected: readonly T[]): void {
  expect(flat).toHaveLength(expected.length);
  const flatSet = new Set<T>(flat);
  expect(flatSet.size).toBe(flat.length);
  for (const item of expected) {
    expect(flatSet.has(item)).toBe(true);
  }
  for (const item of flat) {
    expect(expected.includes(item)).toBe(true);
  }
}

/** Assert a list of names is in case-insensitive ascending order. */
function expectCaseInsensitiveAscending(names: readonly string[]): void {
  for (let i = 1; i < names.length; i += 1) {
    expect(compareCI(names[i - 1]!, names[i]!)).toBeLessThanOrEqual(0);
  }
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// A pool of Land-name candidates that deliberately collide across case (so the
// case-insensitive ordering and same-Land bucketing are exercised) and vary in
// alphabetical position.
const namedLandArb = fc.constantFrom(
  'Fantasyland',
  'fantasyland',
  'FANTASYLAND',
  'Tomorrowland',
  'tomorrowland',
  'Adventureland',
  'World Showcase',
  'Toy Story Land',
  'Pandora',
  'Zootopia Land',
);

// A Land value spanning: named lands, explicit null, whitespace-only, and empty
// string — the last two must be treated as "no Land" and routed to the
// catch-all (R6.6 / mirrored on groupByLand's catch-all).
const landArb = fc.oneof(
  { weight: 5, arbitrary: namedLandArb },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constant('   ') },
  { weight: 1, arbitrary: fc.constant('') },
);

// Experience names that collide across case so within-section ordering is
// genuinely case-insensitive rather than accidentally passing on distinct casing.
const nameArb = fc.constantFrom(
  'Space Mountain',
  'space mountain',
  'Astro Orbiter',
  'astro orbiter',
  'Big Thunder',
  'big thunder',
  'Carousel',
  'Zebra Encounter',
  'apple',
  'Apple',
);

/**
 * An Experience over the full Park × Category space with a mixed Land value and
 * a mostly-shared resortId pool (so resort matching + catch-all are exercised).
 */
function experienceArb(resortIdPool: readonly string[]): fc.Arbitrary<ExperienceDTO> {
  const resortIdArb = fc.oneof(
    { weight: 4, arbitrary: fc.constantFrom(...resortIdPool) },
    { weight: 1, arbitrary: fc.constant(null) },
    // An unmatched, non-empty id that is NOT in the resort pool → catch-all.
    { weight: 1, arbitrary: fc.constant('__unmatched_resort_id__') },
  );

  return fc.record({
    id: fc.uuid(),
    name: nameArb,
    park: fc.constantFrom(...PARKS),
    category: fc.constantFrom(...EXPERIENCE_CATEGORIES),
    description: fc.constant(''),
    active: fc.constant(true),
    imageUrl: fc.constant(null),
    areaType: fc.constantFrom(...AREA_TYPES),
    resortId: resortIdArb,
    land: landArb,
  });
}

// A stable pool of resort ids used both to build ResortDTOs and to bias the
// Experiences' resortId toward matching them.
const RESORT_ID_POOL = [
  'resort-a',
  'resort-b',
  'resort-c',
  'resort-d',
] as const;

const experiencesArb = fc.array(experienceArb(RESORT_ID_POOL), { maxLength: 30 });

// Resort names that collide across case so anchor ordering is case-insensitive.
const resortNameArb = fc.constantFrom(
  'Grand Floridian',
  'grand floridian',
  'Contemporary',
  'Animal Kingdom Lodge',
  'Pop Century',
  'art of animation',
  'Beach Club',
);

function resortArb(): fc.Arbitrary<ResortDTO> {
  return fc.record({
    id: fc.constantFrom(...RESORT_ID_POOL),
    name: resortNameArb,
    description: fc.constant(null),
    imageUrl: fc.constant(null),
    latitude: fc.constant(null),
    longitude: fc.constant(null),
    address: fc.constant(null),
    phone: fc.constant(null),
    representingExperienceId: fc.option(fc.uuid(), { nil: null }),
  });
}

// A set of resorts with unique ids (a Destination lists each active Resort once).
const resortsArb = fc
  .uniqueArray(resortArb(), {
    maxLength: RESORT_ID_POOL.length,
    selector: (r) => r.id,
  });

// ---------------------------------------------------------------------------
// Property 10 — Land grouping totality and ordering
// ---------------------------------------------------------------------------
//
// Validates: Requirements 6.2, 6.3, 6.6

describe('Property 10: groupByLand is a totally-partitioning, case-insensitively ordered Land grouping', () => {
  it('orders named Land sections + items case-insensitively, appends the catch-all last, and omits nothing', () => {
    fc.assert(
      fc.property(experiencesArb, (experiences) => {
        const sections = groupByLand(experiences);

        const namedSections = sections.filter((s) => s.key !== LAND_CATCHALL_KEY);
        const catchallSections = sections.filter((s) => s.key === LAND_CATCHALL_KEY);

        // R6.2: named Land sections are ordered case-insensitively ascending by
        // Land name.
        expectCaseInsensitiveAscending(namedSections.map((s) => s.title));

        // Each named section's key/title is a real Land name and every item in
        // it carries exactly that persisted Land.
        for (const section of namedSections) {
          for (const experience of section.items) {
            expect(experience.land).toBe(section.key);
          }
          // R6.3: items within a section are ordered case-insensitively by name.
          expectCaseInsensitiveAscending(section.items.map((e) => e.name));
        }

        // R6.6: at most one catch-all section, and when present it is last.
        expect(catchallSections.length).toBeLessThanOrEqual(1);
        if (catchallSections.length === 1) {
          expect(sections[sections.length - 1]!.key).toBe(LAND_CATCHALL_KEY);
          // Every catch-all item genuinely has no usable Land.
          for (const experience of catchallSections[0]!.items) {
            expect(isNamedLand(experience.land)).toBe(false);
          }
          // R6.3 ordering applies to the catch-all too.
          expectCaseInsensitiveAscending(catchallSections[0]!.items.map((e) => e.name));
        }

        // The catch-all appears iff at least one Experience has no usable Land.
        const anyCatchall = experiences.some((e) => !isNamedLand(e.land));
        expect(catchallSections.length).toBe(anyCatchall ? 1 : 0);

        // R6.6: total partition — the union of every section's items equals the
        // input, each Experience appearing exactly once (nothing omitted).
        const flat = sections.flatMap((s) => [...s.items]);
        expectSameByReference(flat, experiences);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 11 — Category-filtered grouping
// ---------------------------------------------------------------------------
//
// Validates: Requirements 6.7, 6.8, 6.9

describe('Property 11: groupByLandFiltered passes through null and filters+prunes by category', () => {
  it('returns the unfiltered grouping for a null category (R6.7)', () => {
    fc.assert(
      fc.property(experiencesArb, (experiences) => {
        // R6.7: a null category yields exactly the full Land grouping.
        expect(groupByLandFiltered(experiences, null)).toEqual(groupByLand(experiences));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('keeps only the selected category, preserves ordering, and drops emptied sections (R6.8, R6.9)', () => {
    fc.assert(
      fc.property(experiencesArb, fc.constantFrom(...EXPERIENCE_CATEGORIES), (experiences, category) => {
        const filtered = groupByLandFiltered(experiences, category);
        const oracle = groupByLand(experiences.filter((e) => e.category === category));

        // R6.8: filtering preserves the Land grouping/ordering exactly as if the
        // input had been narrowed to the category first, then grouped.
        expect(filtered).toEqual(oracle);

        // R6.8: every surviving item is of the selected category.
        for (const section of filtered) {
          for (const experience of section.items) {
            expect(experience.category).toBe(category);
          }
          // R6.9: no surviving section is empty.
          expect(section.items.length).toBeGreaterThan(0);
        }

        // R6.9: a Land section present in the full grouping but with no item of
        // the selected category is omitted from the filtered grouping.
        const full = groupByLand(experiences);
        for (const fullSection of full) {
          const hasCategoryItem = fullSection.items.some((e) => e.category === category);
          const survives = filtered.some((s) => s.key === fullSection.key);
          expect(survives).toBe(hasCategoryItem);
        }

        // Total partition over the category subset — nothing of the category is lost.
        const flat = filtered.flatMap((s) => [...s.items]);
        expectSameByReference(flat, experiences.filter((e) => e.category === category));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 12 — Category grouping order
// ---------------------------------------------------------------------------
//
// Validates: Requirements 7.2, 7.5

describe('Property 12: groupByCategory follows canonical category order with empties omitted', () => {
  it('emits present categories in canonical order, one group each, omitting empty categories', () => {
    fc.assert(
      fc.property(experiencesArb, (experiences) => {
        const sections = groupByCategory(experiences);

        // R7.2: the emitted category order is a subsequence of the canonical
        // EXPERIENCE_CATEGORIES order.
        const emittedCategories = sections.map((s) => s.key);
        const canonicalIndices = emittedCategories.map((c) =>
          EXPERIENCE_CATEGORIES.indexOf(c as (typeof EXPERIENCE_CATEGORIES)[number]),
        );
        for (const idx of canonicalIndices) {
          expect(idx).toBeGreaterThanOrEqual(0);
        }
        for (let i = 1; i < canonicalIndices.length; i += 1) {
          expect(canonicalIndices[i]!).toBeGreaterThan(canonicalIndices[i - 1]!);
        }

        // R7.5: a category is present iff at least one Experience has it, and
        // every emitted group is non-empty and holds only its category.
        for (const category of EXPERIENCE_CATEGORIES) {
          const present = experiences.some((e) => e.category === category);
          const section = sections.find((s) => s.key === category);
          expect(section !== undefined).toBe(present);
          if (section) {
            expect(section.items.length).toBeGreaterThan(0);
            for (const experience of section.items) {
              expect(experience.category).toBe(category);
            }
          }
        }

        // Total partition — every Experience lands in exactly one category group.
        const flat = sections.flatMap((s) => [...s.items]);
        expectSameByReference(flat, experiences);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 13 — Resort rows totality
// ---------------------------------------------------------------------------
//
// Validates: Requirements 8.2, 8.3, 8.4

describe('Property 13: buildResortRows anchors every Resort in order and totally partitions Experiences', () => {
  it('lists every Resort anchor case-insensitively, groups Experiences under their resort or the single trailing catch-all', () => {
    fc.assert(
      fc.property(experiencesArb, resortsArb, (experiences, resorts) => {
        const rows = buildResortRows(experiences, resorts);

        const anchorRows = rows.filter((r) => r.kind === 'resort');
        const experienceRows = rows.filter((r) => r.kind === 'experience');

        const knownResortIds = new Set(resorts.map((r) => r.id));
        const anyCatchall = experiences.some(
          (e) => !(typeof e.resortId === 'string' && knownResortIds.has(e.resortId)),
        );

        // R8.3: every active Resort appears as exactly one anchor (including
        // resorts with no Experiences), plus the catch-all anchor when needed.
        const specificAnchors = anchorRows.filter(
          (r) => r.kind === 'resort' && r.resort.id !== RESORT_CATCHALL_ID,
        );
        const catchallAnchors = anchorRows.filter(
          (r) => r.kind === 'resort' && r.resort.id === RESORT_CATCHALL_ID,
        );
        expect(specificAnchors).toHaveLength(resorts.length);
        expect(new Set(specificAnchors.map((r) => (r as { resort: ResortDTO }).resort.id)).size).toBe(
          resorts.length,
        );
        expect(catchallAnchors.length).toBe(anyCatchall ? 1 : 0);

        // R8.3: specific Resort anchors are ordered case-insensitively by name,
        // and any catch-all anchor comes after all of them.
        const specificNames = specificAnchors.map(
          (r) => (r as { resort: ResortDTO }).resort.name,
        );
        expectCaseInsensitiveAscending(specificNames);
        if (catchallAnchors.length === 1) {
          const lastAnchor = anchorRows[anchorRows.length - 1]!;
          expect((lastAnchor as { resort: ResortDTO }).resort.id).toBe(RESORT_CATCHALL_ID);
        }

        // R8.2 / R8.4: each Experience row belongs to the nearest anchor above
        // it; verify that grouping by walking the flat row list. An Experience
        // under a specific Resort matches that Resort's id; an Experience under
        // the catch-all has no matched resortId.
        let currentAnchorId: string | null = null;
        for (const row of rows) {
          if (row.kind === 'resort') {
            currentAnchorId = row.resort.id;
          } else {
            expect(currentAnchorId).not.toBeNull();
            const { resortId } = row.experience;
            if (currentAnchorId === RESORT_CATCHALL_ID) {
              // R8.4: catch-all holds Experiences with no/unmatched resortId.
              expect(typeof resortId === 'string' && knownResortIds.has(resortId)).toBe(false);
            } else {
              // R8.2: an Experience under a specific Resort matches its id.
              expect(resortId).toBe(currentAnchorId);
            }
          }
        }

        // R8.2/R8.4: total partition — each Experience appears exactly once
        // across all rows, none omitted.
        const flat = experienceRows.map((r) => (r as { experience: ExperienceDTO }).experience);
        expectSameByReference(flat, experiences);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 14 — Pavilion-aware Land grouping (World Showcase browse facet)
// ---------------------------------------------------------------------------
//
// `groupByPavilionFiltered` behaves exactly like `groupByLandFiltered` except an
// EPCOT World Showcase Experience (one carrying a resolved `worldShowcaseCountry`)
// is grouped under its country pavilion instead of the umbrella "World Showcase"
// Land, so the eleven pavilions become individually browsable sections.

// The eleven World Showcase pavilions.
const pavilionArb = fc.constantFrom(
  'Mexico',
  'Norway',
  'China',
  'Germany',
  'Italy',
  'The American Adventure',
  'Japan',
  'Morocco',
  'France',
  'United Kingdom',
  'Canada',
);

/**
 * A mix of World Showcase Experiences (land = "World Showcase" with a resolved
 * pavilion) and ordinary Experiences (no `worldShowcaseCountry`), so both the
 * pavilion-explosion and the pass-through-for-everything-else paths are hit.
 */
const pavilionExperienceArb: fc.Arbitrary<ExperienceDTO> = fc.oneof(
  fc.record({
    id: fc.uuid(),
    name: nameArb,
    park: fc.constant<'EPCOT'>('EPCOT'),
    category: fc.constantFrom(...EXPERIENCE_CATEGORIES),
    description: fc.constant(''),
    active: fc.constant(true),
    imageUrl: fc.constant(null),
    areaType: fc.constant<'ThemePark'>('ThemePark'),
    resortId: fc.constant(null),
    land: fc.constant('World Showcase'),
    worldShowcaseCountry: pavilionArb,
  }),
  experienceArb(RESORT_ID_POOL),
);

const pavilionExperiencesArb = fc.array(pavilionExperienceArb, { maxLength: 30 });

describe('Property 14: groupByPavilionFiltered explodes World Showcase into per-pavilion sections', () => {
  it('browseLandOf returns the pavilion for World Showcase experiences, else the persisted Land', () => {
    fc.assert(
      fc.property(pavilionExperienceArb, (experience) => {
        const expected = isNamedLand(experience.worldShowcaseCountry)
          ? experience.worldShowcaseCountry
          : experience.land ?? null;
        expect(browseLandOf(experience)).toBe(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('groups World Showcase experiences under their pavilion (never "World Showcase") and totally partitions', () => {
    fc.assert(
      fc.property(pavilionExperiencesArb, (experiences) => {
        const sections = groupByPavilionFiltered(experiences, null);

        // Each item sits under a section keyed by its browse land, and no
        // experience that resolved a pavilion is grouped under the umbrella
        // "World Showcase" (those explode into per-pavilion sections). An
        // ordinary experience whose persisted Land is literally "World Showcase"
        // but carries no pavilion still legitimately forms a "World Showcase"
        // section — that is the fallback path.
        for (const section of sections) {
          if (section.key === LAND_CATCHALL_KEY) continue;
          for (const experience of section.items) {
            expect(section.key).toBe(browseLandOf(experience));
            if (section.key === 'World Showcase') {
              expect(isNamedLand(experience.worldShowcaseCountry)).toBe(false);
            }
          }
        }

        // Named sections ordered case-insensitively; catch-all last.
        const named = sections.filter((s) => s.key !== LAND_CATCHALL_KEY);
        expectCaseInsensitiveAscending(named.map((s) => s.title));

        // Total partition — nothing dropped or duplicated.
        const flat = sections.flatMap((s) => [...s.items]);
        expectSameByReference(flat, experiences);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is identical to groupByLandFiltered when no experience carries a pavilion (no-op elsewhere)', () => {
    // Ordinary experiences never set `worldShowcaseCountry`, so browseLandOf
    // collapses to the persisted Land and the two groupings must coincide.
    const ordinaryArb = fc.array(experienceArb(RESORT_ID_POOL), { maxLength: 30 });
    fc.assert(
      fc.property(
        ordinaryArb,
        fc.oneof(fc.constant(null), fc.constantFrom(...EXPERIENCE_CATEGORIES)),
        (experiences, category) => {
          expect(groupByPavilionFiltered(experiences, category)).toEqual(
            groupByLandFiltered(experiences, category),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('respects the category filter, pruning pavilions with no matching experience', () => {
    fc.assert(
      fc.property(
        pavilionExperiencesArb,
        fc.constantFrom(...EXPERIENCE_CATEGORIES),
        (experiences, category) => {
          const filtered = groupByPavilionFiltered(experiences, category);
          for (const section of filtered) {
            expect(section.items.length).toBeGreaterThan(0);
            for (const experience of section.items) {
              expect(experience.category).toBe(category);
            }
          }
          const flat = filtered.flatMap((s) => [...s.items]);
          expectSameByReference(
            flat,
            experiences.filter((e) => e.category === category),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
