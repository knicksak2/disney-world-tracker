/**
 * Pure imagery selection for a Disney Facility_Document.
 *
 * This module implements the single imagery-precedence rule described in
 * design.md → "6. Enrichment and imagery (`enrich.ts`, `imagery.ts`)" and
 * Requirement 7 (with R6.5 applying the same rule to Resort records):
 *
 *   1. A **non-empty** `detailImageUrl` wins and becomes the catalog item's
 *      `imageUrl` (R7.1).
 *   2. Otherwise a **non-empty** `listImageUrl` is used (R7.2).
 *   3. Otherwise the catalog item's `imageUrl` is `null` (R7.3).
 *
 * The same precedence is shared by both Experiences and Resorts (R6.5), so this
 * one function is the sole source of truth for the "detail wins, else list,
 * else null" decision and cannot drift between the two callers.
 *
 * "Non-empty" here means non-empty **after trimming**: a field that is absent,
 * an empty string, or consists only of whitespace does not count as an image
 * source. This matches the Requirement 7 wording ("a non-empty
 * `detailImageUrl` / `listImageUrl`") and guards against the reverse-engineered
 * Disney documents carrying blank or whitespace-only image fields.
 *
 * Purity note: `selectImageUrl` is pure, total, and deterministic — it depends
 * only on its argument, performs no I/O, and never throws for any
 * `FacilityDocument`, mirroring the purity discipline of the sibling pure cores
 * (`classifyFacility.ts`, `enrich.ts`).
 *
 * Validates: Requirements 6.5, 7.1, 7.2, 7.3
 */

import type { FacilityDocument } from './facilityDoc.js';

/**
 * Normalize a candidate image field to a usable URL, or `null` when the field
 * does not qualify as a non-empty image source.
 *
 * A field qualifies only when it is a present string whose trimmed form is
 * non-empty (R7.1, R7.2); an absent, empty, or whitespace-only value yields
 * `null`. The trimmed value is returned so no surrounding whitespace leaks into
 * the persisted URL.
 *
 * @param value - The raw `detailImageUrl` or `listImageUrl` field, possibly absent.
 * @returns The trimmed URL when non-empty, otherwise `null`.
 */
function nonEmptyImageUrl(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Select the catalog `imageUrl` for a Facility_Document using the shared
 * Disney imagery precedence (Requirement 7, R6.5).
 *
 * Precedence:
 *   - a non-empty `detailImageUrl` (R7.1); else
 *   - a non-empty `listImageUrl` (R7.2); else
 *   - `null` (R7.3).
 *
 * Used identically for Experiences and Resorts so the imagery decision is
 * defined in exactly one place (R6.5).
 *
 * @param doc - The Facility_Document to select imagery for.
 * @returns The selected image URL, or `null` when neither field is non-empty.
 */
export function selectImageUrl(doc: FacilityDocument): string | null {
  return nonEmptyImageUrl(doc.detailImageUrl) ?? nonEmptyImageUrl(doc.listImageUrl);
}
