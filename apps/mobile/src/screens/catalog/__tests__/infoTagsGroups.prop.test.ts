// Feature: experience-detail-redesign — property tests for the pure grouping
// core `buildTagGroups` in `infoTags.ts` (tasks.md → 1.4).
//
// This suite implements nine of the feature's correctness properties against
// the framework-free `buildTagGroups` fold that produces the ordered,
// relabeled, de-duplicated Tag_Groups the Experience_Detail_Screen renders.
// Each property is implemented as its own single property-based test asserted
// at `numRuns: 100`, following the conventions in `infoTags.prop.test.ts`:
// generators that deliberately span present, null, undefined, whitespace-only,
// and duplicate values, plus independent oracles that restate the spec rules.
//
//   - Property 1:  Tag partition                  (Requirements 1.1, 9.2)
//   - Property 2:  Group order and non-emptiness   (Requirements 1.6, 1.8)
//   - Property 3:  Intra-group ordering & omission (Requirements 1.2-1.5)
//   - Property 4:  Presence gating and trimming    (Requirements 9.3)
//   - Property 6:  Accessible text always present  (Requirements 2.4, 2.5)
//   - Property 7:  Per-group de-duplication        (Requirements 3.1, 3.2, 3.3)
//   - Property 8:  Coordinates are never a tag      (Requirements 4.1)
//   - Property 15: Grouping is total                (Requirements 9.5)
//   - Property 16: Grouping is deterministic        (Requirements 9.6)

import fc from 'fast-check';

import { AREA_TYPES } from '@dwt/shared';
import type {
  AreaType,
  FacetValueDTO,
  GroupedFacetsDTO,
  HeightRequirementDTO,
} from '@dwt/shared';

import {
  buildTagGroups,
  relabelTagValue,
  type InfoTag,
  type InfoTagKind,
  type TagGroupExperience,
  type TagGroupId,
} from '../infoTags';

const NUM_RUNS = 100;

// The canonical top-level group order (R1.8).
const GROUP_ORDER: readonly TagGroupId[] = [
  'location',
  'goodToKnow',
  'accessibility',
  'goodFor',
];

// The allowed InfoTag kinds per group — the partition assignment (R9.2). Every
// emitted tag in a group must carry one of these kinds, and the kind sets are
// pairwise disjoint, so a kind maps to exactly one group.
const KINDS_BY_GROUP: Record<TagGroupId, readonly InfoTagKind[]> = {
  location: ['park', 'land', 'resort', 'resortArea'],
  goodToKnow: ['height', 'advisory'],
  accessibility: ['accessibility'],
  goodFor: ['interest'],
};

// The canonical intra-group kind order (R1.2-R1.5).
const KIND_ORDER_BY_GROUP: Record<TagGroupId, readonly InfoTagKind[]> = {
  location: ['park', 'land', 'resort', 'resortArea'],
  goodToKnow: ['height', 'advisory'],
  accessibility: ['accessibility'],
  goodFor: ['interest'],
};

const AGE_FACET_GROUP = 'age';

// ---------------------------------------------------------------------------
// Oracles — an independent restatement of the presence / ordering rules in
// `infoTags.ts`. `candidateGroups` produces, per group, the ordered list of
// tags a present, non-empty source would yield BEFORE de-duplication; the
// implementation's emitted output must equal these candidates with per-group
// duplicate labels removed (first occurrence retained).
// ---------------------------------------------------------------------------

function isPresentString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

interface Candidate {
  readonly kind: InfoTagKind;
  readonly label: string;
  readonly accessibilityLabel: string;
}

function candidateLocation(
  experience: TagGroupExperience,
  resortName: string | null,
): Candidate[] {
  const out: Candidate[] = [];
  if (isPresentString(experience.park)) {
    const label = experience.park.trim();
    out.push({ kind: 'park', label, accessibilityLabel: `Park: ${label}` });
  }
  if (isPresentString(experience.land)) {
    const label = experience.land.trim();
    out.push({ kind: 'land', label, accessibilityLabel: `Land: ${label}` });
  }
  if (
    experience.areaType === 'Resort' &&
    isPresentString(experience.resortId) &&
    isPresentString(resortName)
  ) {
    const label = resortName.trim();
    out.push({ kind: 'resort', label, accessibilityLabel: `Resort: ${label}` });
  }
  if (experience.areaType === 'Resort' && isPresentString(experience.resortArea)) {
    const label = experience.resortArea.trim();
    out.push({
      kind: 'resortArea',
      label,
      accessibilityLabel: `Resort area: ${label}`,
    });
  }
  return out;
}

function candidateGoodToKnow(experience: TagGroupExperience): Candidate[] {
  const out: Candidate[] = [];
  if (
    experience.heightRequirement &&
    isPresentString(experience.heightRequirement.name)
  ) {
    const label = experience.heightRequirement.name.trim();
    out.push({
      kind: 'height',
      label,
      accessibilityLabel: `Height requirement: ${label}`,
    });
  }
  for (const consideration of experience.physicalConsiderations ?? []) {
    if (isPresentString(consideration.name)) {
      const label = consideration.name.trim();
      out.push({ kind: 'advisory', label, accessibilityLabel: `Advisory: ${label}` });
    }
  }
  return out;
}

function candidateAccessibility(experience: TagGroupExperience): Candidate[] {
  const out: Candidate[] = [];
  for (const raw of experience.accessibility ?? []) {
    if (isPresentString(raw)) {
      const label = relabelTagValue(raw);
      if (label.length > 0) {
        out.push({
          kind: 'accessibility',
          label,
          accessibilityLabel: `Accessibility: ${label}`,
        });
      }
    }
  }
  return out;
}

function candidateGoodFor(experience: TagGroupExperience): Candidate[] {
  const out: Candidate[] = [];
  const facets = experience.interestFacets;
  if (!facets) {
    return out;
  }
  const push = (values: readonly FacetValueDTO[]): void => {
    for (const value of values) {
      if (isPresentString(value.name)) {
        const label = value.name.trim();
        out.push({ kind: 'interest', label, accessibilityLabel: `Good for: ${label}` });
      }
    }
  };
  const ageValues = facets[AGE_FACET_GROUP];
  if (ageValues) {
    push(ageValues);
  }
  for (const [group, values] of Object.entries(facets)) {
    if (group === AGE_FACET_GROUP) {
      continue;
    }
    push(values);
  }
  return out;
}

function candidateGroups(
  experience: TagGroupExperience,
  resortName: string | null,
): Record<TagGroupId, Candidate[]> {
  return {
    location: candidateLocation(experience, resortName),
    goodToKnow: candidateGoodToKnow(experience),
    accessibility: candidateAccessibility(experience),
    goodFor: candidateGoodFor(experience),
  };
}

/** Drop later duplicates by case-sensitive display label, keeping the first. */
function dedupeByLabel(tags: readonly Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const tag of tags) {
    if (seen.has(tag.label)) {
      continue;
    }
    seen.add(tag.label);
    out.push(tag);
  }
  return out;
}

/** True iff `sub` is an order-preserving subsequence of `full`. */
function isSubsequence<T>(sub: readonly T[], full: readonly T[]): boolean {
  let i = 0;
  for (const item of full) {
    if (i < sub.length && sub[i] === item) {
      i += 1;
    }
  }
  return i === sub.length;
}

// ---------------------------------------------------------------------------
// Generators — deliberately span present, null, undefined, whitespace-only,
// and DUPLICATE values so the omission and per-group de-duplication rules are
// genuinely exercised. Shared small value pools make cross-field duplicate
// labels (e.g. the same string as park and land, or repeated facet names) arise
// naturally.
// ---------------------------------------------------------------------------

// A location string spanning a small pool (with whitespace-padded variants that
// collapse to the same trimmed label, forcing dedup) plus the four "absent"
// forms that must be omitted.
const locationValueArb = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.constantFrom(
      'Magic Kingdom',
      ' Magic Kingdom ',
      'Epcot',
      'World Showcase',
      ' World Showcase ',
    ),
  },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constant(undefined) },
  { weight: 1, arbitrary: fc.constant('   ') },
  { weight: 1, arbitrary: fc.constant('') },
) as fc.Arbitrary<string | null | undefined>;

// A coordinate value spanning finite numbers plus non-finite/missing forms.
// buildTagGroups never reads these, but Property 8 asserts they never surface.
const optionalCoordArb = fc.oneof(
  { weight: 5, arbitrary: fc.double({ min: -180, max: 180, noNaN: true }) },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constant(undefined) },
  { weight: 1, arbitrary: fc.constant(Number.NaN) },
) as fc.Arbitrary<number | null | undefined>;

// A facet / advisory `name` spanning real names (some whitespace-padded and
// duplicated across the pool so dedup triggers) plus empty / whitespace-only
// forms that must be omitted.
const facetNameArb = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.constantFrom(
      'Thrill Rides',
      ' Thrill Rides ',
      'For Kids',
      'Big Drops',
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

// Accessibility raw values: mapped slugs (dedup-prone via relabeling), unmapped
// slugs, whitespace-padded duplicates, and empty / whitespace-only entries.
const accessibilityArb = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.array(
      fc.constantFrom(
        'no-service-animals',
        ' no-service-animals ',
        'wheelchair-accessible',
        'must-transfer',
        '',
        '   ',
      ),
      { maxLength: 5 },
    ),
  },
  { weight: 1, arbitrary: fc.constant(undefined) },
) as fc.Arbitrary<readonly string[] | undefined>;

const heightRequirementArb = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.record<HeightRequirementDTO>({
      id: fc.string(),
      name: facetNameArb,
      minInches: fc.oneof(fc.constant(null), fc.integer({ min: 30, max: 60 })),
      minCentimeters: fc.oneof(fc.constant(null), fc.integer({ min: 76, max: 152 })),
    }),
  },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constant(undefined) },
) as fc.Arbitrary<HeightRequirementDTO | null | undefined>;

const physicalConsiderationsArb = fc.oneof(
  { weight: 4, arbitrary: fc.array(facetValueArb, { maxLength: 5 }) },
  { weight: 1, arbitrary: fc.constant(undefined) },
) as fc.Arbitrary<readonly FacetValueDTO[] | undefined>;

const interestFacetsArb = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.dictionary(
      fc.constantFrom('age', 'interests', 'thrillFactor', 'parkInterests'),
      fc.array(facetValueArb, { maxLength: 4 }),
      { maxKeys: 4 },
    ),
  },
  { weight: 1, arbitrary: fc.constant(undefined) },
) as fc.Arbitrary<GroupedFacetsDTO | undefined>;

const areaTypeArb: fc.Arbitrary<AreaType> = fc.constantFrom(...AREA_TYPES);

// `fc.record` materializes every key, so each optional field carries an
// explicit `| undefined`; `TagGroupExperience` forbids an explicit `undefined`
// under `exactOptionalPropertyTypes` even though `buildTagGroups` handles it at
// runtime. The cast keeps the generator spanning present/null/undefined while
// satisfying the stricter optional-property typing.
const experienceArb = fc.record({
  areaType: areaTypeArb,
  park: locationValueArb,
  land: locationValueArb,
  priceTier: locationValueArb,
  accessibility: accessibilityArb,
  latitude: optionalCoordArb,
  longitude: optionalCoordArb,
  resortId: locationValueArb,
  resortArea: locationValueArb,
  heightRequirement: heightRequirementArb,
  physicalConsiderations: physicalConsiderationsArb,
  interestFacets: interestFacetsArb,
}) as fc.Arbitrary<TagGroupExperience>;

// The resort-name argument shares the location pool so a resolved resort label
// can duplicate the park / land label and exercise cross-field dedup.
const resortNameArb = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.constantFrom('Magic Kingdom', ' Magic Kingdom ', 'Grand Floridian'),
  },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constant('   ') },
) as fc.Arbitrary<string | null>;

// A generator that leans hard into the degenerate "absent" forms — null,
// undefined, whitespace-only strings, and empty collections — so Property 15's
// totality guarantee is exercised on the worst-case inputs.
const degenerateExperienceArb = fc.record({
  areaType: areaTypeArb,
  park: fc.constantFrom(null, undefined, '', '   ') as fc.Arbitrary<string | null | undefined>,
  land: fc.constantFrom(null, undefined, '', '   ') as fc.Arbitrary<string | null | undefined>,
  priceTier: fc.constantFrom(null, undefined) as fc.Arbitrary<string | null | undefined>,
  accessibility: fc.constantFrom(undefined, [] as string[], ['', '   ']) as fc.Arbitrary<
    readonly string[] | undefined
  >,
  latitude: fc.constantFrom(null, undefined, Number.NaN) as fc.Arbitrary<number | null | undefined>,
  longitude: fc.constantFrom(null, undefined, Number.NaN) as fc.Arbitrary<number | null | undefined>,
  resortId: fc.constantFrom(null, undefined, '', '   ') as fc.Arbitrary<string | null | undefined>,
  resortArea: fc.constantFrom(null, undefined, '', '   ') as fc.Arbitrary<string | null | undefined>,
  heightRequirement: fc.constantFrom(null, undefined) as fc.Arbitrary<
    HeightRequirementDTO | null | undefined
  >,
  physicalConsiderations: fc.constantFrom(undefined, [] as FacetValueDTO[]) as fc.Arbitrary<
    readonly FacetValueDTO[] | undefined
  >,
  interestFacets: fc.constantFrom(undefined, {} as GroupedFacetsDTO) as fc.Arbitrary<
    GroupedFacetsDTO | undefined
  >,
}) as fc.Arbitrary<TagGroupExperience>;

/** Flatten the emitted groups into (groupId, tag) pairs. */
function flatten(
  groups: readonly { id: TagGroupId; tags: readonly InfoTag[] }[],
): { groupId: TagGroupId; tag: InfoTag }[] {
  return groups.flatMap((g) => g.tags.map((tag) => ({ groupId: g.id, tag })));
}

// ---------------------------------------------------------------------------
// Property 1 — Tag partition
// ---------------------------------------------------------------------------
//
// Feature: experience-detail-redesign, Property 1: For any Experience input and
// resort name, every Info_Tag emitted by `buildTagGroups` belongs to exactly
// one Tag_Group — no emitted tag is assigned to zero groups and none to more
// than one — and every emitted group id is one of location, goodToKnow,
// accessibility, goodFor.
//
// Validates: Requirements 1.1, 9.2

describe('Property 1: buildTagGroups partitions tags across the four groups', () => {
  it('assigns every emitted tag to exactly one valid group by kind', () => {
    fc.assert(
      fc.property(experienceArb, resortNameArb, (experience, resortName) => {
        const groups = buildTagGroups(experience, resortName);

        // Every group id is one of the four, and ids are unique (no group
        // emitted twice), so each group is a distinct partition cell.
        const ids = groups.map((g) => g.id);
        for (const id of ids) {
          expect(GROUP_ORDER).toContain(id);
        }
        expect(new Set(ids).size).toBe(ids.length);

        // Each tag's kind belongs to exactly the group it was placed in. Since
        // the KINDS_BY_GROUP sets are pairwise disjoint, this proves a kind maps
        // to exactly one group (partition: no tag in zero or multiple groups).
        for (const group of groups) {
          for (const tag of group.tags) {
            expect(KINDS_BY_GROUP[group.id]).toContain(tag.kind);
            const owningGroups = GROUP_ORDER.filter((gid) =>
              KINDS_BY_GROUP[gid].includes(tag.kind),
            );
            expect(owningGroups).toEqual([group.id]);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2 — Group order and non-emptiness
// ---------------------------------------------------------------------------
//
// Feature: experience-detail-redesign, Property 2: For any Experience input,
// the sequence of emitted group ids is a subsequence of the canonical order
// [location, goodToKnow, accessibility, goodFor] (present groups preserve that
// relative order, absent groups are omitted), and no emitted group has an empty
// tags array.
//
// Validates: Requirements 1.6, 1.8

describe('Property 2: emitted groups follow the canonical order and are never empty', () => {
  it('emits group ids as a subsequence of the canonical order with non-empty tag lists', () => {
    fc.assert(
      fc.property(experienceArb, resortNameArb, (experience, resortName) => {
        const groups = buildTagGroups(experience, resortName);
        const ids = groups.map((g) => g.id);

        // R1.8 — the emitted ids preserve the canonical relative order.
        expect(isSubsequence(ids, GROUP_ORDER)).toBe(true);

        // R1.6 — no group is emitted with an empty tags array.
        for (const group of groups) {
          expect(group.tags.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3 — Intra-group ordering and omission
// ---------------------------------------------------------------------------
//
// Feature: experience-detail-redesign, Property 3: For any Experience input,
// the tags within each emitted group are a subsequence of that group's
// canonical field order (Location: park -> land -> resort -> resort-area; Good
// to know: height -> physical considerations; Accessibility: relabeled
// accessibility values; Good for: age facets -> interest facets), preserving
// the relative order of present fields and omitting any field whose enrichment
// value is absent or empty.
//
// Validates: Requirements 1.2, 1.3, 1.4, 1.5

describe('Property 3: tags within each group preserve the canonical field order', () => {
  it('emits each group as a subsequence of its ordered candidate fields', () => {
    fc.assert(
      fc.property(experienceArb, resortNameArb, (experience, resortName) => {
        const groups = buildTagGroups(experience, resortName);
        const candidates = candidateGroups(experience, resortName);

        for (const group of groups) {
          // Emitted kinds preserve the canonical intra-group kind order: each
          // kind's canonical rank is non-decreasing (a category such as
          // advisory / interest can repeat, so all tags of one category precede
          // the next category rather than forming a strict subsequence).
          const order = KIND_ORDER_BY_GROUP[group.id];
          const ranks = group.tags.map((t) => order.indexOf(t.kind));
          for (const rank of ranks) {
            expect(rank).toBeGreaterThanOrEqual(0);
          }
          for (let i = 1; i < ranks.length; i += 1) {
            expect(ranks[i]!).toBeGreaterThanOrEqual(ranks[i - 1]!);
          }

          // Emitted labels are an order-preserving subsequence of the ordered,
          // present-only candidate labels (order preserved, absent fields
          // omitted, later duplicates dropped).
          const emittedLabels = group.tags.map((t) => t.label);
          const candidateLabels = candidates[group.id].map((c) => c.label);
          expect(isSubsequence(emittedLabels, candidateLabels)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4 — Presence gating and trimming
// ---------------------------------------------------------------------------
//
// Feature: experience-detail-redesign, Property 4: For any Experience input,
// `buildTagGroups` emits a tag for an enrichment source if and only if that
// source is present and non-empty (a string that is non-null, non-undefined,
// and contains at least one non-whitespace character; a coordinate that is a
// finite number), and every emitted tag's display label is trimmed of leading
// and trailing whitespace.
//
// Validates: Requirements 9.3

describe('Property 4: buildTagGroups gates on presence and trims labels', () => {
  it('represents exactly the present, non-empty sources with trimmed labels', () => {
    fc.assert(
      fc.property(experienceArb, resortNameArb, (experience, resortName) => {
        const groups = buildTagGroups(experience, resortName);
        const candidates = candidateGroups(experience, resortName);

        // Trimming — every emitted label is trimmed and non-empty.
        for (const group of groups) {
          for (const tag of group.tags) {
            expect(tag.label).toBe(tag.label.trim());
            expect(tag.label.length).toBeGreaterThan(0);
          }
        }

        // Presence gating — the SET of emitted labels per group equals the set
        // of labels derived purely from present, non-empty sources. Nothing
        // absent is emitted (soundness) and every present source is represented
        // at least once (completeness), independent of duplicate counts.
        for (const id of GROUP_ORDER) {
          const emitted = groups.find((g) => g.id === id);
          const emittedLabels = new Set((emitted?.tags ?? []).map((t) => t.label));
          const candidateLabels = new Set(candidates[id].map((c) => c.label));
          expect(emittedLabels).toEqual(candidateLabels);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6 — Accessible text always present
// ---------------------------------------------------------------------------
//
// Feature: experience-detail-redesign, Property 6: For any Experience input,
// every emitted Info_Tag exposes non-empty accessible text — its
// accessibilityLabel when one is generated, otherwise its display label — so no
// tag is ever presented without a non-empty screen-reader alternative.
//
// Validates: Requirements 2.4, 2.5

describe('Property 6: every emitted tag exposes non-empty accessible text', () => {
  it('gives each tag a non-empty accessibilityLabel and display label', () => {
    fc.assert(
      fc.property(experienceArb, resortNameArb, (experience, resortName) => {
        const groups = buildTagGroups(experience, resortName);
        for (const { tag } of flatten(groups)) {
          const accessibleText =
            tag.accessibilityLabel.trim().length > 0
              ? tag.accessibilityLabel
              : tag.label;
          expect(accessibleText.trim().length).toBeGreaterThan(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7 — Per-group de-duplication
// ---------------------------------------------------------------------------
//
// Feature: experience-detail-redesign, Property 7: For any Experience input,
// within each emitted group the tag display labels (compared as case-sensitive
// string identity after relabeling and trimming) are unique; when duplicates
// occur the first occurrence in persisted order is retained along with its
// accessibility label and later matching occurrences are dropped; and
// de-duplication is applied independently per group so a label occurring in
// more than one group is retained once in each group in which it occurs.
//
// Validates: Requirements 3.1, 3.2, 3.3

describe('Property 7: buildTagGroups de-duplicates labels independently per group', () => {
  it('keeps the first occurrence per group and drops later duplicates', () => {
    fc.assert(
      fc.property(experienceArb, resortNameArb, (experience, resortName) => {
        const groups = buildTagGroups(experience, resortName);
        const candidates = candidateGroups(experience, resortName);

        for (const id of GROUP_ORDER) {
          const emitted = groups.find((g) => g.id === id);
          const emittedTags = emitted?.tags ?? [];

          // R3.1 — labels within the group are unique.
          const labels = emittedTags.map((t) => t.label);
          expect(new Set(labels).size).toBe(labels.length);

          // R3.2 — the emitted tags equal the candidates with later duplicate
          // labels removed, keeping the first occurrence AND its accessibility
          // label. R3.3 — this is computed per group, so a label present in two
          // groups' candidates survives once in each group.
          const expected = dedupeByLabel(candidates[id]).map((c) => ({
            kind: c.kind,
            label: c.label,
            accessibilityLabel: c.accessibilityLabel,
          }));
          expect(emittedTags.map((t) => ({ ...t }))).toEqual(expected);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8 — Coordinates are never a tag
// ---------------------------------------------------------------------------
//
// Feature: experience-detail-redesign, Property 8: For any Experience input —
// including one carrying finite latitude and longitude — no Info_Tag emitted by
// `buildTagGroups` represents raw coordinates.
//
// Validates: Requirements 4.1

describe('Property 8: buildTagGroups never emits a coordinates tag', () => {
  it('omits raw coordinates even when latitude and longitude are finite', () => {
    // Force finite coordinates on top of the generated experience so the
    // "carrying finite latitude and longitude" clause is always exercised.
    const withFiniteCoordsArb = fc
      .tuple(
        experienceArb,
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
      )
      .map(([experience, latitude, longitude]) => ({
        ...experience,
        latitude,
        longitude,
      })) as fc.Arbitrary<TagGroupExperience>;

    fc.assert(
      fc.property(withFiniteCoordsArb, resortNameArb, (experience, resortName) => {
        const groups = buildTagGroups(experience, resortName);
        for (const { tag } of flatten(groups)) {
          expect(tag.kind).not.toBe('coordinates');
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 15 — Grouping is total
// ---------------------------------------------------------------------------
//
// Feature: experience-detail-redesign, Property 15: For any Experience input —
// including inputs with null fields, undefined fields, and empty collections —
// `buildTagGroups` returns a defined array and never throws.
//
// Validates: Requirements 9.5

describe('Property 15: buildTagGroups is total and never throws', () => {
  it('returns a defined array for arbitrary and degenerate inputs', () => {
    fc.assert(
      fc.property(
        fc.oneof(experienceArb, degenerateExperienceArb),
        resortNameArb,
        (experience, resortName) => {
          const groups = buildTagGroups(experience, resortName);
          expect(Array.isArray(groups)).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 16 — Grouping is deterministic
// ---------------------------------------------------------------------------
//
// Feature: experience-detail-redesign, Property 16: For any Experience input,
// invoking `buildTagGroups` twice with equal input produces output with the
// same groups, tag order, tag values, and labels on both invocations.
//
// Validates: Requirements 9.6

describe('Property 16: buildTagGroups is deterministic for equal inputs', () => {
  it('produces deeply equal output across two invocations on equal input', () => {
    fc.assert(
      fc.property(experienceArb, resortNameArb, (experience, resortName) => {
        // A structurally-equal but distinct clone of the input exercises "equal
        // input" rather than mere reference identity.
        const clone = structuredClone(experience) as TagGroupExperience;

        const first = buildTagGroups(experience, resortName);
        const second = buildTagGroups(clone, resortName);

        expect(second).toEqual(first);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
