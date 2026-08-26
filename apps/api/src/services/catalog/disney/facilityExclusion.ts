/**
 * Pure exclusion predicate for Disney Facility_Documents.
 *
 * Sourced from catalog-taxonomy-cleanup design.md and Requirement 1.
 * Filters out non-experience facilities (resort pools, playgrounds, arcades,
 * audio-tour snippets, animal placards, cabana/umbrella rentals, informational
 * pages, and service singletons) from the upstream Experience set.
 *
 * Rules are evaluated in a fixed order corresponding to the `ExclusionRule`
 * union order for deterministic audit breakdown counts (R7.1).
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.13
 */

import type { FacilityDocument } from './facilityDoc.js';

/** Which rule matched, for the per-run audit counts (R7.1). */
export type ExclusionRule =
  | 'audio_tour'
  | 'amenity_sub_type'
  | 'animal_placard'
  | 'rental_inventory'
  | 'community_hall'
  | 'informational_page'
  | 'excluded_name'
  | 'service_facility'
  | 'duplicate_clone';

/** Closed set of resort-amenity Facility_SubTypes to exclude (R1.3). */
export const AMENITY_SUB_TYPES: readonly string[] = [
  'Quiet Pool',
  'Pool',
  'Feature Pool',
  'Kiddie Pool',
  'Spa / Hot Tub',
  'Water Play Area',
  'Playground',
  'Playgrounds',
  'Arcade',
  'Arcades',
  'Fitness Center',
  'Health Club & Spa',
];

const AMENITY_SUB_TYPES_SET: ReadonlySet<string> = new Set(AMENITY_SUB_TYPES);

/** Literal suffix identifying individual animal placards (R1.4). */
export const ANIMAL_PLACARD_SUFFIX = ' - Disney Animals';

/** Pattern for rental-inventory SKUs (R1.5). */
export const RENTAL_INVENTORY_PATTERN =
  /Umbrellas$|Beachcomber Shacks|Polar Patios|Poolside Patios/;

/** Pattern for informational / non-actionable pages (R1.7). */
export const INFORMATIONAL_PAGE_PATTERN =
  /^Guide for Families|^Weather Updates|^Night Owls Guide|^Little Ones Guide|^Park Hopper Hours$|^Allergy|Merchandise|Keepsakes|^Photo Opportunit|^World Showcase Entry$|^World ShowPlace$|^Summer Fun in the Disney Water Parks$|Trick-or-Treat|^Enhanced Nighttime Spectaculars$|^Choose Your Favorite Things|^Real Stuff for Real Life/;

/** Curated exact-match name list of non-experience facilities (R1.8). */
export const EXCLUDED_NAME_LIST: readonly string[] = [
  'Cabanas',
  'Golf Cart Rental',
  'Golf Lessons',
  'Tennis',
  'Volleyball',
  'Campfires',
  'Running Trails',
  'Cake Ordering',
  'In-Room Floral & Gifts',
  'Arcades',
  'Playgrounds',
  'Community Halls',
  'Walt Disney World Golf',
];

const EXCLUDED_NAME_SET: ReadonlySet<string> = new Set(EXCLUDED_NAME_LIST);

/** Pattern for miscellaneous service facilities (R1.9). */
export const SERVICE_FACILITY_PATTERN =
  /Best Friends Pet Hotel|Signature Portrait Session/;

/**
 * Curated list of 14 duplicate/clone Enterprise_Ids to drop (R8.1, R8.2).
 * Dropping is unconditional per R8.4.
 */
export const DUPLICATE_CLONE_IDS: readonly string[] = [
  // Generic Recreation landing-page clones (9)
  '19631365;entityType=Recreation', // Mickey's Very Merry Christmas Party (retain 90004996;entityType=Event)
  '19610128;entityType=Recreation', // EPCOT International Festival of the Arts (retain 18584410;entityType=Event)
  '19610126;entityType=Recreation', // EPCOT International Festival of the Holidays (retain 90004988;entityType=Event)
  '19628700;entityType=Recreation', // EPCOT International Food & Wine Festival (retain 90004982;entityType=Event)
  '19636301;entityType=Recreation', // Disney H2O Glow After Hours (retain 18998437;entityType=Event)
  '19611304;entityType=Recreation', // Aerophile balloon flight (retain 18721320;entityType=Attraction)
  '19611305;entityType=Recreation', // Vintage Amphicar Tours (retain 18693677;entityType=Attraction)
  '19632587;entityType=Recreation', // Drawn to Life (retain 19382527;entityType=Entertainment)
  '19614667;entityType=Recreation', // Mandara Spa (retain 65353;entityType=Spa)

  // Same numeric facility id under two entityTypes (2)
  '80010856;entityType=Entertainment', // Hoop-Dee-Doo (retain 80010856;entityType=Dinner-Show)
  '90002032;entityType=restaurant', // Hoop-Dee-Doo restaurant variant (retain 80010856;entityType=Dinner-Show)

  // Curated judgement calls (3)
  '412316772;entityType=restaurant', // GEO-82 empty stub (retain 412297708;entityType=restaurant)
  '16917380;entityType=Entertainment', // AMC Dine-In (retain 16012973;entityType=restaurant)
  '17000640;entityType=Entertainment', // Splitsville bowling alley (retain 19611303;entityType=Recreation)
];

const DUPLICATE_CLONE_SET: ReadonlySet<string> = new Set(DUPLICATE_CLONE_IDS);

/**
 * Pure, total, deterministic. Returns the first matching rule in the fixed
 * order of the ExclusionRule union, or null when the document is admissible.
 * Never throws; tolerates absent `type`, `subType`, and `name`.
 */
export function exclusionRuleFor(doc: FacilityDocument): ExclusionRule | null {
  // R1.2: Facility_Type 'audio-tour'
  if (doc.type === 'audio-tour') {
    return 'audio_tour';
  }

  // R1.3: Facility_SubType in AMENITY_SUB_TYPES
  if (doc.subType !== undefined && AMENITY_SUB_TYPES_SET.has(doc.subType)) {
    return 'amenity_sub_type';
  }

  const name = doc.name;
  if (name !== undefined) {
    // R1.4: name ends with ' - Disney Animals'
    if (name.endsWith(ANIMAL_PLACARD_SUFFIX)) {
      return 'animal_placard';
    }

    // R1.5: rental inventory pattern
    if (RENTAL_INVENTORY_PATTERN.test(name)) {
      return 'rental_inventory';
    }

    // R1.6: name contains 'Community Hall'
    if (name.includes('Community Hall')) {
      return 'community_hall';
    }

    // R1.7: informational page pattern
    if (INFORMATIONAL_PAGE_PATTERN.test(name)) {
      return 'informational_page';
    }

    // R1.8: exact match in EXCLUDED_NAME_LIST
    if (EXCLUDED_NAME_SET.has(name)) {
      return 'excluded_name';
    }

    // R1.9: service facility pattern
    if (SERVICE_FACILITY_PATTERN.test(name)) {
      return 'service_facility';
    }
  }

  // R8.1: duplicate clone (evaluated last, after all content rules)
  if (doc.id !== undefined && DUPLICATE_CLONE_SET.has(doc.id)) {
    return 'duplicate_clone';
  }

  return null;
}

/** Convenience predicate over `exclusionRuleFor`. */
export function isExcludedFacility(doc: FacilityDocument): boolean {
  return exclusionRuleFor(doc) !== null;
}
