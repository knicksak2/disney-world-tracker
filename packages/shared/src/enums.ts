/**
 * Shared enum value sets for the Disney World Tracker.
 *
 * Each enum is expressed as a readonly tuple of string literals plus a derived
 * union type. The runtime tuples are useful for iteration (e.g. building Zod
 * schemas in `packages/shared/src/schemas/*` or generating property-test
 * arbitraries) while the derived types give compile-time exhaustiveness.
 *
 * Validates: Requirements 1.3-1.6, 9.7
 */

// ---------------------------------------------------------------------------
// ExperienceCategory
// ---------------------------------------------------------------------------
//
// Classification of an Experience as defined in the requirements glossary.
// The value set is closed: any upstream entity that does not fall into one of
// the named categories must be classified as `Other`.
//
// The `Character_Meet` member intentionally uses an underscore to match the
// glossary spelling and the design's ER diagram
// (`category "enum: Ride|Show|Restaurant|Parade|Character_Meet|Other"`).

export const EXPERIENCE_CATEGORIES = [
  'Ride',
  'Show',
  'Restaurant',
  'Parade',
  'Character_Meet',
  'Tour',
  'Recreation',
  'Spa',
  'Event',
  'Other',
] as const;

export type ExperienceCategory = (typeof EXPERIENCE_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// AreaType
// ---------------------------------------------------------------------------
//
// The kind of place an Experience belongs to, per the requirements glossary.
// An Experience is grouped by its Area_Type; a `Resort`-area Experience
// additionally references the specific Resort's Internal_Id. The value set is
// closed and mirrors the design's area-resolution precedence
// (ThemePark → WaterPark → DisneySprings → Resort).

export const AREA_TYPES = [
  'ThemePark',
  'WaterPark',
  'DisneySprings',
  'Resort',
] as const;

export type AreaType = (typeof AREA_TYPES)[number];

// ---------------------------------------------------------------------------
// Park
// ---------------------------------------------------------------------------
//
// One of the four Walt Disney World theme parks, the two water parks, or
// Disney Springs (per the requirements glossary). Display-name strings are the
// canonical wire-format values and the values stored in
// `experiences.park` per the design.

export const PARKS = [
  'Magic Kingdom',
  'EPCOT',
  'Hollywood Studios',
  'Animal Kingdom',
  'Typhoon Lagoon',
  'Blizzard Beach',
  'Disney Springs',
] as const;

export type Park = (typeof PARKS)[number];

// ---------------------------------------------------------------------------
// SharePayloadKind
// ---------------------------------------------------------------------------
//
// Discriminator for the kind of content a Share carries, matching the
// `shares.payload_kind` column in the design's ER diagram.
//
// - `experience`: a Share that references a single Experience and may include
//   the sender's Rating and/or Note (R9.1, R9.4, R9.5, R9.6).
// - `progress`:   a Share that carries the sender's overall, per-Park, and
//   per-Experience_Category completion percentages (R9.7).

export const SHARE_PAYLOAD_KINDS = ['experience', 'progress'] as const;

export type SharePayloadKind = (typeof SHARE_PAYLOAD_KINDS)[number];
