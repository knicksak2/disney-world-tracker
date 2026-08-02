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
  // `Resort` classifies the resort-representing Experience — the completable
  // stand-in for a Disney hotel (see the resort-tracking-and-stats feature).
  // No real, browsable Experience is classified `Resort`; resort-*area*
  // activities keep their own category (Restaurant, Recreation, Spa, …).
  'Resort',
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

// ---------------------------------------------------------------------------
// Reaction_Vocabulary
// ---------------------------------------------------------------------------
//
// The closed set of values a recipient may attach to a delivered Share as a
// `Share_Reaction` (R11.2, R11.3). A recipient holds at most one reaction per
// Share, drawn exclusively from this vocabulary; any value outside the set is
// rejected with a validation error and nothing is persisted. The sender of the
// Share can see the reactions their recipients attached (R11.7).
//
// The runtime tuple is the source of truth: it seeds the matching Zod
// primitive (`shareReactionValueSchema`), the migration's CHECK constraint,
// and property-test arbitraries, so the vocabulary cannot drift between layers.

export const SHARE_REACTION_VALUES = [
  'like',
  'love',
  'been_there',
  'want_to_go',
] as const;

export type ShareReactionValue = (typeof SHARE_REACTION_VALUES)[number];

// ---------------------------------------------------------------------------
// Trip_Reaction vocabulary
// ---------------------------------------------------------------------------
//
// The closed set of values a Trip_Member may attach to a Trip_Feed target as a
// `Trip_Reaction` (R13.6). A Member holds at most one reaction per type on a
// given target, drawn exclusively from this vocabulary; any value outside the
// set is rejected with a validation error and nothing is persisted.
//
// The runtime tuple is the source of truth: it seeds the matching Zod
// primitive (`tripReactionValueSchema`), the migration's CHECK constraint,
// and property-test arbitraries, so the vocabulary cannot drift between layers.

export const TRIP_REACTION_VALUES = [
  'like',
  'love',
  'celebrate',
  'wow',
] as const;

export type TripReactionValue = (typeof TRIP_REACTION_VALUES)[number];
