import { v5 as uuidv5 } from 'uuid';

/**
 * Fixed namespace UUID used to derive stable internal Experience identifiers
 * from upstream ThemeParks.wiki entity IDs.
 *
 * This value MUST NOT change once any Experience data has been persisted:
 * changing it would break the one-to-one mapping between an upstream entity
 * ID and its internal identifier required by R1.7 across Catalog_Sync runs.
 *
 * The constant is a randomly generated, RFC 4122 v4 UUID dedicated to the
 * Disney World Tracker Catalog_Service; it is declared here as the single
 * source of truth.
 */
export const INTERNAL_ID_NAMESPACE = '7c1e8e2a-9d4b-4a3f-9c5b-1f2e3d4c5b6a';

/**
 * Distinct namespace UUID used to derive the stable internal identifier of a
 * **resort-representing Experience** — the thin Experience row Catalog_Sync
 * emits per active Resort so a hotel is completable through the existing
 * `completions -> experiences` FK (design.md → "Catalog_Sync change",
 * Requirements 3.1, 3.2).
 *
 * It MUST differ from {@link INTERNAL_ID_NAMESPACE} so a representing row's id
 * can never collide with the Resort's own Internal_Id or any ordinary
 * Experience id derived from the same Enterprise_Id: UUIDv5 is a function of
 * `(namespace, name)`, so a distinct namespace guarantees a distinct id for the
 * same Enterprise_Id. Like {@link INTERNAL_ID_NAMESPACE}, this value MUST NOT
 * change once any resort-representing Experience has been persisted, or the
 * Completions recorded against a hotel would lose their stable target.
 *
 * The constant is a fixed, RFC 4122 v4 UUID dedicated to the resort-visit
 * derivation and declared here as the single source of truth.
 */
export const RESORT_VISIT_ID_NAMESPACE = 'b2f4c1d6-3e5a-4c8b-9f7d-2a1e6c3b4d5f';

/**
 * Derive the stable internal Experience identifier for a given upstream
 * ThemeParks.wiki / Disney entity ID.
 *
 * The mapping is implemented as UUIDv5 over a fixed namespace (default
 * {@link INTERNAL_ID_NAMESPACE}), which makes it:
 *
 *   - deterministic: the same `upstreamId` + `namespace` always returns the
 *     same UUID;
 *   - one-to-one: distinct upstream IDs yield distinct internal UUIDs within a
 *     namespace (modulo the cryptographic collision resistance of SHA-1 over
 *     UUIDv5 inputs);
 *   - stable across processes, hosts, and Catalog_Sync runs.
 *
 * Passing {@link RESORT_VISIT_ID_NAMESPACE} derives the id of a
 * resort-representing Experience from the Resort's Enterprise_Id over a
 * distinct namespace, so it never collides with the Resort's own id or any
 * ordinary Experience id (Requirements 3.1, 3.2).
 *
 * Validates: Requirements 1.7
 */
export function internalId(
  upstreamId: string,
  namespace: string = INTERNAL_ID_NAMESPACE,
): string {
  return uuidv5(upstreamId, namespace);
}
