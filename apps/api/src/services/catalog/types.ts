/**
 * Local type definitions for the Catalog_Service module.
 *
 * The shape declared here is the *minimal* projection of a ThemeParks.wiki
 * entity that the catalog domain functions operate on. It is intentionally
 * narrow: only fields that the catalog layer reads directly are listed, so
 * that the rest of the codebase is decoupled from the full upstream payload
 * and the wire shape can evolve without rippling into pure logic.
 *
 * Additional catalog tasks (`reconcile`, `internalId`, the upstream HTTP
 * client) are expected to extend this type in place as new fields become
 * needed (e.g. `id`, `parentId`, `description`).
 *
 * Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 1.14, 1.15, 1.16
 */

import type { ExperienceCategory, Park } from '@dwt/shared';

/**
 * The subset of an upstream ThemeParks.wiki entity required to classify it
 * into an `ExperienceCategory`.
 *
 * - `entityType` is the upstream classifier. The values that drive the
 *   include-set rule (R1.2) and the base mapping (R1.3) are
 *   `"ATTRACTION"`, `"SHOW"`, and `"RESTAURANT"`. Any other value is
 *   accepted and classified as `Other` — the field is typed as `string` (not
 *   a literal union) so that the include-set filter remains a separate
 *   concern from classification, and so that the function is total over the
 *   full set of values the upstream API may return.
 *
 * - `name` is the upstream display name; the parade and character-meet
 *   regex fallbacks read this field.
 *
 * - `attractionType` is an optional sub-classification field present on
 *   some `ATTRACTION` entities (e.g. `"PARADE"`, `"MEET_AND_GREET"`). When
 *   present it is the authoritative sub-classification signal and takes
 *   precedence over the name regex fallbacks.
 */
export interface ThemeParksEntity {
  readonly entityType: string;
  readonly name: string;
  readonly attractionType?: string;
}

/**
 * The fully classified upstream Experience that `reconcile` operates on.
 *
 * The caller (the Catalog_Sync orchestrator) is expected to translate each
 * raw `ThemeParksEntity` into an `UpstreamExperience` *before* calling
 * `reconcile`: that is, derive the stable internal `id` via
 * `internalId(upstreamEntityId)` (R1.7), classify the `category` via
 * `classify(entity)` (R1.3-R1.5), and resolve the parent `park` (R1.6).
 * Doing the derivation outside `reconcile` keeps the diff logic pure and
 * lets property tests pin it down in isolation (Property 5).
 */
export interface UpstreamExperience {
  /** Stable internal identifier derived from `upstreamEntityId` (R1.7). */
  readonly id: string;
  /** The original ThemeParks.wiki entity ID. */
  readonly upstreamEntityId: string;
  /** Display name (R1.8: 1..200 chars). */
  readonly name: string;
  /** Owning Park derived from the parent chain (R1.6). */
  readonly park: Park;
  /** Classification per the entity-type mapping table (R1.3-R1.5). */
  readonly category: ExperienceCategory;
  /** Description text (R1.8: 0..1000 chars). */
  readonly description: string;
}

/**
 * The projection of an `experiences` row that `reconcile` reads.
 *
 * Only the fields that participate in the diff decision are listed: `id`
 * to look up by stable internal id, `active` to detect soft-deleted rows
 * eligible for reactivation, and `name`/`park`/`category` to detect
 * material drift from upstream (R1.16). The full row also has
 * `upstreamEntityId`, `description`, and timestamps, but those do not
 * influence whether `reconcile` emits an upsert.
 */
export interface CatalogCacheRow {
  readonly id: string;
  readonly active: boolean;
  readonly name: string;
  readonly park: Park;
  readonly category: ExperienceCategory;
}

/**
 * One upsert action produced by `reconcile`.
 *
 * Carries the full row state to write. The `active` field is always
 * `true`: soft-deletes flow through `ReconcileSoftDelete`, never through
 * an upsert (the type literally rules out `active: false` here).
 */
export interface ReconcileUpsert {
  readonly id: string;
  readonly upstreamEntityId: string;
  readonly name: string;
  readonly park: Park;
  readonly category: ExperienceCategory;
  readonly description: string;
  readonly active: true;
}

/**
 * One soft-delete action produced by `reconcile`. The row is preserved on
 * disk (so all referencing Completions, Ratings, and Notes remain valid
 * per R1.15); only the `active` flag flips to `false` when the caller
 * applies this action.
 */
export interface ReconcileSoftDelete {
  readonly id: string;
}

/**
 * The complete diff produced by a single `reconcile` invocation.
 */
export interface ReconcileResult {
  readonly upserts: readonly ReconcileUpsert[];
  readonly softDeletes: readonly ReconcileSoftDelete[];
}
