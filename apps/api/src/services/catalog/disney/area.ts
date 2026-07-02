/**
 * Pure area resolution for a Disney Facility_Document.
 *
 * This module implements design.md → "5. Area resolution (`area.ts`)" and
 * Requirement 4 (R4.11–R4.15): it walks a Facility_Document's ancestor chain
 * and resolves the Experience's owning `Area`, recording an `Area_Type` of
 * `ThemePark`, `WaterPark`, `DisneySprings`, or `Resort`.
 *
 * Like the sibling `classifyFacility.ts`, `resolveArea` is:
 *
 *   - **Pure**: depends only on its argument; no I/O, no clock, no globals.
 *   - **Total**: defined for every possible `FacilityDocument` — including one
 *     with no ancestor chain or with only unrecognized ancestors — and never
 *     throws.
 *   - **Deterministic**: equal inputs always produce equal outputs.
 *
 * Crucially, `resolveArea` *always* returns an `AreaResolution` and therefore
 * never causes an Experience to be dropped for lacking a resolvable area: when
 * the ancestor chain resolves to no theme park, water park, Disney Springs, or
 * specific resort, the function falls back to a resort-wide catch-all Area with
 * `Area_Type = 'Resort'` and no specific resort reference (R4.15).
 *
 * Resolution precedence (R4.12 → R4.15), highest first:
 *
 *   1. A theme-park ancestor → `ThemePark`; a water-park ancestor → `WaterPark`
 *      (R4.12). The `Park` enum value is mapped from the ancestor's name.
 *   2. Else a Disney Springs ancestor → `DisneySprings`, with the `Disney
 *      Springs` `Park` value (R4.13).
 *   3. Else a resort ancestor → `Resort`, referencing that resort's
 *      Enterprise_Id (later resolved to the resort's Internal_Id) (R4.14).
 *   4. Else a resort-wide catch-all → `Resort` with no specific resort (R4.15).
 *
 * Validates: Requirements 4.11, 4.12, 4.13, 4.14, 4.15
 */

import type { AreaType, Park } from '@dwt/shared';

import type { AncestorRef, FacilityDocument } from './facilityDoc.js';

/**
 * The resolved owning Area of an Experience.
 *
 * @see resolveArea
 */
export interface AreaResolution {
  /** The classified Area_Type (R4.11). Always present. */
  readonly areaType: AreaType;
  /**
   * The owning `Park` enum value when `areaType` is `ThemePark`, `WaterPark`,
   * or `DisneySprings` and the ancestor name maps to a known Park; otherwise
   * `undefined`. Never set for a `Resort` area.
   */
  readonly park?: Park;
  /**
   * The Enterprise_Id of the specific resort ancestor when `areaType` is
   * `Resort` and a specific resort was resolved (R4.14). `undefined` for the
   * resort-wide catch-all (R4.15) and for non-`Resort` areas.
   */
  readonly resortEnterpriseId?: string;
}

/** Ancestor Facility_Type of a WDW theme park (R4.12). */
const THEME_PARK_TYPE = 'theme-park';
/** Ancestor Facility_Type of a WDW water park (R4.12). */
const WATER_PARK_TYPE = 'water-park';
/** Ancestor Facility_Type of a specific Disney resort/hotel (R4.14). */
const RESORT_ANCESTOR_TYPE = 'resort';

/** Matches a Disney Springs ancestor name, case-insensitive (R4.13). */
const DISNEY_SPRINGS_PATTERN = /disney\s*springs/i;

/**
 * Map an ancestor's display name to one of the `Park` enum values, or `null`
 * when the name matches no known Park.
 *
 * The patterns are deliberately permissive because upstream names carry
 * decorations (e.g. "Disney's Hollywood Studios", "Disney's Animal Kingdom
 * Theme Park") rather than the bare `Park` enum strings. This mirrors the
 * name-matching already used by the catalog sync orchestrator. The first match
 * wins; ordering only matters to disambiguate overlapping substrings.
 *
 * Pure and total: returns `null` for `undefined` or unrecognized names, never
 * throws.
 */
function matchParkName(name: string | undefined): Park | null {
  if (name === undefined) {
    return null;
  }
  const normalized = name.toLowerCase();
  if (/magic\s*kingdom/.test(normalized)) return 'Magic Kingdom';
  if (/epcot/.test(normalized)) return 'EPCOT';
  if (/hollywood\s*studios/.test(normalized)) return 'Hollywood Studios';
  if (/animal\s*kingdom/.test(normalized)) return 'Animal Kingdom';
  if (/typhoon\s*lagoon/.test(normalized)) return 'Typhoon Lagoon';
  if (/blizzard\s*beach/.test(normalized)) return 'Blizzard Beach';
  if (/disney\s*springs/.test(normalized)) return 'Disney Springs';
  return null;
}

/**
 * Resolve the owning Area and Area_Type of a Facility_Document from its
 * ancestor chain.
 *
 * The ancestor chain is scanned once, collecting the highest-precedence
 * candidate of each kind (theme/water park, Disney Springs, specific resort).
 * Precedence is then applied per R4.12–R4.15. The function always returns a
 * resolution and never excludes an Experience for area reasons: an
 * unresolvable chain yields the resort-wide catch-all (R4.15).
 *
 * @param doc - The tolerant Disney Facility_Document projection.
 * @returns The resolved {@link AreaResolution}. Always defined.
 */
export function resolveArea(doc: FacilityDocument): AreaResolution {
  const ancestors: readonly AncestorRef[] = doc.ancestors ?? [];

  // Highest-precedence candidate of each kind, captured in a single pass.
  let parkArea: AreaResolution | null = null; // ThemePark or WaterPark (R4.12)
  let disneySpringsArea: AreaResolution | null = null; // (R4.13)
  let resortEnterpriseId: string | undefined; // specific resort (R4.14)

  for (const ancestor of ancestors) {
    const type = ancestor.type?.toLowerCase();

    // R4.12: a theme-park or water-park ancestor is the top-precedence Area.
    // The first one found wins; we keep scanning only to surface it if an
    // earlier candidate was of a lower tier.
    if (type === THEME_PARK_TYPE) {
      if (parkArea === null) {
        const park = matchParkName(ancestor.name);
        parkArea =
          park === null
            ? { areaType: 'ThemePark' }
            : { areaType: 'ThemePark', park };
      }
      continue;
    }
    if (type === WATER_PARK_TYPE) {
      if (parkArea === null) {
        const park = matchParkName(ancestor.name);
        parkArea =
          park === null
            ? { areaType: 'WaterPark' }
            : { areaType: 'WaterPark', park };
      }
      continue;
    }

    // R4.13: a Disney Springs ancestor, identified by name (it is not carried
    // as a distinct Facility_Type). Recorded only as the second-tier fallback.
    if (
      disneySpringsArea === null &&
      ancestor.name !== undefined &&
      DISNEY_SPRINGS_PATTERN.test(ancestor.name)
    ) {
      disneySpringsArea = { areaType: 'DisneySprings', park: 'Disney Springs' };
      continue;
    }

    // R4.14: a specific resort ancestor (the `resort` type, distinct from the
    // structural `resort-area`). The first one found wins.
    if (type === RESORT_ANCESTOR_TYPE && resortEnterpriseId === undefined) {
      resortEnterpriseId = ancestor.id;
    }
  }

  // Apply precedence: park (R4.12) → Disney Springs (R4.13) → specific resort
  // (R4.14) → resort-wide catch-all (R4.15).
  if (parkArea !== null) {
    return parkArea;
  }
  if (disneySpringsArea !== null) {
    return disneySpringsArea;
  }
  if (resortEnterpriseId !== undefined) {
    return { areaType: 'Resort', resortEnterpriseId };
  }

  // R4.15: never drop an Experience for lacking a resolvable area — fall back
  // to a resort-wide catch-all Area with no specific resort reference.
  return { areaType: 'Resort' };
}
