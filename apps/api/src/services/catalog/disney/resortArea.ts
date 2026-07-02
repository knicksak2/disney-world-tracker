/**
 * Pure Resort_Area resolution for a Disney Facility_Document.
 *
 * A Resort_Area is a broad geographic zone of the Walt Disney World property
 * (e.g. "EPCOT Resort Area", "Magic Kingdom Resort Area", "Disney Springs
 * Resort Area"). Disney carries it on every Facility_Document as the
 * Resort_Area_Ancestor. This module resolves it from a document's ancestor
 * chain, given the document's already-resolved {@link AreaResolution}.
 *
 * Like the sibling `resolveLand`, `resolveResortArea` is:
 *
 *   - **Pure**: depends only on its arguments; no I/O, no clock, no globals.
 *   - **Total**: defined for every possible `FacilityDocument` and
 *     `AreaResolution` — including a document with no ancestor chain or a
 *     Resort_Area_Ancestor whose name is absent or whitespace-only — and never
 *     throws.
 *   - **Deterministic**: equal inputs always produce equal outputs.
 *
 * The Resort_Area is meaningful only for a `Resort` Area_Type: there, the
 * specific resort alone does not tell a guest which part of the property it
 * sits in (e.g. the Swan Hotel is in the "EPCOT Resort Area"), so the zone adds
 * real locating context. For `ThemePark`/`WaterPark`/`DisneySprings`
 * Experiences the owning Park/Destination already conveys the zone, so the
 * Resort_Area is redundant and this function returns `null` for them — mirroring
 * (inverted) the area gating in `resolveLand`.
 *
 * Taking the pre-computed `AreaResolution` means it never re-walks the area
 * logic and cannot cause an Experience to be dropped: it is a strictly additive
 * read over the same ancestor chain `resolveArea` already inspected.
 */

import type { AreaResolution } from './area.js';
import type { AncestorRef, FacilityDocument } from './facilityDoc.js';

/** Ancestor Facility_Type of a Resort_Area zone. */
const RESORT_AREA_ANCESTOR_TYPE = 'resort-area';

/**
 * The maximum persisted Resort_Area length, consistent with the existing
 * Experience name / Land length constraints.
 */
const MAX_RESORT_AREA_LENGTH = 200;

/**
 * Resolve an Experience's Resort_Area from its ancestor chain, given its
 * already-resolved area.
 *
 * Behavior:
 *
 *   - **Area gating.** When `area.areaType` is not `Resort`, returns `null`
 *     immediately without inspecting the ancestors (the Park/Destination
 *     already conveys the zone).
 *   - **Resort_Area_Ancestor.** For a `Resort` area, the ancestor chain is
 *     scanned for the first entry of `type === 'resort-area'`.
 *   - **Normalization.** The ancestor's name is trimmed with its original
 *     casing preserved; a name that is absent or whitespace-only yields `null`;
 *     otherwise it is truncated to at most {@link MAX_RESORT_AREA_LENGTH}
 *     characters.
 *
 * @param doc - The Facility_Document whose Resort_Area is being resolved.
 * @param area - The Experience's already-resolved {@link AreaResolution}.
 * @returns The resolved Resort_Area string, or `null` when it is not meaningful
 *   or not resolvable.
 */
export function resolveResortArea(
  doc: FacilityDocument,
  area: AreaResolution,
): string | null {
  // The Resort_Area is meaningful only for a Resort area.
  if (area.areaType !== 'Resort') {
    return null;
  }

  const ancestors: readonly AncestorRef[] = doc.ancestors ?? [];

  const resortAreaAncestor = ancestors.find(
    (ancestor) => ancestor.type?.toLowerCase() === RESORT_AREA_ANCESTOR_TYPE,
  );

  if (resortAreaAncestor === undefined) {
    return null;
  }

  const name = resortAreaAncestor.name;
  if (name === undefined) {
    return null;
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.slice(0, MAX_RESORT_AREA_LENGTH);
}
