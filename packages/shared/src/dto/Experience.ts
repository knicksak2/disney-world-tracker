/**
 * Experience DTO.
 *
 * A single catalog item (ride, show, restaurant, parade, character meet, tour,
 * recreation, spa, event, or other) sourced from the Disney sources and
 * reconciled into the local cache. The `id` is the stable internal identifier
 * (UUID v5 of the Enterprise_Id per the design); `active` reflects whether the
 * entity is still present upstream (R11.1, R11.5).
 *
 * Beyond the core catalog fields, the DTO carries the Disney-sourced
 * enrichment: the owning Area_Type (and, for a `Resort` area, the referenced
 * Resort's Internal_Id), coordinates, accessibility tags, dining price tier and
 * meal periods, and — on the detail view — the restaurant's menus. Each
 * enrichment field is present only when persisted (R5.6, R5.7, R8.5).
 *
 * Validates: Requirements 5.6, 5.7, 8.5
 */

import type { AreaType, ExperienceCategory, Park } from '../enums.js';
import type { MealPeriodDTO, MenuDTO } from './Menu.js';

export interface ExperienceDTO {
  /** Stable internal id; UUID v5 derived from the Enterprise_Id (R10.1). */
  readonly id: string;

  /** 1-200 character name. */
  readonly name: string;

  /**
   * Owning Park, or `null` for a `Resort`-area Experience that has no park
   * ancestor (R4.14, R4.15).
   */
  readonly park: Park | null;

  /** Classification (R4.2-R4.10). */
  readonly category: ExperienceCategory;

  /** 0-1000 character description. May be empty. */
  readonly description: string;

  /**
   * `true` when the upstream entity is still present and the catalog should
   * include this Experience in browse/search/filter results; `false` when the
   * row has been soft-deleted but preserved for FK references (R11.5).
   */
  readonly active: boolean;

  /**
   * Absolute URL of a representative image, now sourced directly from the
   * Disney Facility_Document (`detailImageUrl`/`listImageUrl`, R7.1-R7.3), or
   * `null` when neither is present. The App falls back to a category
   * placeholder when it is `null` (R7.5). Catalog_Sync is the sole writer of
   * this field (R14.9); the wire payload always carries it (possibly `null`).
   */
  readonly imageUrl: string | null;

  /**
   * The kind of place this Experience belongs to, so the App can group
   * Experiences by area (R5.7). Always present.
   */
  readonly areaType: AreaType;

  /**
   * When `areaType === 'Resort'`, the referenced Resort's Internal_Id so the
   * App can group the Experience under its specific Resort (R5.7). Absent/`null`
   * for non-Resort areas.
   */
  readonly resortId?: string | null;

  /** Latitude when persisted, else `null`/absent (R5.1, R5.2, R5.6). */
  readonly latitude?: number | null;

  /** Longitude when persisted, else `null`/absent (R5.1, R5.2, R5.6). */
  readonly longitude?: number | null;

  /** Accessibility tags when persisted, else absent (R5.3, R5.6). */
  readonly accessibility?: readonly string[];

  /** Dining price tier when persisted, else `null`/absent (R5.4, R5.6). */
  readonly priceTier?: string | null;

  /** Meal periods when persisted, else absent (R5.5, R5.6). */
  readonly mealPeriods?: readonly MealPeriodDTO[];

  /** Dining menus, exposed on the Experience detail view (R8.5). Else absent. */
  readonly menus?: readonly MenuDTO[];

  /**
   * Themed Land within a `ThemePark`/`WaterPark`, resolved from the
   * Land_Ancestor during Catalog_Sync (R1). Present only when a Land is
   * persisted for the Experience; `null` or absent for `DisneySprings`/`Resort`
   * Experiences and for park Experiences with no resolvable Land
   * (R1.3-R1.5, R3.1, R3.2).
   */
  readonly land?: string | null;
}
