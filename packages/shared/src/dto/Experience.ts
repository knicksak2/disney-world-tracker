/**
 * Experience DTO.
 *
 * A single catalog item (ride, show, restaurant, parade, character meet, or
 * other) sourced from the ThemeParks_API and reconciled into the local cache.
 * The `id` is the stable internal identifier (UUID v5 of the upstream entity
 * id per the design); `active` reflects whether the entity is still present
 * upstream (R1.7, R1.15).
 *
 * Validates: Requirements 1.6, 1.7, 1.8, 1.15
 */

import type { ExperienceCategory, Park } from '../enums.js';

export interface ExperienceDTO {
  /** Stable internal id; UUID v5 derived from upstream entity id (R1.7). */
  readonly id: string;

  /** 1-200 character name (R1.8). */
  readonly name: string;

  /** Owning Park (R1.6). */
  readonly park: Park;

  /** Classification (R1.3-R1.5). */
  readonly category: ExperienceCategory;

  /** 0-1000 character description (R1.8). May be empty. */
  readonly description: string;

  /**
   * `true` when the upstream entity is still present and the catalog should
   * include this Experience in browse/search/filter results; `false` when the
   * row has been soft-deleted but preserved for FK references (R1.15).
   */
  readonly active: boolean;

  /**
   * Absolute URL of a representative image for this Experience, or `null`
   * when none has been sourced yet. Images are curated out of band from the
   * ThemeParks.wiki catalog sync (which exposes no imagery), so this field is
   * independent of the upstream entity lifecycle and survives catalog
   * refreshes. The App falls back to a category placeholder when it is
   * `null`. Optional on the type so existing fixtures that predate the field
   * remain valid; the wire payload always carries it (possibly `null`).
   */
  readonly imageUrl?: string | null;

  /**
   * Human-readable attribution / license note for `imageUrl` (e.g. the
   * Wikimedia author and license), or `null` when not applicable. Stored so
   * the App can render the credit required by the image's license.
   */
  readonly imageAttribution?: string | null;
}
