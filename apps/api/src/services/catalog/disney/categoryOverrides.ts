/**
 * Curated Category_Overrides for Disney facility catalog.
 *
 * Sourced from catalog-taxonomy-cleanup design.md → Data Models.
 * Contains 53 hand-maintained Enterprise_Id → ExperienceCategory mappings.
 *
 * Validates: Requirements 2.3, 2.5, 2.6, 2.8
 */

import type { ExperienceCategory } from '@dwt/shared';

/** Curated key: the numeric id plus entityType, per R2.5. */
export interface OverrideKey {
  readonly numericId: string;
  readonly entityType: string;
}

/**
 * Curated list of 53 category overrides.
 * Key format: `${numericId};entityType=${entityType}`.
 */
const OVERRIDES_ENTRIES: readonly (readonly [string, ExperienceCategory])[] = [
  // → Show (18 entries)
  ['80069748;entityType=Attraction', 'Show'], // Country Bear Musical Jamboree
  ['80069754;entityType=Attraction', 'Show'], // The Hall of Presidents
  ['80010200;entityType=Attraction', 'Show'], // The American Adventure
  ['80010170;entityType=Attraction', 'Show'], // Mickey's PhilharMagic
  ['136550;entityType=Attraction', 'Show'], // Monsters, Inc. Laugh Floor
  ['16124144;entityType=Attraction', 'Show'], // Walt Disney's Enchanted Tiki Room
  ['62992;entityType=Attraction', 'Show'], // Turtle Talk With Crush
  ['19463785;entityType=Attraction', 'Show'], // Beauty and the Beast Sing-Along
  ['80010145;entityType=Attraction', 'Show'], // Impressions de France
  ['80010180;entityType=Attraction', 'Show'], // Reflections of China
  ['80010174;entityType=Attraction', 'Show'], // Canada Far and Wide in Circle-Vision 360
  ['19473173;entityType=Attraction', 'Show'], // Awesome Planet
  ['19497952;entityType=Attraction', 'Show'], // Vacation Fun — An Original Animated Short
  ['16767276;entityType=Attraction', 'Show'], // Enchanted Tales with Belle
  ['18770880;entityType=Attraction', 'Show'], // Walt Disney Presents
  ['412735091;entityType=Attraction', 'Show'], // The Magic of Disney Animation
  ['18269694;entityType=Attraction', 'Show'], // Disney and Pixar Short Film Festival
  ['19503896;entityType=Attraction', 'Show'], // Palais du Cinéma

  // → Walkthrough (17 entries)
  ['80010175;entityType=Attraction', 'Walkthrough'], // Gorilla Falls Exploration Trail
  ['80010164;entityType=Attraction', 'Walkthrough'], // Maharajah Jungle Trek
  ['80010126;entityType=Attraction', 'Walkthrough'], // Discovery Island Trails
  ['80010214;entityType=Attraction', 'Walkthrough'], // The Oasis Exhibits
  ['80010184;entityType=Attraction', 'Walkthrough'], // SeaBase Aquarium
  ['80010196;entityType=Attraction', 'Walkthrough'], // Swiss Family Treehouse
  ['80010217;entityType=Attraction', 'Walkthrough'], // Tree of Life
  ['411794307;entityType=Attraction', 'Walkthrough'], // Journey of Water, Inspired by Moana
  ['411794409;entityType=Attraction', 'Walkthrough'], // Dreamers Point
  ['16767209;entityType=Attraction', 'Walkthrough'], // Cinderella Castle
  ['26421;entityType=Attraction', 'Walkthrough'], // American Heritage Gallery
  ['80069745;entityType=Attraction', 'Walkthrough'], // Bijutsu-kan Gallery
  ['80069743;entityType=Attraction', 'Walkthrough'], // Mexico Folk Art Gallery
  ['61525;entityType=Attraction', 'Walkthrough'], // Stave Church Gallery
  ['80010137;entityType=Attraction', 'Walkthrough'], // Gallery of Arts and History
  ['160914;entityType=Attraction', 'Walkthrough'], // House of the Whispering Willows
  ['411708725;entityType=Attraction', 'Walkthrough'], // Disney Springs Art Walk: A Canvas of Expression

  // → PlayArea (9 entries)
  ['80010144;entityType=Attraction', 'PlayArea'], // ImageWorks — The "What If" Labs
  ['220239;entityType=Attraction', 'PlayArea'], // Project Tomorrow: Inventing the Wonders of the Future
  ['3831;entityType=Attraction', 'PlayArea'], // Advanced Training Lab
  ['91245;entityType=Attraction', 'PlayArea'], // Kidcot Fun Stops
  ['412606840;entityType=Attraction', 'PlayArea'], // Jumping Junction
  ['56404;entityType=Attraction', 'PlayArea'], // Bruce's Shark World
  ['16512939;entityType=Attraction', 'PlayArea'], // Casey Jr. Splash 'N' Soak Station
  ['65083;entityType=Attraction', 'PlayArea'], // Marketplace Fun Fountains
  ['293719;entityType=Recreation', 'PlayArea'], // Uwanja Camp (curated keep)

  // → Game (8 entries)
  ['17272158;entityType=Attraction', 'Game'], // A Pirate's Adventure ~ Treasures of the Seven Seas
  ['17396838;entityType=Attraction', 'Game'], // Wilderness Explorers
  ['19062768;entityType=Attraction', 'Game'], // Play Disney Parks
  ['411657083;entityType=Attraction', 'Game'], // Disney Fab 50 Quest
  ['411657082;entityType=Attraction', 'Game'], // Star Wars: Batuu Bounty Hunters
  ['19272517;entityType=Attraction', 'Game'], // Star Wars: Datapad on Play Disney Parks Mobile App
  ['412396709;entityType=Attraction', 'Game'], // Adventure All Around the Park
  ['80010119;entityType=Attraction', 'Game'], // Animal Care at Conservation Station

  // → Event (1 entry)
  ['19637044;entityType=Recreation', 'Event'], // Mickey's Not-So-Scary Halloween Party
];

/** The full curated map. Exported for the unmatched-override audit (R2.7). */
export const CATEGORY_OVERRIDES: ReadonlyMap<string, ExperienceCategory> =
  new Map<string, ExperienceCategory>(OVERRIDES_ENTRIES);

/**
 * Returns the overridden category for an Enterprise_Id, or null when absent.
 * `${numericId};entityType=${entityType}` → category.
 */
export function categoryOverrideFor(
  enterpriseId: string,
): ExperienceCategory | null {
  return CATEGORY_OVERRIDES.get(enterpriseId) ?? null;
}
