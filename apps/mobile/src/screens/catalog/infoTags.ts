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

/** The kinds of persisted enrichment an Info_Tag can surface (R9.2-R9.7). */
export type InfoTagKind =
  | 'land'
  | 'priceTier'
  | 'accessibility'
  | 'coordinates'
  | 'mealPeriod'
  | 'resort';

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
>;

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
 *
 * Tags are ordered Land → price tier → accessibility → coordinates → meal
 * period → resort, omitting absent ones while preserving the relative order of
 * those present (R9.11). Pure and total — never throws.
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

  return tags;
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
