/**
 * Pure Land resolution for a Disney Facility_Document.
 *
 * This module implements design.md → "1. `resolveLand` (`disney/land.ts`)" and
 * Requirement 1 (R1.1–R1.5, R1.7): given a Facility_Document and its
 * already-resolved {@link AreaResolution}, it resolves the Experience's Land —
 * the themed area (e.g. Fantasyland, Tomorrowland) within a theme park or water
 * park to which the Experience belongs — from the nearest Land_Ancestor in the
 * document's ancestor chain.
 *
 * Like the sibling `resolveArea`, `resolveLand` is:
 *
 *   - **Pure**: depends only on its arguments; no I/O, no clock, no globals.
 *   - **Total**: defined for every possible `FacilityDocument` and
 *     `AreaResolution` — including a document with no ancestor chain or with a
 *     Land_Ancestor whose name is absent or whitespace-only — and never throws.
 *   - **Deterministic**: equal inputs always produce equal outputs.
 *
 * Land is meaningful only for `ThemePark` and `WaterPark` Area_Types; it is
 * `null` for `DisneySprings` and `Resort` Experiences (R1.5) and for park
 * Experiences with no resolvable Land (R1.3, R1.4).
 *
 * `resolveLand` takes the pre-computed `AreaResolution` so it never re-walks
 * the area logic and cannot cause an Experience to be dropped: it is a strictly
 * additive read over the same ancestor chain `resolveArea` already inspected,
 * so R1.6 (area/park/resort resolution unchanged) is satisfied structurally.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.7
 */

import type { AreaResolution } from './area.js';
import type { AncestorRef, FacilityDocument } from './facilityDoc.js';

/** Ancestor Facility_Type of a themed Land within a park (R1.1). */
const LAND_ANCESTOR_TYPE = 'land';

/**
 * The maximum persisted Land length, consistent with the existing Experience
 * name length constraint (R1.7).
 */
const MAX_LAND_LENGTH = 200;

/**
 * Resolve an Experience's Land from its ancestor chain, given its already
 * resolved area.
 *
 * Behavior:
 *
 *   - **Area gating (R1.5).** When `area.areaType` is `DisneySprings` or
 *     `Resort`, returns `null` immediately without inspecting the ancestors.
 *   - **Nearest Land_Ancestor (R1.1).** For `ThemePark`/`WaterPark` areas, the
 *     ancestor chain is scanned for the first entry of `type === 'land'` — the
 *     Land_Ancestor nearest to the Experience in the chain's fixed ordering.
 *   - **Normalization (R1.2, R1.4, R1.7).** The Land_Ancestor's name is trimmed
 *     with its original character casing preserved; a name that is absent or
 *     whitespace-only yields `null`; otherwise it is truncated to at most the
 *     first {@link MAX_LAND_LENGTH} characters.
 *   - **No Land_Ancestor (R1.3).** A park Experience whose chain contains no
 *     Land_Ancestor yields `null`.
 *
 * @param doc - The Facility_Document whose Land is being resolved.
 * @param area - The Experience's already-resolved {@link AreaResolution}.
 * @returns The resolved Land string, or `null` when Land is not meaningful or
 *   not resolvable.
 */
export function resolveLand(
  doc: FacilityDocument,
  area: AreaResolution,
): string | null {
  // R1.5: Land is meaningful only for ThemePark/WaterPark areas.
  if (area.areaType === 'DisneySprings' || area.areaType === 'Resort') {
    return null;
  }

  const ancestors: readonly AncestorRef[] = doc.ancestors ?? [];

  // R1.1: the Land_Ancestor nearest to the Experience is the first `land`-type
  // entry in the chain's fixed ordering.
  const landAncestor = ancestors.find(
    (ancestor) => ancestor.type?.toLowerCase() === LAND_ANCESTOR_TYPE,
  );

  // R1.3: no Land_Ancestor → null.
  if (landAncestor === undefined) {
    return null;
  }

  // R1.2 / R1.4: trim (preserving casing); whitespace-only or absent → null.
  const name = landAncestor.name;
  if (name === undefined) {
    return null;
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // R1.7: truncate to at most the first 200 characters.
  return trimmed.slice(0, MAX_LAND_LENGTH);
}
