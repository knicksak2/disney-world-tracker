/**
 * Info_Tag construction core for the enriched Experience_Detail_Screen and the
 * compact Restaurant list-row price tag.
 *
 * An Info_Tag is a compact, labelled indicator surfacing one persisted
 * enrichment value (Land, price tier, an accessibility tag, coordinates, a meal
 * period, or the specific Resort). This module is framework-free (no React, no
 * react-navigation) so the ordering, omission, and label guarantees are unit-
 * and property-testable without rendering, mirroring the existing
 * `destinations.ts` / `catalogGrouping.ts` pure-core pattern.
 *
 * The detail screen renders `buildInfoTags(...)` as a wrapping badge row and a
 * Restaurant list row renders `priceTierListTag(...)`; both reuse the same
 * label/value presentation so the price tier is identical across surfaces
 * (R9.9).
 *
 * Validates: Requirements 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.11, 12.5
 */

import type { ExperienceDTO } from '@dwt/shared';

/**
 * The kinds of persisted enrichment an Info_Tag can surface (R9.2-R9.7,
 * R11.1-R11.3).
 */
export type InfoTagKind =
  | 'park'
  | 'land'
  | 'priceTier'
  | 'accessibility'
  | 'coordinates'
  | 'mealPeriod'
  | 'resort'
  | 'resortArea'
  | 'height'
  | 'advisory'
  | 'interest';

/** One compact, labelled Info_Tag ready for rendering. */
export interface InfoTag {
  readonly kind: InfoTagKind;
  /** Display value, already formatted (e.g. "28.35, -81.56" for coordinates). */
  readonly label: string;
  /** Screen-reader text alternative conveying the tag's meaning (R12.5). */
  readonly accessibilityLabel: string;
}

/**
 * The enrichment fields `buildInfoTags` reads. Kept as a structural `Pick` of
 * `ExperienceDTO` so the field names stay locked to the shared DTO — the detail
 * screen's `ExperienceDetailDTO` satisfies this shape. Framework-free, so no
 * screen types leak into the core.
 */
export type InfoTagExperience = Pick<
  ExperienceDTO,
  | 'areaType'
  | 'land'
  | 'priceTier'
  | 'accessibility'
  | 'latitude'
  | 'longitude'
  | 'mealPeriods'
  | 'resortId'
  | 'resortArea'
  | 'heightRequirement'
  | 'physicalConsiderations'
  | 'interestFacets'
>;

/**
 * The four labelled Tag_Groups the Experience_Detail_Screen renders, in their
 * fixed top-level render order (R1.1, R1.8).
 */
export type TagGroupId = 'location' | 'goodToKnow' | 'accessibility' | 'goodFor';

/** A labelled sub-group of Info_Tags ready to render (R1.1, R1.7). */
export interface TagGroup {
  readonly id: TagGroupId;
  /** Human-facing group label: "Location" | "Good to know" | "Accessibility" | "Good for". */
  readonly label: string;
  /** De-duplicated, relabelled, order-preserved tags for this group (always non-empty). */
  readonly tags: readonly InfoTag[];
}

/**
 * The enrichment fields `buildTagGroups` reads. Extends the existing
 * `InfoTagExperience` pick with `park` so the Location_Group can surface the
 * owning Park (R1.2). Sourced entirely from the existing `ExperienceDTO`, so no
 * DTO change is required.
 */
export type TagGroupExperience = InfoTagExperience & Pick<ExperienceDTO, 'park'>;

/**
 * Static slug→human-friendly label map for accessibility tag values (R2.1,
 * R2.2). Lookup is exact, whitespace-trimmed, and case-sensitive; values that
 * miss the map fall through to the separator-collapsing humanisation in
 * `relabelTagValue`.
 */
export const ACCESSIBILITY_LABELS: Record<string, string> = {
  'no-service-animals': 'Service animals not permitted',
};

/**
 * Map a raw tag value to its human-friendly label (R2.1, R2.2, R2.3).
 *
 * The value is first trimmed of leading/trailing whitespace, then looked up in
 * `ACCESSIBILITY_LABELS` with an exact, case-sensitive key match. On a hit the
 * mapped label is returned. On a miss the trimmed value is humanised: every
 * hyphen (`-`) and underscore (`_`) separator is replaced with a space,
 * consecutive separators collapse to a single space, and the result is trimmed
 * of leading/trailing whitespace. Pure and total — never throws.
 */
export function relabelTagValue(value: string): string {
  const trimmed = value.trim();
  const mapped = ACCESSIBILITY_LABELS[trimmed];
  if (mapped !== undefined) {
    return mapped;
  }
  return trimmed.replace(/[-_]+/g, ' ').trim();
}

/** A string is present when it is non-null/undefined and not whitespace-only. */
function isNonEmpty(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** A coordinate is present only when it is a finite number. */
function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Build the price-tier Info_Tag from a (non-empty) tier value. Shared by the
 * detail view and the Restaurant list row so both present the price tier with
 * identical label text and value (R9.3, R9.9).
 */
function priceTierTag(priceTier: string): InfoTag {
  return {
    kind: 'priceTier',
    label: priceTier,
    accessibilityLabel: `Price tier: ${priceTier}`,
  };
}

/**
 * Build the ordered Info_Tag list for an Experience detail view. Emits a tag
 * only when its underlying enrichment is present and non-empty (R9.8):
 *
 *   - Land (R9.2)
 *   - price tier (R9.3)
 *   - one accessibility tag per persisted tag, in persisted order (R9.4)
 *   - coordinates, only when both latitude and longitude are persisted (R9.5)
 *   - one tag per meal period (R9.6)
 *   - the specific Resort, only when the area is `Resort`, a Resort is
 *     referenced, and its name is available (R9.7)
 *   - the Resort_Area zone, only when the area is `Resort` and a Resort_Area is
 *     persisted
 *   - the Height_Requirement, only when persisted with a non-empty name (R11.1)
 *   - one advisory tag per Physical_Consideration, in persisted order (R11.2)
 *   - one interest tag per Interest_Facet value across the interest groups, in
 *     persisted order (R11.3)
 *
 * Tags are ordered Land → price tier → accessibility → coordinates → meal
 * period → resort → resort area → height → advisory → interest, omitting absent
 * ones while preserving the relative order of those present (R9.11, R11.5).
 * Every emitted tag carries a non-empty `accessibilityLabel` (R12.5, R11.6).
 * Pure and total — never throws.
 */
export function buildInfoTags(
  experience: InfoTagExperience,
  resortName: string | null,
): readonly InfoTag[] {
  const tags: InfoTag[] = [];

  // 1. Land (R9.2)
  if (isNonEmpty(experience.land)) {
    const land = experience.land.trim();
    tags.push({
      kind: 'land',
      label: land,
      accessibilityLabel: `Land: ${land}`,
    });
  }

  // 2. Price tier (R9.3)
  if (isNonEmpty(experience.priceTier)) {
    tags.push(priceTierTag(experience.priceTier.trim()));
  }

  // 3. Accessibility — one tag per persisted tag, in persisted order (R9.4)
  if (experience.accessibility) {
    for (const raw of experience.accessibility) {
      if (isNonEmpty(raw)) {
        const value = raw.trim();
        tags.push({
          kind: 'accessibility',
          label: value,
          accessibilityLabel: `Accessibility: ${value}`,
        });
      }
    }
  }

  // 4. Coordinates — only when both latitude and longitude are present (R9.5)
  if (
    isFiniteNumber(experience.latitude) &&
    isFiniteNumber(experience.longitude)
  ) {
    const coords = `${experience.latitude}, ${experience.longitude}`;
    tags.push({
      kind: 'coordinates',
      label: coords,
      accessibilityLabel: `Coordinates: ${coords}`,
    });
  }

  // 5. Meal periods — one tag per meal period (R9.6)
  if (experience.mealPeriods) {
    for (const period of experience.mealPeriods) {
      if (isNonEmpty(period.type)) {
        const value = period.type.trim();
        tags.push({
          kind: 'mealPeriod',
          label: value,
          accessibilityLabel: `Meal period: ${value}`,
        });
      }
    }
  }

  // 6. Specific Resort — only for a `Resort` area referencing a Resort whose
  //    name is available (R9.7); omitted when the name is unavailable (R9.8).
  if (
    experience.areaType === 'Resort' &&
    isNonEmpty(experience.resortId) &&
    isNonEmpty(resortName)
  ) {
    const name = resortName.trim();
    tags.push({
      kind: 'resort',
      label: name,
      accessibilityLabel: `Resort: ${name}`,
    });
  }

  // 7. Resort_Area zone — only for a `Resort` area with a persisted zone. Shown
  //    after the specific Resort so the reading is "resort, then its zone".
  if (experience.areaType === 'Resort' && isNonEmpty(experience.resortArea)) {
    const area = experience.resortArea.trim();
    tags.push({
      kind: 'resortArea',
      label: area,
      accessibilityLabel: `Resort area: ${area}`,
    });
  }

  // 8. Height_Requirement — only when persisted with a non-empty name (R11.1),
  //    omitted otherwise (R11.5).
  if (
    experience.heightRequirement &&
    isNonEmpty(experience.heightRequirement.name)
  ) {
    const name = experience.heightRequirement.name.trim();
    tags.push({
      kind: 'height',
      label: name,
      accessibilityLabel: `Height requirement: ${name}`,
    });
  }

  // 9. Physical_Considerations — one advisory tag per persisted value, in
  //    persisted order (R11.2).
  if (experience.physicalConsiderations) {
    for (const consideration of experience.physicalConsiderations) {
      if (isNonEmpty(consideration.name)) {
        const value = consideration.name.trim();
        tags.push({
          kind: 'advisory',
          label: value,
          accessibilityLabel: `Advisory: ${value}`,
        });
      }
    }
  }

  // 10. Interest_Facets — one interest tag per Facet_Value name across the
  //     interest groups, in persisted (group, then value) order (R11.3).
  if (experience.interestFacets) {
    for (const values of Object.values(experience.interestFacets)) {
      for (const value of values) {
        if (isNonEmpty(value.name)) {
          const name = value.name.trim();
          tags.push({
            kind: 'interest',
            label: name,
            accessibilityLabel: `Interest: ${name}`,
          });
        }
      }
    }
  }

  return tags;
}

/**
 * The Interest_Facet group key whose Facet_Values are surfaced first within the
 * Good_For_Group ("age facet tags followed by the interest facet tags", R1.5).
 * The remaining Interest_Facet groups follow in their persisted insertion
 * order.
 */
const AGE_FACET_GROUP = 'age';

/** A per-group accumulator that de-duplicates tags by their display label. */
interface GroupAccumulator {
  readonly tags: InfoTag[];
  /** Display labels already emitted into this group (case-sensitive). */
  readonly seen: Set<string>;
}

function makeAccumulator(): GroupAccumulator {
  return { tags: [], seen: new Set<string>() };
}

/**
 * Append an Info_Tag to a group, dropping it when a case-sensitive duplicate of
 * its (already relabeled + trimmed) display `label` has already been emitted
 * into the same group — keeping the first occurrence and its
 * `accessibilityLabel` (R3.1, R3.2). Callers pass only present, non-empty,
 * trimmed labels.
 */
function addTag(
  acc: GroupAccumulator,
  kind: InfoTagKind,
  label: string,
  accessibilityLabel: string,
): void {
  if (acc.seen.has(label)) {
    return;
  }
  acc.seen.add(label);
  acc.tags.push({ kind, label, accessibilityLabel });
}

/**
 * Location_Group tags in the fixed field order park → land → resort →
 * resort-area (R1.2). The specific Resort and Resort_Area are surfaced only for
 * a `Resort`-area Experience (mirroring `buildInfoTags`); the Resort also
 * requires a referenced Resort id and an available name.
 */
function collectLocation(
  experience: TagGroupExperience,
  resortName: string | null,
): InfoTag[] {
  const acc = makeAccumulator();

  if (isNonEmpty(experience.park)) {
    const label = experience.park.trim();
    addTag(acc, 'park', label, `Park: ${label}`);
  }

  if (isNonEmpty(experience.land)) {
    const label = experience.land.trim();
    addTag(acc, 'land', label, `Land: ${label}`);
  }

  if (
    experience.areaType === 'Resort' &&
    isNonEmpty(experience.resortId) &&
    isNonEmpty(resortName)
  ) {
    const label = resortName.trim();
    addTag(acc, 'resort', label, `Resort: ${label}`);
  }

  if (experience.areaType === 'Resort' && isNonEmpty(experience.resortArea)) {
    const label = experience.resortArea.trim();
    addTag(acc, 'resortArea', label, `Resort area: ${label}`);
  }

  return acc.tags;
}

/**
 * Good_To_Know_Group tags in the fixed field order height-requirement →
 * physical considerations (R1.3). The Height_Requirement is emitted only when
 * persisted with a non-empty name; each Physical_Consideration is emitted in
 * persisted order.
 */
function collectGoodToKnow(experience: TagGroupExperience): InfoTag[] {
  const acc = makeAccumulator();

  if (
    experience.heightRequirement &&
    isNonEmpty(experience.heightRequirement.name)
  ) {
    const label = experience.heightRequirement.name.trim();
    addTag(acc, 'height', label, `Height requirement: ${label}`);
  }

  if (experience.physicalConsiderations) {
    for (const consideration of experience.physicalConsiderations) {
      if (isNonEmpty(consideration.name)) {
        const label = consideration.name.trim();
        addTag(acc, 'advisory', label, `Advisory: ${label}`);
      }
    }
  }

  return acc.tags;
}

/**
 * Accessibility_Group tags in persisted order (R1.4). Each raw accessibility
 * value is mapped to its human-friendly label via `relabelTagValue` (R2.1-R2.3)
 * and emitted only when the relabeled label is non-empty; the relabeled label
 * is exposed as the tag's accessible text (R2.4).
 */
function collectAccessibility(experience: TagGroupExperience): InfoTag[] {
  const acc = makeAccumulator();

  if (experience.accessibility) {
    for (const raw of experience.accessibility) {
      if (isNonEmpty(raw)) {
        const label = relabelTagValue(raw);
        if (label.length > 0) {
          addTag(acc, 'accessibility', label, `Accessibility: ${label}`);
        }
      }
    }
  }

  return acc.tags;
}

/**
 * Good_For_Group tags: the age Facet_Values first, then the remaining
 * Interest_Facet groups' values in persisted (group, then value) order (R1.5).
 * Each value is emitted only when its `name` is present and non-empty.
 */
function collectGoodFor(experience: TagGroupExperience): InfoTag[] {
  const acc = makeAccumulator();
  const facets = experience.interestFacets;
  if (!facets) {
    return acc.tags;
  }

  const pushValues = (values: readonly { readonly name: string }[]): void => {
    for (const value of values) {
      if (isNonEmpty(value.name)) {
        const label = value.name.trim();
        addTag(acc, 'interest', label, `Good for: ${label}`);
      }
    }
  };

  // Age facets first (R1.5).
  const ageValues = facets[AGE_FACET_GROUP];
  if (ageValues) {
    pushValues(ageValues);
  }

  // Then the remaining interest facet groups in persisted insertion order.
  for (const [group, values] of Object.entries(facets)) {
    if (group === AGE_FACET_GROUP) {
      continue;
    }
    pushValues(values);
  }

  return acc.tags;
}

/**
 * Build the ordered, relabeled, de-duplicated Tag_Groups for an Experience
 * detail view (R1). Groups are emitted in the fixed order Location_Group →
 * Good_To_Know_Group → Accessibility_Group → Good_For_Group (R1.1, R1.8), each
 * carrying its human-facing label (R1.7). Assignment is a partition — every
 * emitted Info_Tag belongs to exactly one group (R9.2):
 *
 *   - `location`: park → land → resort → resort-area (R1.2)
 *   - `goodToKnow`: height-requirement → physical considerations (R1.3)
 *   - `accessibility`: the relabeled accessibility tags, in persisted order (R1.4)
 *   - `goodFor`: the age Facet_Values, then the remaining Interest_Facet values
 *     (R1.5)
 *
 * A tag is emitted only when its enrichment value is present and non-empty
 * (non-null, non-undefined, ≥1 non-whitespace character for strings) and its
 * label is trimmed (R9.3). Raw coordinates are never emitted as a tag (R4.1).
 * Within each group, tags whose relabeled + trimmed display label duplicates an
 * earlier tag (case-sensitive) are dropped, keeping the first occurrence and
 * its `accessibilityLabel`; de-duplication is independent per group (R3.1-R3.3).
 * Any group with no renderable tag is omitted, including its label (R1.6);
 * `[]` is returned when nothing renders. Pure and total — never throws for
 * null/undefined/empty inputs (R9.5) and deterministic for equal inputs (R9.6).
 */
export function buildTagGroups(
  experience: TagGroupExperience,
  resortName: string | null,
): readonly TagGroup[] {
  const groups: TagGroup[] = [];

  const location = collectLocation(experience, resortName);
  if (location.length > 0) {
    groups.push({ id: 'location', label: 'Location', tags: location });
  }

  const goodToKnow = collectGoodToKnow(experience);
  if (goodToKnow.length > 0) {
    groups.push({ id: 'goodToKnow', label: 'Good to know', tags: goodToKnow });
  }

  const accessibility = collectAccessibility(experience);
  if (accessibility.length > 0) {
    groups.push({
      id: 'accessibility',
      label: 'Accessibility',
      tags: accessibility,
    });
  }

  const goodFor = collectGoodFor(experience);
  if (goodFor.length > 0) {
    groups.push({ id: 'goodFor', label: 'Good for', tags: goodFor });
  }

  return groups;
}

/**
 * The compact price-tier Info_Tag for a Restaurant list row — produced with the
 * identical label text and value presentation as the detail view's price-tier
 * tag (R9.9), so a Restaurant row and the Experience_Detail_Screen present the
 * price tier the same way.
 */
export function priceTierListTag(priceTier: string): InfoTag {
  return priceTierTag(priceTier);
}

/**
 * The Resort_Area zone label for a compact list row (e.g. the Resorts
 * Destination and global-search rows), or `null` when the Experience is not a
 * Resort-area Experience or carries no persisted Resort_Area. Trimmed for
 * display. Kept here so every surface derives the row-level zone label the same
 * way (mirroring `priceTierListTag`).
 */
export function resortAreaLabel(
  experience: Pick<ExperienceDTO, 'areaType' | 'resortArea'>,
): string | null {
  if (experience.areaType !== 'Resort') {
    return null;
  }
  return isNonEmpty(experience.resortArea) ? experience.resortArea.trim() : null;
}
