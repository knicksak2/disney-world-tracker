/**
 * Resort DTO.
 *
 * A Disney hotel/resort — a first-class catalog concept distinct from an
 * Experience — sourced from a `resort` Facility_Document and reconciled into
 * the local cache. The `id` is the stable Internal_Id (UUIDv5 of the
 * Enterprise_Id over the existing namespace, R6.6); every descriptive field is
 * nullable because the upstream document may omit it (R6.4, R6.5).
 *
 * Types only — validation lives in `packages/shared/src/schemas/`.
 *
 * Validates: Requirements 6.6, 6.8
 */

export interface ResortDTO {
  /** Stable Internal_Id; UUIDv5 of the Enterprise_Id (R6.6). */
  readonly id: string;

  /** Resort name copied from the Facility_Document (R6.3). */
  readonly name: string;

  /** Plain-text description, or `null` when the document omits it (R6.3, R6.4). */
  readonly description: string | null;

  /**
   * Absolute URL of a representative image, sourced from the Facility_Document
   * `detailImageUrl`/`listImageUrl` (R6.5), or `null` when neither is present.
   */
  readonly imageUrl: string | null;

  /** Latitude, or `null` when the document omits coordinates (R6.4). */
  readonly latitude: number | null;

  /** Longitude, or `null` when the document omits coordinates (R6.4). */
  readonly longitude: number | null;

  /** Address, or `null` when the document omits it (R6.4). */
  readonly address: string | null;

  /** Phone, or `null` when the document omits it (R6.4). */
  readonly phone: string | null;
}
