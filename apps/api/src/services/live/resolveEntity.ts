/**
 * ThemeParks.wiki entity resolver (pure).
 *
 * The `Live_Service` joins catalog Experiences to ThemeParks.wiki live data by
 * a single, deliberately narrow correspondence: the Experience's
 * `Enterprise_Id` (persisted as `experiences.upstream_entity_id`) equals the
 * ThemeParks.wiki entity's `External_Id` (exposed on the wire as `externalId`).
 * See design.md §8 and Requirements R11.2 and R13.4.
 *
 * This module is the sole place that correspondence is decided, so it is kept
 * pure, total, and dependency-free: no network, no clock, no I/O. Given an
 * `Enterprise_Id` and a dataset of candidate entities it returns the matching
 * entity or `null`.
 *
 * Matching discipline (Property 12):
 *
 *   1. **Exact string equality on `externalId` only.** The resolver never falls
 *      back to `id`, `name`, `slug`, or any other key. Two entities that differ
 *      only in `externalId` resolve differently; an entity whose `externalId`
 *      does not string-equal the `Enterprise_Id` never matches, regardless of
 *      how any other field compares.
 *
 *   2. **Absent/empty keys never match.** A candidate with a missing or empty
 *      `externalId` must not match a missing or empty `Enterprise_Id`. An empty
 *      `Enterprise_Id` therefore resolves to `null` up front, and because a
 *      non-empty `Enterprise_Id` can only equal a non-empty `externalId`,
 *      `undefined`/`""` keys are excluded naturally.
 *
 *   3. **Deterministic tie-break.** `External_Id` is expected to be unique
 *      across the dataset, but should duplicates ever appear the resolver
 *      returns the first match in iteration order so the result is stable and
 *      reproducible.
 *
 * Validates: Requirements 11.2, 13.4.
 */

/**
 * Minimal shape the resolver reads from a ThemeParks.wiki entity.
 *
 * `externalId` is the join key (equals the Disney `Enterprise_Id`) and is
 * optional because upstream may omit it; `id` is the ThemeParks.wiki entity
 * identifier the caller subsequently uses to fetch the entity's live feed
 * (`GET /entity/{id}/live`). Both
 * {@link ThemeParksDestinationEntry} and {@link ThemeParksEntityChild} in
 * `services/catalog/themeparks.ts` satisfy this interface, so a caller can pass
 * either collection and receive the concrete entity type back.
 */
export interface ResolvableThemeParksEntity {
  /** ThemeParks.wiki entity id, used to fetch the live feed for the match. */
  readonly id: string;
  /** ThemeParks.wiki `External_Id`; equals the Disney `Enterprise_Id` (R11.2). */
  readonly externalId?: string;
}

/**
 * Resolve the ThemeParks.wiki entity whose `External_Id` equals the given
 * Experience `Enterprise_Id`.
 *
 * Generic over the concrete entity type so the caller keeps the full entity
 * (and its `id`) rather than a widened projection.
 *
 * @param enterpriseId The Experience's `Enterprise_Id`
 *   (`experiences.upstream_entity_id`).
 * @param entities The candidate ThemeParks.wiki entities to resolve against.
 * @returns The first entity whose `externalId` exactly equals `enterpriseId`,
 *   or `null` when no such entity exists.
 */
export function resolveThemeParksEntity<T extends ResolvableThemeParksEntity>(
  enterpriseId: string,
  entities: readonly T[],
): T | null {
  // An empty/absent Enterprise_Id can never designate an entity: a missing or
  // empty External_Id must not match a missing key (R11.2). Guarding here also
  // means the equality check below only ever succeeds against a non-empty
  // External_Id.
  if (enterpriseId === '') {
    return null;
  }

  for (const entity of entities) {
    // Exact string equality on External_Id — and nothing else. Because
    // `enterpriseId` is non-empty here, `undefined`/`""` externalIds are
    // excluded without a special case.
    if (entity.externalId === enterpriseId) {
      return entity;
    }
  }

  return null;
}
