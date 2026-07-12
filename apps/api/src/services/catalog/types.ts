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

import type {
  AreaType,
  ExperienceCategory,
  GroupedFacetsDTO,
  HeightRequirementDTO,
  MealPeriodDTO,
  MenuDTO,
  Park,
  WhyThisDTO,
} from '@dwt/shared';

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
  /** The original upstream (Disney Enterprise_Id) entity id. */
  readonly upstreamEntityId: string;
  /** Display name (R1.8: 1..200 chars). */
  readonly name: string;
  /**
   * Owning Park resolved from the ancestor chain, or `null` for a
   * `Resort`-area Experience that has no park ancestor (R4.14, R4.15).
   */
  readonly park: Park | null;
  /** Classification per the taxonomy mapping table (R4.2-R4.10). */
  readonly category: ExperienceCategory;
  /**
   * Nearest-ancestor Land name for a park-area Experience, or `null` for a
   * `DisneySprings`/`Resort` area, when no Land ancestor exists, or when the
   * Land name is empty/whitespace-only (R1.1-R1.5, R1.7). Trimmed, original
   * casing preserved, truncated to at most 200 characters.
   */
  readonly land: string | null;
  /**
   * WDW Resort_Area (geographic zone) when `areaType === 'Resort'`, else `null`
   * (resolved by `resolveResortArea`). Trimmed, original casing preserved,
   * truncated to at most 200 characters.
   */
  readonly resortArea: string | null;
  /**
   * EPCOT World Showcase country pavilion when the resolved Land is
   * "World Showcase" (resolved by `resolveWorldShowcaseCountry`), else `null`.
   * One of the eleven pavilion names; truncated to at most 200 characters.
   */
  readonly worldShowcaseCountry: string | null;
  /** Description text (R1.8: 0..1000 chars). */
  readonly description: string;
  /**
   * Disney-provided image URL selected by `selectImageUrl` from the
   * Facility_Document (`detailImageUrl`/`listImageUrl`), or `null` when
   * neither is present (R7.1-R7.3). Carried through the diff so Catalog_Sync
   * is the sole writer of `image_url` (R14.9).
   */
  readonly imageUrl: string | null;
  /** Owning Area_Type resolved from the ancestor chain (R4.11, R5.7). */
  readonly areaType: AreaType;
  /**
   * Referenced Resort's Internal_Id when `areaType === 'Resort'`, else `null`
   * (R5.7).
   */
  readonly resortId: string | null;
  /**
   * Discriminator marking this row as a resort-representing Experience: the
   * represented Resort's Internal_Id when the row stands in for the hotel
   * itself so it is completable through the existing
   * `completions -> experiences` FK (Option A), else `null` for every ordinary
   * Experience — including resort-area *activities*, which carry `resortId` but
   * do not represent the hotel. `UNIQUE` in the schema guarantees at most one
   * representing row per Resort (Requirements 3.1, 3.2).
   */
  readonly representsResortId: string | null;
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
  /**
   * Grouped_Facets for the Persisted_Facet_Groups, keyed by group name; empty
   * when the document carries none (R7.1). Carried through the diff so
   * Catalog_Sync is the sole writer. The Physical_Considerations and
   * Interest_Facets views are re-derived from this on read, so they are not
   * carried separately.
   */
  readonly groupedFacets: GroupedFacetsDTO;
  /**
   * Height requirement with derived numeric minimums, or `null` when the
   * document carries no `height` facet (R7.2).
   */
  readonly heightRequirement: HeightRequirementDTO | null;
  /** Structured why-this marketing copy, or `null` when absent (R7.3). */
  readonly whyThis: WhyThisDTO | null;
  /** Facility_SubType finer classification, or `null` when absent (R7.4). */
  readonly subType: string | null;
}

/**
 * The projection of an `experiences` row that `reconcile` reads.
 *
 * Only the fields that participate in the diff decision are listed: `id`
 * to look up by stable internal id, `active` to detect soft-deleted rows
 * eligible for reactivation, and `name`/`park`/`category`/`land`/`areaType`/
 * `resortId` to detect material drift from upstream (R1.16). The full row also
 * has `upstreamEntityId`, `description`, and timestamps, but those do not
 * influence whether `reconcile` emits an upsert.
 */
export interface CatalogCacheRow {
  readonly id: string;
  readonly active: boolean;
  readonly name: string;
  readonly park: Park | null;
  readonly category: ExperienceCategory;
  /**
   * Persisted Land name, or `null` when the Experience has no Land (R2.1,
   * R3.1). Read into the diff so a Land drift from upstream is detected as a
   * material change.
   */
  readonly land: string | null;
  /**
   * The resolved Area_Type of the Experience. Read into the diff so a
   * re-classification of the owning Area (e.g. a restaurant moving from the
   * resort-wide catch-all to a specific resort) is detected as a material
   * change and re-applied to the cached row (R4.11-R4.15).
   */
  readonly areaType: AreaType;
  /**
   * The owning Resort's Internal_Id when the Experience belongs to a specific
   * resort, else `null`. Read into the diff so a change in the resolved resort
   * ancestor is detected as a material change (R4.14).
   */
  readonly resortId: string | null;
  /**
   * The persisted Resort_Area (geographic zone) for a `Resort`-area
   * Experience, else `null`. Read into the diff so a change in the resolved
   * Resort_Area is detected as a material change.
   */
  readonly resortArea: string | null;
  /**
   * The persisted World Showcase country pavilion, or `null`. Read into the
   * diff so a change in the resolved country is detected as a material change.
   */
  readonly worldShowcaseCountry: string | null;
  /**
   * The represented Resort's Internal_Id when this row is a resort-representing
   * Experience (Option A), else `null` for every ordinary Experience. Read into
   * the diff so a drift in the discriminator is detected as a material change
   * and re-applied to the cached row (Requirements 3.1, 3.2).
   */
  readonly representsResortId: string | null;
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
  readonly park: Park | null;
  readonly category: ExperienceCategory;
  /** Sanitized, plain-text description ready to persist (R11.8). */
  readonly description: string;
  /**
   * Nearest-ancestor Land name to persist, or `null` when the Experience has
   * no Land (R2.1, R3.1). Carried through the diff so Catalog_Sync writes it.
   */
  readonly land: string | null;
  /**
   * WDW Resort_Area (geographic zone) to persist for a `Resort`-area
   * Experience, or `null` otherwise. Carried through the diff so Catalog_Sync
   * writes it.
   */
  readonly resortArea: string | null;
  /**
   * EPCOT World Showcase country pavilion to persist, or `null`. Carried
   * through the diff so Catalog_Sync writes it.
   */
  readonly worldShowcaseCountry: string | null;
  /** Disney-provided image URL (from `selectImageUrl`), or `null` (R7.1-R7.3, R14.9). */
  readonly imageUrl: string | null;
  /** Owning Area_Type (R5.7). */
  readonly areaType: AreaType;
  /** Referenced Resort's Internal_Id for a `Resort` area, else `null` (R5.7). */
  readonly resortId: string | null;
  /**
   * The represented Resort's Internal_Id for a resort-representing Experience,
   * else `null`. Carried through the diff so Catalog_Sync persists the
   * discriminator that makes the hotel completable (Requirements 3.1, 3.2).
   */
  readonly representsResortId: string | null;
  /** Latitude, or `null` (R5.1, R5.2, R5.6). */
  readonly latitude: number | null;
  /** Longitude, or `null` (R5.1, R5.2, R5.6). */
  readonly longitude: number | null;
  /** Accessibility facet tags; empty when none (R5.3, R5.6). */
  readonly accessibility: readonly string[];
  /** Dining price tier, or `null` (R5.4, R5.6). */
  readonly priceTier: string | null;
  /** Meal periods; empty when none (R5.5, R5.6). */
  readonly mealPeriods: readonly MealPeriodDTO[];
  /**
   * Grouped_Facets to persist for the Persisted_Facet_Groups; empty when none
   * (R7.1). Carried through the diff so Catalog_Sync writes it. The
   * Physical_Considerations and Interest_Facets views are re-derived on read,
   * so they are not carried here.
   */
  readonly groupedFacets: GroupedFacetsDTO;
  /** Height requirement with derived numeric minimums, or `null` (R7.2). */
  readonly heightRequirement: HeightRequirementDTO | null;
  /** Structured why-this marketing copy, or `null` (R7.3). */
  readonly whyThis: WhyThisDTO | null;
  /** Facility_SubType finer classification, or `null` (R7.4). */
  readonly subType: string | null;
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
 * The complete Experience diff produced by a single `reconcile` invocation.
 */
export interface ReconcileResult {
  readonly upserts: readonly ReconcileUpsert[];
  readonly softDeletes: readonly ReconcileSoftDelete[];
}

// ---------------------------------------------------------------------------
// Resort reconciliation (parallel to the Experience diff above)
// ---------------------------------------------------------------------------
//
// Resorts are a first-class catalog concept (R6) reconciled with the same
// insert / reactivate / upsert / no-change / soft-delete rules as Experiences
// (R6.9, R6.10, R11.1-R11.5). The shapes below mirror the Experience diff
// shapes but carry the Resort's own descriptive fields (name, description,
// imageUrl, coordinates, address, phone — R6.3, R6.4, R6.5) rather than the
// Experience taxonomy fields.

/**
 * The fully-resolved upstream Resort that `reconcileResorts` operates on. The
 * caller derives the stable internal `id` via `internalId(upstreamEntityId)`
 * (R6.6) and selects `imageUrl` via `selectImageUrl` (R6.5) before calling
 * `reconcileResorts`, keeping the diff logic pure.
 */
export interface UpstreamResort {
  /** Stable Internal_Id; UUIDv5 of the Enterprise_Id (R6.6). */
  readonly id: string;
  /** The Enterprise_Id of the source `resort` Facility_Document. */
  readonly upstreamEntityId: string;
  /** Resort name copied from the Facility_Document (R6.3). */
  readonly name: string;
  /** Description, or `null` when the document omits it (R6.3, R6.4). */
  readonly description: string | null;
  /** Disney-provided image URL (from `selectImageUrl`), or `null` (R6.5). */
  readonly imageUrl: string | null;
  /** Latitude, or `null` when omitted (R6.4). */
  readonly latitude: number | null;
  /** Longitude, or `null` when omitted (R6.4). */
  readonly longitude: number | null;
  /** Address, or `null` when omitted (R6.4). */
  readonly address: string | null;
  /** Phone, or `null` when omitted (R6.4). */
  readonly phone: string | null;
}

/**
 * The projection of a `resorts` row that `reconcileResorts` reads. Unlike the
 * Experience cache row (which only carries the three change-detection fields),
 * the Resort cache row carries every persisted descriptive field because any
 * of them drifting from upstream triggers an upsert (R6.3, R6.4, R6.5).
 */
export interface ResortCacheRow {
  readonly id: string;
  readonly active: boolean;
  readonly name: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly address: string | null;
  readonly phone: string | null;
}

/**
 * One Resort upsert produced by `reconcileResorts`. `active` is always `true`;
 * soft-deletes flow through `ResortReconcileSoftDelete`. `description` is
 * sanitized to plain text when present and preserved as `null` when absent
 * (R6.4, R11.8).
 */
export interface ResortReconcileUpsert {
  readonly id: string;
  readonly upstreamEntityId: string;
  readonly name: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly address: string | null;
  readonly phone: string | null;
  readonly active: true;
}

/**
 * One Resort soft-delete produced by `reconcileResorts`. The row is preserved
 * on disk with its Internal_Id so it can later reactivate (R6.9, R6.10).
 */
export interface ResortReconcileSoftDelete {
  readonly id: string;
}

/**
 * The complete Resort diff produced by a single `reconcileResorts` invocation.
 */
export interface ResortReconcileResult {
  readonly upserts: readonly ResortReconcileUpsert[];
  readonly softDeletes: readonly ResortReconcileSoftDelete[];
}

// ---------------------------------------------------------------------------
// Combined catalog snapshot / diff
// ---------------------------------------------------------------------------

/**
 * The full pre-run cache snapshot fed to `reconcileCatalog`: both the
 * Experience cache and the Resort cache.
 */
export interface CatalogSnapshot {
  readonly experiences: readonly CatalogCacheRow[];
  readonly resorts: readonly ResortCacheRow[];
}

/**
 * The full upstream set fed to `reconcileCatalog`: the classified/enriched
 * Experiences and the Resort records for this run.
 */
export interface UpstreamCatalog {
  readonly experiences: readonly UpstreamExperience[];
  readonly resorts: readonly UpstreamResort[];
}

/**
 * One restaurant's persisted menu set, layered onto the combined diff by the
 * sync orchestrator (task 9.1) after the pure reconcile step. `menus` carries
 * the full `MenuDTO[]` structure (R8.2) written to `experience_menus` as a
 * JSONB unit. Only restaurants whose menus were successfully fetched and are
 * non-empty appear here: a fetch that returns no menus persists no menu, and a
 * fetch failure omits the restaurant entirely so any previously persisted menu
 * is left unchanged (R8.3, R8.4).
 */
export interface MenuWrite {
  /** Internal_Id of the restaurant Experience the menus belong to. */
  readonly experienceId: string;
  /** The projected menus to persist for that restaurant (R8.2). */
  readonly menus: readonly MenuDTO[];
}

/**
 * The combined diff produced by `reconcileCatalog`, consumed by the repo's
 * `applyReconciliation` and applied within a single transaction (R11.6,
 * R11.7). Menu writes are layered on by the orchestrator/repo (task 8.4) via
 * the optional `menus` field and are not part of the pure reconcile diff.
 */
export interface CatalogDiff {
  readonly experiences: ReconcileResult;
  readonly resorts: ResortReconcileResult;
  /**
   * Per-restaurant menu upserts to apply in the same transaction as the
   * Experience/Resort writes. Absent when the run fetched no menus (R8.3,
   * R8.4).
   */
  readonly menus?: readonly MenuWrite[];
}
