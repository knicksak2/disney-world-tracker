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
 * Derive the stable internal Experience identifier for a given upstream
 * ThemeParks.wiki entity ID.
 *
 * The mapping is implemented as UUIDv5 over the fixed
 * {@link INTERNAL_ID_NAMESPACE} namespace, which makes it:
 *
 *   - deterministic: the same `upstreamId` always returns the same UUID;
 *   - one-to-one: distinct upstream IDs yield distinct internal UUIDs (modulo
 *     the cryptographic collision resistance of SHA-1 over UUIDv5 inputs);
 *   - stable across processes, hosts, and Catalog_Sync runs.
 *
 * Validates: Requirements 1.7
 */
export function internalId(upstreamId: string): string {
  return uuidv5(upstreamId, INTERNAL_ID_NAMESPACE);
}
