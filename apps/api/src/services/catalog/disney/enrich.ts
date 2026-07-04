/**
 * Pure extraction of an Experience's enrichment metadata — coordinates,
 * accessibility facets, dining price tier, meal periods, and the mined
 * facet-sourced fields (Grouped_Facets, height requirement, physical
 * advisories, interest facets, why-this copy, and sub-type) — from a Disney
 * Facility_Document.
 *
 * This module implements design.md → "6. Enrichment and imagery
 * (`enrich.ts`, `imagery.ts`)" and Requirement 5 (R5.1–R5.5). Like the other
 * pure transformation cores in the catalog service, it is:
 *
 *   - **Pure**: depends only on its argument; no I/O, no clock, no globals.
 *   - **Total**: defined for every possible `FacilityDocument`, including one
 *     that omits every optional field; never throws.
 *   - **Deterministic**: equal inputs always produce equal outputs, so it is a
 *     sound property-test target (see Property 7).
 *
 * Extraction rules:
 *
 *   - **Coordinates (R5.1, R5.2).** `latitude`/`longitude` are populated only
 *     when *both* are present and finite; when *either* is missing (or not a
 *     finite number), *both* fields are set to `null` so a half-coordinate is
 *     never persisted.
 *   - **Accessibility (R5.3).** The `accessibility` facet list is carried
 *     through as-is, defaulting to an empty array when the document carries no
 *     `accessibility` facets. Non-string entries are defensively dropped since
 *     the Disney sources are undocumented and reverse-engineered.
 *   - **Price tier (R5.4).** *Only* for a `restaurant` document, the first
 *     `priceRangeDining` facet value becomes the `priceTier`; otherwise `null`.
 *   - **Meal periods (R5.5).** *Only* for a `restaurant` document, each
 *     `mealPeriods` entry that carries a `type` is projected to a
 *     `MealPeriodDTO` with its optional `priceTier` (`null` when absent);
 *     otherwise the list is empty.
 *
 * The price-tier and meal-period rules are gated on `type === 'restaurant'`,
 * matching the case-sensitive Facility_Type comparison used by
 * `classifyFacility.ts`.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 4.1, 4.2,
 * 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2
 */

import type {
  FacetValueDTO,
  GroupedFacetsDTO,
  HeightRequirementDTO,
  MealPeriodDTO,
  WhyThisDTO,
} from '@dwt/shared';

import type { FacilityDocument } from './facilityDoc.js';
import { INTEREST_FACET_GROUPS } from './facilityDoc.js';

/** The Facility_Type whose dining facets/meal periods are enriched (R5.4, R5.5). */
const RESTAURANT_TYPE = 'restaurant';

/** The Facet_Group carrying the ride height requirement (R2). */
const HEIGHT_GROUP = 'height';

/** The Facet_Group carrying physical/health advisories (R3). */
const PHYSICAL_CONSIDERATIONS_GROUP = 'physicalConsiderations';

/**
 * The enrichment metadata extracted from a Facility_Document, ready to persist
 * on the corresponding Experience.
 *
 * @see extractEnrichment
 */
export interface Enrichment {
  /** Latitude when both coordinates are present and finite, else `null` (R5.1, R5.2). */
  readonly latitude: number | null;
  /** Longitude when both coordinates are present and finite, else `null` (R5.1, R5.2). */
  readonly longitude: number | null;
  /** Accessibility facet tags; empty when the document carries none (R5.3). */
  readonly accessibility: readonly string[];
  /** Dining price tier for a `restaurant`, else `null` (R5.4). */
  readonly priceTier: string | null;
  /** Meal periods for a `restaurant`, else empty (R5.5). */
  readonly mealPeriods: readonly MealPeriodDTO[];
  /** Full Grouped_Facets for the Persisted_Facet_Groups; empty when none (R1, R7.1). */
  readonly groupedFacets: GroupedFacetsDTO;
  /** Height requirement with derived numeric minimums, or `null` (R2). */
  readonly heightRequirement: HeightRequirementDTO | null;
  /** Physical/health advisories in appearance order; empty when none (R3). */
  readonly physicalConsiderations: readonly FacetValueDTO[];
  /** Interest/targeting facet groups; groups with no facets omitted (R4). */
  readonly interestFacets: GroupedFacetsDTO;
  /** Structured why-this copy, or `null` (R5). */
  readonly whyThis: WhyThisDTO | null;
  /** Finer classification, trimmed non-empty, or `null` (R6). */
  readonly subType: string | null;
}

/**
 * Extract the enrichment metadata for a Facility_Document.
 *
 * Pure, total, and deterministic: every optional field may be absent, and the
 * function returns a fully-populated `Enrichment` (using `null`/empty for
 * absent data) without ever throwing.
 *
 * @param doc - The tolerant Disney Facility_Document projection.
 * @returns The extracted coordinates, accessibility tags, price tier, and meal
 *   periods per Requirement 5.
 */
export function extractEnrichment(doc: FacilityDocument): Enrichment {
  const isRestaurant = doc.type === RESTAURANT_TYPE;

  const groupedFacets = extractGroupedFacets(doc);
  const { physicalConsiderations, interestFacets } = deriveFacetViews(groupedFacets);

  return {
    ...extractCoordinates(doc),
    accessibility: extractAccessibility(doc),
    priceTier: isRestaurant ? extractPriceTier(doc) : null,
    mealPeriods: isRestaurant ? extractMealPeriods(doc) : [],
    groupedFacets,
    heightRequirement: extractHeightRequirement(doc),
    physicalConsiderations,
    interestFacets,
    whyThis: extractWhyThis(doc),
    subType: extractSubType(doc),
  };
}

/**
 * Extract the coordinate pair. Both fields are populated only when both are
 * present and finite; otherwise both are `null` so a half-coordinate is never
 * persisted (R5.1, R5.2).
 */
function extractCoordinates(
  doc: FacilityDocument,
): { latitude: number | null; longitude: number | null } {
  const { latitude, longitude } = doc;
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return { latitude: latitude as number, longitude: longitude as number };
  }
  return { latitude: null, longitude: null };
}

/**
 * Extract the accessibility facet tags, defaulting to an empty array and
 * defensively dropping any non-string entry (R5.3).
 */
function extractAccessibility(doc: FacilityDocument): readonly string[] {
  const tags = doc.facets?.accessibility;
  if (tags === undefined) {
    return [];
  }
  return tags.filter((tag): tag is string => typeof tag === 'string');
}

/**
 * Extract the dining price tier as the first non-empty `priceRangeDining`
 * facet value, or `null` when none is present (R5.4).
 */
function extractPriceTier(doc: FacilityDocument): string | null {
  const tiers = doc.facets?.priceRangeDining;
  if (tiers === undefined) {
    return null;
  }
  const tier = tiers.find(
    (value): value is string => typeof value === 'string' && value !== '',
  );
  return tier ?? null;
}

/**
 * Project each `mealPeriods` entry that carries a `type` into a
 * `MealPeriodDTO`, carrying its optional `priceTier` (`null` when absent).
 * Entries without a `type` cannot form a valid DTO and are dropped (R5.5).
 */
function extractMealPeriods(doc: FacilityDocument): readonly MealPeriodDTO[] {
  const periods = doc.mealPeriods;
  if (periods === undefined) {
    return [];
  }
  const projected: MealPeriodDTO[] = [];
  for (const period of periods) {
    if (typeof period.type === 'string' && period.type !== '') {
      projected.push({ type: period.type, priceTier: period.priceTier ?? null });
    }
  }
  return projected;
}

// ---------------------------------------------------------------------------
// Facet-sourced enrichment (Grouped_Facets, height, advisories, interests,
// why-this, sub-type) — Requirements 1–6.
// ---------------------------------------------------------------------------

/**
 * Extract the persisted Grouped_Facets structure carried on the document.
 *
 * The grouping itself is performed by `buildGroupedFacets` in `facilityDoc.ts`
 * during `adaptFacilityDocument`; this helper simply surfaces it, defaulting to
 * an empty structure when the document carries none (R1, R7.1). Pure, total,
 * and deterministic.
 */
export function extractGroupedFacets(doc: FacilityDocument): GroupedFacetsDTO {
  return doc.groupedFacets ?? {};
}

/**
 * Extract the Height_Requirement from the `height` Facet_Group.
 *
 * Takes the **first** `height` Facet_Value (R2.1) and derives its numeric
 * minimums via {@link parseHeightMinimum} (R2.2–R2.4). Returns `null` when the
 * `height` group is absent or empty (R2.5). The original `id` and `name` are
 * always retained. Pure, total, and deterministic.
 */
export function extractHeightRequirement(
  doc: FacilityDocument,
): HeightRequirementDTO | null {
  const heights = extractGroupedFacets(doc)[HEIGHT_GROUP];
  const first = heights?.[0];
  if (first === undefined) {
    return null;
  }
  return {
    id: first.id,
    name: first.name,
    ...parseHeightMinimum(first.id),
  };
}

/**
 * Matches a numeric value adjacent to a recognized height unit token:
 *
 *   - inches: `in`, `inch`, `inches`, or `"`;
 *   - centimeters: `cm`, `centimeter`, or `centimeters`.
 *
 * The number may be an integer or decimal and may be separated from the unit by
 * whitespace and/or a single hyphen (covering ids like `40in`, `40-inches`,
 * `102 cm`). The trailing negative lookahead `(?![a-z])` ensures the unit token
 * is not merely a prefix of a longer word (so `40information` does not match),
 * keeping the parse faithful to genuinely unit-encoded ids. Longer unit spellings
 * are ordered first so the maximal token is matched. Case-insensitive.
 */
const HEIGHT_MINIMUM_PATTERN =
  /(\d+(?:\.\d+)?)\s*-?\s*(inches|inch|in|centimeters|centimeter|cm|")(?![a-z])/i;

/**
 * Parse the numeric minimum height encoded in a height facet `id`.
 *
 * Scans the id for a numeric value adjacent to a recognized unit token. When the
 * id encodes an inches minimum, `minInches` is set and `minCentimeters` is
 * `null` (R2.2); when it encodes a centimeters minimum, `minCentimeters` is set
 * and `minInches` is `null` (R2.3); when it encodes no parseable numeric
 * minimum, both are `null` (R2.4). No unit conversion is performed — only the
 * unit the id encodes is populated, keeping the derivation faithful to the
 * source. Pure, total, and deterministic.
 */
export function parseHeightMinimum(
  id: string,
): { minInches: number | null; minCentimeters: number | null } {
  const match = HEIGHT_MINIMUM_PATTERN.exec(id);
  if (match === null) {
    return { minInches: null, minCentimeters: null };
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return { minInches: null, minCentimeters: null };
  }
  const unit = (match[2] ?? '').toLowerCase();
  // A `cm`/`centimeter(s)` token encodes centimeters; every other recognized
  // token (`in`/`inch`/`inches`/`"`) encodes inches.
  const isCentimeters = unit.startsWith('c');
  return isCentimeters
    ? { minInches: null, minCentimeters: value }
    : { minInches: value, minCentimeters: null };
}

/**
 * Extract the Physical_Considerations advisories in appearance order, or an
 * empty list when the document carries none (R3). Delegates to
 * {@link deriveFacetViews} so the grouping rules live in one place. Pure, total,
 * and deterministic.
 */
export function extractPhysicalConsiderations(
  doc: FacilityDocument,
): readonly FacetValueDTO[] {
  return deriveFacetViews(extractGroupedFacets(doc)).physicalConsiderations;
}

/**
 * Extract the Interest_Facets structure — each interest/targeting group that
 * carries at least one Facet_Value, in appearance order, omitting empty groups
 * (R4). Delegates to {@link deriveFacetViews}. Pure, total, and deterministic.
 */
export function extractInterestFacets(doc: FacilityDocument): GroupedFacetsDTO {
  return deriveFacetViews(extractGroupedFacets(doc)).interestFacets;
}

/**
 * Normalize the structured Why_This marketing copy.
 *
 * Returns `null` when the document carries no `whyThis` object (R5.5); otherwise
 * returns a value whose `title` is the source title or `null` when omitted
 * (R5.3), and whose `bullets` and `quotes` are the source lists (empty when
 * omitted), preserving order (R5.1, R5.2, R5.4). Pure, total, and deterministic.
 */
export function extractWhyThis(doc: FacilityDocument): WhyThisDTO | null {
  const whyThis = doc.whyThis;
  if (whyThis === undefined) {
    return null;
  }
  return {
    title: whyThis.title ?? null,
    bullets: whyThis.bullets ?? [],
    quotes: whyThis.quotes ?? [],
  };
}

/**
 * Extract the Facility_SubType: the trimmed `subType` when it is present and not
 * whitespace-only, else `null` (R6.1, R6.2). Pure, total, and deterministic.
 */
export function extractSubType(doc: FacilityDocument): string | null {
  const subType = doc.subType;
  if (typeof subType !== 'string') {
    return null;
  }
  const trimmed = subType.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Derive the R3 Physical_Considerations and R4 Interest_Facets views from a
 * persisted Grouped_Facets structure.
 *
 * This is the single source of truth for the two facet views, reused by both
 * the Enrichment_Extractor (from a freshly adapted document) and the
 * `Catalog_Repo` projection (from a persisted `grouped_facets` column), so the
 * grouping rules cannot drift between write and read:
 *
 *   - `physicalConsiderations` is the `physicalConsiderations` group's
 *     Facet_Values in appearance order, or `[]` when the group is absent (R3).
 *   - `interestFacets` contains each {@link INTEREST_FACET_GROUPS} key that has
 *     at least one Facet_Value, in group order, omitting empty groups, or `{}`
 *     when none (R4).
 *
 * Pure, total, and deterministic.
 */
export function deriveFacetViews(grouped: GroupedFacetsDTO): {
  physicalConsiderations: readonly FacetValueDTO[];
  interestFacets: GroupedFacetsDTO;
} {
  const physicalConsiderations = grouped[PHYSICAL_CONSIDERATIONS_GROUP] ?? [];

  const interestFacets: Record<string, readonly FacetValueDTO[]> = {};
  for (const group of INTEREST_FACET_GROUPS) {
    const values = grouped[group];
    if (values !== undefined && values.length > 0) {
      interestFacets[group] = values;
    }
  }

  return { physicalConsiderations, interestFacets };
}
