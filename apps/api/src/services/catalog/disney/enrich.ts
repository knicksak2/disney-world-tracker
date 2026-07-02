/**
 * Pure extraction of an Experience's enrichment metadata — coordinates,
 * accessibility facets, dining price tier, and meal periods — from a Disney
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
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
 */

import type { MealPeriodDTO } from '@dwt/shared';

import type { FacilityDocument } from './facilityDoc.js';

/** The Facility_Type whose dining facets/meal periods are enriched (R5.4, R5.5). */
const RESTAURANT_TYPE = 'restaurant';

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

  return {
    ...extractCoordinates(doc),
    accessibility: extractAccessibility(doc),
    priceTier: isRestaurant ? extractPriceTier(doc) : null,
    mealPeriods: isRestaurant ? extractMealPeriods(doc) : [],
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
