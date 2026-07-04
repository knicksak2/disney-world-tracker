// Feature: catalog-navigation-redesign — property tests for the pure Info_Tag
// core in `infoTags.ts` (tasks.md → 8.6).
//
// This suite implements two of the feature's correctness properties against the
// framework-free Info_Tag construction folds that carry the enriched
// Experience_Detail_Screen ordering/omission guarantees and the list/detail
// price-tag parity guarantee. Each property runs with `fast-check` at
// `numRuns: 100`.
//
//   - Property 14 — Tag ordering and omission (buildInfoTags).
//       Validates: Requirements 9.8, 9.11
//   - Property 15 — List/detail price parity (priceTierListTag).
//       Validates: Requirements 9.9

import fc from 'fast-check';

import { AREA_TYPES } from '@dwt/shared';
import type {
  AreaType,
  FacetValueDTO,
  GroupedFacetsDTO,
  HeightRequirementDTO,
  MealPeriodDTO,
} from '@dwt/shared';

import {
  buildInfoTags,
  priceTierListTag,
  type InfoTagExperience,
  type InfoTagKind,
} from '../infoTags';

const NUM_RUNS = 100;

// The fixed relative order the detail view emits Info_Tags in (R9.11). Every
// present tag must appear in this order; absent tags are simply skipped.
const KIND_ORDER: readonly InfoTagKind[] = [
  'land',
  'priceTier',
  'accessibility',
  'coordinates',
  'mealPeriod',
  'resort',
  'resortArea',
];

function kindIndex(kind: InfoTagKind): number {
  return KIND_ORDER.indexOf(kind);
}

// ---------------------------------------------------------------------------
// Oracles (independent re-statement of the presence rules in infoTags.ts)
// ---------------------------------------------------------------------------

/** A string source is "present" when it is a non-whitespace-only string. */
function isPresentString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** A coordinate is "present" only when it is a finite number. */
function isPresentNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// ---------------------------------------------------------------------------
// Generators — deliberately span present, absent, null, and whitespace-only
// values so the omission rules (R9.8) are genuinely exercised rather than only
// the happy path.
// ---------------------------------------------------------------------------

// A string value spanning: real names (some padded with whitespace), explicit
// null, explicit undefined, whitespace-only, and empty — the last four must all
// be treated as "no value" and omitted.
const optionalStringArb = fc.oneof(
  { weight: 5, arbitrary: fc.constantFrom('Fantasyland', ' Tomorrowland ', 'World Showcase', '$$', ' $$$ ') },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constant(undefined) },
  { weight: 1, arbitrary: fc.constant('   ') },
  { weight: 1, arbitrary: fc.constant('') },
) as fc.Arbitrary<string | null | undefined>;

// A coordinate value spanning finite numbers plus the non-finite / missing
// cases (null, undefined, NaN, Infinity) that must NOT produce a coordinate tag.
const optionalCoordArb = fc.oneof(
  { weight: 5, arbitrary: fc.double({ min: -180, max: 180, noNaN: true }) },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constant(undefined) },
  { weight: 1, arbitrary: fc.constant(Number.NaN) },
  { weight: 1, arbitrary: fc.constant(Number.POSITIVE_INFINITY) },
) as fc.Arbitrary<number | null | undefined>;

// An accessibility list: entries mix real tags with whitespace-only/empty
// strings (which must be omitted), or the whole field is absent.
const accessibilityArb = fc.oneof(
  { weight: 4, arbitrary: fc.array(
      fc.constantFrom('Wheelchair Accessible', ' Service Animals ', 'ASL', '', '   '),
      { maxLength: 5 },
    ) },
  { weight: 1, arbitrary: fc.constant(undefined) },
) as fc.Arbitrary<readonly string[] | undefined>;

// A meal-periods list: entries mix real period types with whitespace-only/empty
// types (which must be omitted), or the whole field is absent.
const mealPeriodArb: fc.Arbitrary<MealPeriodDTO> = fc.record({
  type: fc.constantFrom('Breakfast', ' Lunch ', 'Dinner', '', '   '),
  priceTier: fc.oneof(fc.constant(null), fc.constantFrom('$', '$$')),
});
const mealPeriodsArb = fc.oneof(
  { weight: 4, arbitrary: fc.array(mealPeriodArb, { maxLength: 5 }) },
  { weight: 1, arbitrary: fc.constant(undefined) },
) as fc.Arbitrary<readonly MealPeriodDTO[] | undefined>;

const areaTypeArb: fc.Arbitrary<AreaType> = fc.constantFrom(...AREA_TYPES);

// `fc.record` always materializes every key, so each optional field carries an
// explicit `| undefined`. `InfoTagExperience` declares those fields optional
// under `exactOptionalPropertyTypes`, which forbids an *explicit* `undefined`
// at the type level even though `buildInfoTags` handles it at runtime (that
// "absent value" case is exactly what these generators exercise). The cast
// keeps the generator spanning present/null/undefined while satisfying the
// stricter optional-property typing.
const experienceArb = fc.record({
  areaType: areaTypeArb,
  land: optionalStringArb,
  priceTier: optionalStringArb,
  accessibility: accessibilityArb,
  latitude: optionalCoordArb,
  longitude: optionalCoordArb,
  mealPeriods: mealPeriodsArb,
  resortId: optionalStringArb,
  resortArea: optionalStringArb,
}) as fc.Arbitrary<InfoTagExperience>;

// The resort-name argument spans present, null, and whitespace-only values so
// the resort tag's gating (R9.7 / omission R9.8) is exercised both ways.
const resortNameArb = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom('Grand Floridian', ' Contemporary ', 'Pop Century') },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constant('   ') },
) as fc.Arbitrary<string | null>;

// ---------------------------------------------------------------------------
// Property 14 — Tag ordering and omission
// ---------------------------------------------------------------------------
//
// Validates: Requirements 9.8, 9.11

describe('Property 14: buildInfoTags preserves the fixed relative order and omits absent/empty values', () => {
  it('emits tags only for present values, each with a non-empty label, in the canonical relative order', () => {
    fc.assert(
      fc.property(experienceArb, resortNameArb, (experience, resortName) => {
        const tags = buildInfoTags(experience, resortName);

        // R9.11: every emitted tag's kind index is non-decreasing, i.e. present
        // tags appear in the fixed Land → priceTier → accessibility →
        // coordinates → mealPeriod → resort order.
        const indices = tags.map((t) => kindIndex(t.kind));
        for (const idx of indices) {
          expect(idx).toBeGreaterThanOrEqual(0);
        }
        for (let i = 1; i < indices.length; i += 1) {
          expect(indices[i]!).toBeGreaterThanOrEqual(indices[i - 1]!);
        }

        // R9.8: no tag is ever emitted with an empty / whitespace-only label.
        for (const tag of tags) {
          expect(tag.label.trim().length).toBeGreaterThan(0);
          expect(tag.accessibilityLabel.trim().length).toBeGreaterThan(0);
        }

        const countOfKind = (kind: InfoTagKind): number =>
          tags.filter((t) => t.kind === kind).length;

        // R9.2 / R9.8 — Land: present iff the land string is non-empty.
        expect(countOfKind('land')).toBe(isPresentString(experience.land) ? 1 : 0);
        if (isPresentString(experience.land)) {
          const landTag = tags.find((t) => t.kind === 'land')!;
          expect(landTag.label).toBe(experience.land.trim());
        }

        // R9.3 / R9.8 — price tier: present iff the tier string is non-empty.
        expect(countOfKind('priceTier')).toBe(
          isPresentString(experience.priceTier) ? 1 : 0,
        );

        // R9.4 / R9.8 — accessibility: exactly one tag per non-empty entry, in
        // the persisted order.
        const expectedAccessibility = (experience.accessibility ?? []).filter(isPresentString);
        expect(countOfKind('accessibility')).toBe(expectedAccessibility.length);
        const emittedAccessibility = tags
          .filter((t) => t.kind === 'accessibility')
          .map((t) => t.label);
        expect(emittedAccessibility).toEqual(expectedAccessibility.map((v) => v.trim()));

        // R9.5 / R9.8 — coordinates: present iff BOTH lat and long are finite.
        const coordsPresent =
          isPresentNumber(experience.latitude) && isPresentNumber(experience.longitude);
        expect(countOfKind('coordinates')).toBe(coordsPresent ? 1 : 0);

        // R9.6 / R9.8 — meal periods: exactly one tag per non-empty period type.
        const expectedPeriods = (experience.mealPeriods ?? []).filter((p) =>
          isPresentString(p.type),
        );
        expect(countOfKind('mealPeriod')).toBe(expectedPeriods.length);

        // R9.7 / R9.8 — resort: present iff area is Resort AND a resort is
        // referenced AND its name is available.
        const resortPresent =
          experience.areaType === 'Resort' &&
          isPresentString(experience.resortId) &&
          isPresentString(resortName);
        expect(countOfKind('resort')).toBe(resortPresent ? 1 : 0);

        // Resort area: present iff area is Resort AND a Resort_Area is
        // persisted (independent of whether a specific resort resolved).
        const resortAreaPresent =
          experience.areaType === 'Resort' &&
          isPresentString(experience.resortArea);
        expect(countOfKind('resortArea')).toBe(resortAreaPresent ? 1 : 0);
        if (resortAreaPresent) {
          const areaTag = tags.find((t) => t.kind === 'resortArea')!;
          expect(areaTag.label).toBe(experience.resortArea!.trim());
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 15 — List/detail price parity
// ---------------------------------------------------------------------------
//
// Validates: Requirements 9.9

// A non-empty, already-trimmed price-tier value: the list row passes the raw
// persisted tier to `priceTierListTag`, and the detail view builds its tag from
// the same tier; both must present it identically.
const trimmedPriceTierArb = fc
  .oneof(
    fc.constantFrom('$', '$$', '$$$', '$$$$'),
    fc.string({ minLength: 1, maxLength: 8 }),
  )
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

describe('Property 15: priceTierListTag matches the detail price-tier tag exactly', () => {
  it('produces identical label text and value for the list row and the detail view (R9.9)', () => {
    fc.assert(
      fc.property(trimmedPriceTierArb, areaTypeArb, (priceTier, areaType) => {
        const listTag = priceTierListTag(priceTier);

        // The detail price-tier tag comes from buildInfoTags over an Experience
        // carrying the same persisted tier. Land is absent so priceTier is the
        // first emitted tag; the other enrichment fields are omitted entirely
        // (their optional-and-absent form under `exactOptionalPropertyTypes`)
        // so no tag but the price tier is produced.
        const detailTags = buildInfoTags(
          {
            areaType,
            land: null,
            priceTier,
            latitude: null,
            longitude: null,
            resortId: null,
          },
          null,
        );
        const detailPriceTags = detailTags.filter((t) => t.kind === 'priceTier');

        // Exactly one price-tier tag on the detail view, identical to the list tag.
        expect(detailPriceTags).toHaveLength(1);
        const detailTag = detailPriceTags[0]!;

        // R9.9: identical kind, label text, and screen-reader value.
        expect(listTag.kind).toBe('priceTier');
        expect(detailTag.kind).toBe('priceTier');
        expect(listTag.label).toBe(detailTag.label);
        expect(listTag.accessibilityLabel).toBe(detailTag.accessibilityLabel);
        expect(listTag).toEqual(detailTag);

        // The presented value carries the persisted tier verbatim.
        expect(listTag.label).toBe(priceTier);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: experience-facet-enrichment, Property 11: Info_Tags surface each
// enrichment value with an accessible label.
//
// For any Experience, buildInfoTags emits a height tag carrying the
// Height_Requirement `name` when one is present, one advisory tag per
// Physical_Considerations `name` in order, and one interest tag per
// Interest_Facet `name`; emits no tag for a value that is absent or empty; and
// every emitted tag carries a non-empty `accessibilityLabel` conveying its
// value.
//
// Validates: Requirements 11.1, 11.2, 11.3, 11.5, 11.6
// ---------------------------------------------------------------------------

// A facet-value `name` spanning real names (some whitespace-padded), plus the
// empty / whitespace-only forms that must be treated as "no value" and omitted
// (R11.5). The `id` is arbitrary — buildInfoTags surfaces only the name.
const facetNameArb = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.constantFrom(
      'Expectant Mothers Advisory',
      ' Must Transfer from Wheelchair ',
      'Thrill Rides',
      'For Kids',
      ' Big Drops ',
    ),
  },
  { weight: 1, arbitrary: fc.constant('') },
  { weight: 1, arbitrary: fc.constant('   ') },
);

const facetValueArb: fc.Arbitrary<FacetValueDTO> = fc.record({
  id: fc.string(),
  name: facetNameArb,
});

// A Height_Requirement spanning: present (with a real, whitespace-only, or
// empty name), explicit null, and explicit undefined — the last three must all
// yield no height tag (R11.1 present / R11.5 absent-or-empty).
const heightRequirementArb = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.record<HeightRequirementDTO>({
      id: fc.string(),
      name: facetNameArb,
      minInches: fc.oneof(fc.constant(null), fc.integer({ min: 30, max: 60 })),
      minCentimeters: fc.oneof(
        fc.constant(null),
        fc.integer({ min: 76, max: 152 }),
      ),
    }),
  },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constant(undefined) },
) as fc.Arbitrary<HeightRequirementDTO | null | undefined>;

// Physical_Considerations: a list mixing real advisories with empty /
// whitespace-only names (which must be omitted), or the whole field absent.
const physicalConsiderationsArb = fc.oneof(
  { weight: 4, arbitrary: fc.array(facetValueArb, { maxLength: 5 }) },
  { weight: 1, arbitrary: fc.constant(undefined) },
) as fc.Arbitrary<readonly FacetValueDTO[] | undefined>;

// Interest_Facets: a grouped map (group name → facet values) whose values mix
// real names with empty / whitespace-only ones, or the whole field absent.
const interestFacetsArb = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.dictionary(
      fc.constantFrom(
        'interests',
        'thrillFactor',
        'age',
        'parkInterests',
        'disneyFavorites',
      ),
      fc.array(facetValueArb, { maxLength: 4 }),
      { maxKeys: 5 },
    ),
  },
  { weight: 1, arbitrary: fc.constant(undefined) },
) as fc.Arbitrary<GroupedFacetsDTO | undefined>;

// An Experience isolating the three new facet enrichments. The non-facet
// enrichment fields are held absent so this suite exercises Property 11's
// height / advisory / interest guarantees directly; their emission is covered
// by Property 14 above. `areaType` still varies since it is a required field.
const facet11ExperienceArb = fc.record({
  areaType: areaTypeArb,
  land: fc.constant(null),
  priceTier: fc.constant(null),
  latitude: fc.constant(null),
  longitude: fc.constant(null),
  resortId: fc.constant(null),
  heightRequirement: heightRequirementArb,
  physicalConsiderations: physicalConsiderationsArb,
  interestFacets: interestFacetsArb,
}) as fc.Arbitrary<InfoTagExperience>;

/** Flatten a grouped-facets map into its values in insertion (group, value) order. */
function flattenInterest(
  facets: GroupedFacetsDTO | undefined,
): readonly FacetValueDTO[] {
  if (!facets) {
    return [];
  }
  return Object.values(facets).flat();
}

describe('Property 11: buildInfoTags surfaces each new enrichment value with an accessible label', () => {
  it('emits height / advisory / interest tags for present, non-empty values in order, omits absent/empty, and labels every tag', () => {
    fc.assert(
      fc.property(facet11ExperienceArb, (experience) => {
        const tags = buildInfoTags(experience, null);

        // R11.6 — every emitted tag carries a non-empty accessibilityLabel
        // (and, defensively, a non-empty display label).
        for (const tag of tags) {
          expect(tag.accessibilityLabel.trim().length).toBeGreaterThan(0);
          expect(tag.label.trim().length).toBeGreaterThan(0);
        }

        // R11.1 / R11.5 — Height: present iff a Height_Requirement with a
        // non-empty name is present. Its label and accessibilityLabel carry
        // the trimmed name.
        const heightTags = tags.filter((t) => t.kind === 'height');
        const heightPresent =
          !!experience.heightRequirement &&
          isPresentString(experience.heightRequirement.name);
        expect(heightTags).toHaveLength(heightPresent ? 1 : 0);
        if (heightPresent) {
          const name = experience.heightRequirement!.name.trim();
          expect(heightTags[0]!.label).toBe(name);
          expect(heightTags[0]!.accessibilityLabel).toBe(
            `Height requirement: ${name}`,
          );
        }

        // R11.2 / R11.5 — Advisory: exactly one tag per non-empty
        // Physical_Considerations name, in persisted order.
        const expectedAdvisories = (experience.physicalConsiderations ?? [])
          .filter((c) => isPresentString(c.name))
          .map((c) => c.name.trim());
        const advisoryTags = tags.filter((t) => t.kind === 'advisory');
        expect(advisoryTags.map((t) => t.label)).toEqual(expectedAdvisories);
        expect(advisoryTags.map((t) => t.accessibilityLabel)).toEqual(
          expectedAdvisories.map((name) => `Advisory: ${name}`),
        );

        // R11.3 / R11.5 — Interest: exactly one tag per non-empty Interest_Facet
        // name across the groups, in persisted (group, then value) order.
        const expectedInterests = flattenInterest(experience.interestFacets)
          .filter((v) => isPresentString(v.name))
          .map((v) => v.name.trim());
        const interestTags = tags.filter((t) => t.kind === 'interest');
        expect(interestTags.map((t) => t.label)).toEqual(expectedInterests);
        expect(interestTags.map((t) => t.accessibilityLabel)).toEqual(
          expectedInterests.map((name) => `Interest: ${name}`),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
