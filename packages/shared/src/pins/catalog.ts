/**
 * Series 1 pin catalog — the authoritative machine-readable roster (174 pins),
 * transcribed from `.kiro/specs/pin-collection/pin-roster-v2.html` onto the
 * `PinCriteria` model, plus the curated/facet set registry the evaluator
 * resolves membership against.
 *
 * Curated sets carry stable `upstream_entity_id` values (resolved from the live
 * catalog); facet/category/predicate sets are resolved at evaluation time so
 * they self-adjust as Disney opens and closes experiences (R13, R19).
 *
 * Art/motif assignment is NOT here — that is the rendered catalogue
 * (materialization, task 6). This file is the logical definition the evaluator
 * and Pin Board consume.
 *
 * Validates: Requirements 1, 7, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19
 */

import type { ExperienceCategory } from '../enums.js';
import type { PinDTO } from '../dto/Pin.js';

/**
 * How the evaluator resolves a named set's membership:
 * - `ids`: a curated list of stable `upstream_entity_id`s.
 * - `facet`: experiences whose `grouped_facets[group]` contains `value`.
 * - `category`: experiences of an `ExperienceCategory` (e.g. Parade).
 * - `realRestaurants`: `Restaurant`s with a real quick- or table-service facet
 *   (excludes festival kiosks, snack carts, pool bars, lounges).
 * - `disneyResorts`: Disney-owned resorts (excludes Good Neighbor / third-party).
 */
export type SetResolution =
  | { readonly kind: 'ids'; readonly ids: readonly string[] }
  | { readonly kind: 'facet'; readonly group: string; readonly value: string }
  | { readonly kind: 'category'; readonly category: ExperienceCategory }
  | { readonly kind: 'realRestaurants' }
  | { readonly kind: 'disneyResorts' };

const A = ';entityType=Attraction';
const ENT = ';entityType=Entertainment';
const RES = ';entityType=resort:resort-visit';
const RST = ';entityType=restaurant';

export const PIN_SETS: Record<string, SetResolution> = {
  // --- Curated id sets (resolved from the live catalog) ---
  roller_coasters: {
    kind: 'ids',
    ids: [
      `80010190${A}`, `80010110${A}`, `16767284${A}`, `16491297${A}`, `411504498${A}`,
      `411499845${A}`, `412573652${A}`, `18904138${A}`, `26068${A}`,
    ],
  },
  mountains: { kind: 'ids', ids: [`80010190${A}`, `80010110${A}`, `26068${A}`] },
  opening_day_1971: {
    kind: 'ids',
    ids: [
      `80010153${A}`, `80010176${A}`, `80010208${A}`, `80010149${A}`, `80010129${A}`,
      `80010162${A}`, `80069748${A}`, `80010230${A}`, `80010222${A}`,
    ],
  },
  deluxe_resorts: {
    kind: 'ids',
    ids: [
      `80010384${RES}`, `80010385${RES}`, `80010388${RES}`, `80010394${RES}`,
      `80010395${RES}`, `80010386${RES}`, `80010390${RES}`, `80010389${RES}`,
    ],
  },
  monorail_loop: { kind: 'ids', ids: [`80010385${RES}`, `80010388${RES}`, `80010384${RES}`] },
  crescent_lake_loop: { kind: 'ids', ids: [`80010386${RES}`, `80010390${RES}`, `80010389${RES}`] },
  skyliner_loop: { kind: 'ids', ids: [`18995875${RES}`, `80010399${RES}`, `80010403${RES}`, `80010404${RES}`] },
  nighttime_spectaculars: { kind: 'ids', ids: [`18672598${ENT}`, `412008998${ENT}`, `80010887${ENT}`] },
  flight_simulators: { kind: 'ids', ids: [`20194${A}`, `18665186${A}`, `80010193${A}`, `19263735${A}`] },
  target_shooters: { kind: 'ids', ids: [`80010114${A}`, `209857${A}`] },
  interstellar: { kind: 'ids', ids: [`80010190${A}`, `80010173${A}`, `80010193${A}`] },
  rail_transit: { kind: 'ids', ids: [`80010230${A}`, `80010224${A}`, `80010235${A}`] },
  animatronic_classics: { kind: 'ids', ids: [`80010232${A}`, `16124144${A}`, `80069754${A}`, `80069748${A}`] },
  circle_vision_360: { kind: 'ids', ids: [`80010180${A}`, `80010174${A}`, `80010145${A}`] },
  royal_banquet: { kind: 'ids', ids: [`90002464${RST}`, `90002066${RST}`, `16660079${RST}`, `90001248${RST}`] },
  wildlife_spotter: { kind: 'ids', ids: [`80010157${A}`, `80010175${A}`, `80010164${A}`] },
  comedy_laughs: { kind: 'ids', ids: [`136550${A}`, `62992${A}`] },

  // --- Facet / category / predicate sets (resolved at evaluation time) ---
  water_rides: { kind: 'facet', group: 'thrillFactor', value: 'Water Rides' },
  dark_rides: { kind: 'facet', group: 'thrillFactor', value: 'Dark' },
  spinners: { kind: 'facet', group: 'thrillFactor', value: 'Spinning' },
  gentle_rides: { kind: 'facet', group: 'thrillFactor', value: 'Slow Rides' },
  star_wars: { kind: 'facet', group: 'interests', value: 'Star Wars' },
  pixar_pals: { kind: 'facet', group: 'interests', value: 'Pixar Pals' },
  classic_characters: { kind: 'facet', group: 'interests', value: 'Classic Characters' },
  princesses: { kind: 'facet', group: 'interests', value: 'Disney Princesses' },
  signature_dining: { kind: 'facet', group: 'tableService', value: 'Fine/Signature Dining' },
  character_dining: { kind: 'facet', group: 'tableService', value: 'Character Dining' },
  coffee: { kind: 'facet', group: 'quickService', value: 'Quick Service - Coffee' },
  pool_bars: { kind: 'facet', group: 'quickService', value: 'Pool Bar' },
  parades: { kind: 'category', category: 'Parade' },
  real_restaurants: { kind: 'realRestaurants' },
  disney_resorts: { kind: 'disneyResorts' },
};

/** Exact `experiences.land` values (theme-park lands). */
const LANDS = [
  'Main Street, U.S.A.', 'Adventureland', 'Frontierland', 'Liberty Square', 'Fantasyland', 'Tomorrowland',
  'World Celebration', 'World Discovery', 'World Nature', 'World Showcase',
  'Hollywood Boulevard', 'Echo Lake', 'Animation Courtyard', 'Sunset Boulevard', 'Toy Story Land', "Star Wars: Galaxy's Edge",
  'Discovery Island', 'Pandora – The World of Avatar', 'Africa', 'Asia',
] as const;

/** Slug a land/park name into an id suffix. */
const slug = (s: string): string =>
  s.toLowerCase().replace(/['.,–—/]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const landStarters: PinDTO[] = LANDS.map((land): PinDTO => ({
  id: `bronze_land_starter_${slug(land)}`,
  tier: 'bronze',
  track: 'places',
  name: `${land} Starter`,
  description: `Log your first experience in ${land}.`,
  criteria: { kind: 'firstInLand', land },
}));

const parkStarters: PinDTO[] = (
  ['Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom', 'Typhoon Lagoon', 'Blizzard Beach', 'Disney Springs'] as const
).map((park): PinDTO => ({
  id: `bronze_park_starter_${slug(park)}`,
  tier: 'bronze',
  track: 'places',
  name: `${park} Starter`,
  description: `Log your first experience in ${park}.`,
  criteria: { kind: 'firstInPark', park },
}));

export const PINS: readonly PinDTO[] = [
  // ===== Attractions ladder (Centurion) =====
  { id: 'bronze_centurion_5', tier: 'bronze', track: 'attractions', name: 'Centurion 5', description: '5 unique attractions logged.', criteria: { kind: 'count', metric: 'attractions', threshold: 5 } },
  { id: 'bronze_centurion_15', tier: 'bronze', track: 'attractions', name: 'Centurion 15', description: '15 unique attractions logged.', criteria: { kind: 'count', metric: 'attractions', threshold: 15 } },
  { id: 'bronze_centurion_30', tier: 'bronze', track: 'attractions', name: 'Centurion 30', description: '30 unique attractions logged.', criteria: { kind: 'count', metric: 'attractions', threshold: 30 } },
  { id: 'silver_centurion_50', tier: 'silver', track: 'attractions', name: 'Centurion 50', description: '50 unique attractions logged.', criteria: { kind: 'count', metric: 'attractions', threshold: 50 } },
  { id: 'silver_centurion_75', tier: 'silver', track: 'attractions', name: 'Centurion 75', description: '75 unique attractions logged.', criteria: { kind: 'count', metric: 'attractions', threshold: 75 } },
  { id: 'gold_centurion_100', tier: 'gold', track: 'attractions', name: 'Centurion 100', description: '100 unique attractions logged.', criteria: { kind: 'count', metric: 'attractions', threshold: 100 } },
  { id: 'gold_centurion_130', tier: 'gold', track: 'attractions', name: 'Centurion 130', description: '130 unique attractions logged.', criteria: { kind: 'count', metric: 'attractions', threshold: 130 } },
  { id: 'amethyst_centurion_160', tier: 'amethyst', track: 'attractions', name: 'Centurion 160', description: '160 unique attractions logged.', criteria: { kind: 'count', metric: 'attractions', threshold: 160 } },
  { id: 'amethyst_centurion_190', tier: 'amethyst', track: 'attractions', name: 'Centurion 190', description: '190 unique attractions logged.', criteria: { kind: 'count', metric: 'attractions', threshold: 190 } },
  { id: 'pearl_centurion_215', tier: 'pearl', track: 'attractions', name: 'Centurion 215', description: '215 unique attractions logged.', criteria: { kind: 'count', metric: 'attractions', threshold: 215 } },
  { id: 'pearl_centurion_235', tier: 'pearl', track: 'attractions', name: 'Centurion 235', description: '235 unique attractions logged.', criteria: { kind: 'count', metric: 'attractions', threshold: 235 } },
  { id: 'prism_all_attractions', tier: 'prism', track: 'attractions', name: 'All Attractions', description: '100% of all active attractions — the Completionist pinnacle.', criteria: { kind: 'catalogComplete', scope: 'attractions' } },

  // ===== Dining · Restaurants ladder =====
  { id: 'bronze_diner_3', tier: 'bronze', track: 'dining', name: 'Diner 3', description: '3 restaurants dined at.', criteria: { kind: 'count', metric: 'restaurants', threshold: 3 } },
  { id: 'bronze_diner_10', tier: 'bronze', track: 'dining', name: 'Diner 10', description: '10 restaurants dined at.', criteria: { kind: 'count', metric: 'restaurants', threshold: 10 } },
  { id: 'bronze_diner_20', tier: 'bronze', track: 'dining', name: 'Diner 20', description: '20 restaurants dined at.', criteria: { kind: 'count', metric: 'restaurants', threshold: 20 } },
  { id: 'bronze_diner_30', tier: 'bronze', track: 'dining', name: 'Diner 30', description: '30 restaurants dined at.', criteria: { kind: 'count', metric: 'restaurants', threshold: 30 } },
  { id: 'silver_foodie_45', tier: 'silver', track: 'dining', name: 'Foodie 45', description: '45 restaurants dined at.', criteria: { kind: 'count', metric: 'restaurants', threshold: 45 } },
  { id: 'silver_foodie_60', tier: 'silver', track: 'dining', name: 'Foodie 60', description: '60 restaurants dined at.', criteria: { kind: 'count', metric: 'restaurants', threshold: 60 } },
  { id: 'gold_gourmand_80', tier: 'gold', track: 'dining', name: 'Gourmand 80', description: '80 restaurants dined at.', criteria: { kind: 'count', metric: 'restaurants', threshold: 80 } },
  { id: 'gold_gourmand_100', tier: 'gold', track: 'dining', name: 'Gourmand 100', description: '100 restaurants dined at.', criteria: { kind: 'count', metric: 'restaurants', threshold: 100 } },
  { id: 'amethyst_connoisseur_120', tier: 'amethyst', track: 'dining', name: 'Connoisseur 120', description: '120 restaurants dined at.', criteria: { kind: 'count', metric: 'restaurants', threshold: 120 } },
  { id: 'amethyst_connoisseur_145', tier: 'amethyst', track: 'dining', name: 'Connoisseur 145', description: '145 restaurants dined at.', criteria: { kind: 'count', metric: 'restaurants', threshold: 145 } },
  { id: 'pearl_epicure_170', tier: 'pearl', track: 'dining', name: 'Epicure 170', description: '170 restaurants dined at.', criteria: { kind: 'count', metric: 'restaurants', threshold: 170 } },
  { id: 'prism_culinary_legend', tier: 'prism', track: 'dining', name: 'Culinary Legend', description: 'Dine at every real restaurant — the Foodie pinnacle.', criteria: { kind: 'set', setId: 'real_restaurants', required: 'all' } },

  // ===== Dining · Festival Foodie =====
  { id: 'bronze_festival_first', tier: 'bronze', track: 'dining', name: 'First Booth', description: '1 festival booth visited.', criteria: { kind: 'count', metric: 'festivalBooths', threshold: 1 } },
  { id: 'bronze_festival_5', tier: 'bronze', track: 'dining', name: 'Booth Sampler', description: '5 festival booths visited.', criteria: { kind: 'count', metric: 'festivalBooths', threshold: 5 } },
  { id: 'bronze_festival_10', tier: 'bronze', track: 'dining', name: 'Booth Explorer', description: '10 festival booths visited.', criteria: { kind: 'count', metric: 'festivalBooths', threshold: 10 } },
  { id: 'silver_festival_20', tier: 'silver', track: 'dining', name: 'Booth Enthusiast', description: '20 festival booths visited.', criteria: { kind: 'count', metric: 'festivalBooths', threshold: 20 } },
  { id: 'gold_festival_30', tier: 'gold', track: 'dining', name: 'Festival Feast', description: '30 festival booths visited.', criteria: { kind: 'count', metric: 'festivalBooths', threshold: 30 } },

  // ===== Dining · Snacks & Lounges =====
  { id: 'bronze_snacker_5', tier: 'bronze', track: 'dining', name: 'Snacker 5', description: '5 snack/kiosk/lounge stops.', criteria: { kind: 'count', metric: 'snacks', threshold: 5 } },
  { id: 'bronze_snacker_15', tier: 'bronze', track: 'dining', name: 'Snacker 15', description: '15 snack/kiosk/lounge stops.', criteria: { kind: 'count', metric: 'snacks', threshold: 15 } },
  { id: 'bronze_snacker_30', tier: 'bronze', track: 'dining', name: 'Snacker 30', description: '30 snack/kiosk/lounge stops.', criteria: { kind: 'count', metric: 'snacks', threshold: 30 } },
  { id: 'silver_snacker_50', tier: 'silver', track: 'dining', name: 'Snacker 50', description: '50 snack/kiosk/lounge stops.', criteria: { kind: 'count', metric: 'snacks', threshold: 50 } },
  { id: 'gold_snacker_75', tier: 'gold', track: 'dining', name: 'Snacker 75', description: '75 snack/kiosk/lounge stops.', criteria: { kind: 'count', metric: 'snacks', threshold: 75 } },
  { id: 'bronze_coffee_crawl', tier: 'bronze', track: 'dining', name: 'Coffee Crawl', description: 'Visit 5 coffee spots.', criteria: { kind: 'set', setId: 'coffee', required: 5 } },
  { id: 'silver_pool_bar_hopper', tier: 'silver', track: 'dining', name: 'Pool Bar Hopper', description: 'Visit 8 resort pool bars.', criteria: { kind: 'set', setId: 'pool_bars', required: 8 } },

  // ===== Dining · Fine Dining =====
  { id: 'silver_signature_4', tier: 'silver', track: 'dining', name: 'Signature Gourmet', description: 'Dine at 4 Signature restaurants.', criteria: { kind: 'set', setId: 'signature_dining', required: 4 } },
  { id: 'gold_signature_10', tier: 'gold', track: 'dining', name: 'Signature Connoisseur', description: 'Dine at 10 Signature restaurants.', criteria: { kind: 'set', setId: 'signature_dining', required: 10 } },
  { id: 'amethyst_signature_all', tier: 'amethyst', track: 'dining', name: 'Signature Master', description: 'Dine at every Signature restaurant.', criteria: { kind: 'set', setId: 'signature_dining', required: 'all' } },
  { id: 'silver_character_dining_3', tier: 'silver', track: 'dining', name: 'Character Dining Trio', description: '3 character meals.', criteria: { kind: 'set', setId: 'character_dining', required: 3 } },
  { id: 'gold_character_dining_all', tier: 'gold', track: 'dining', name: 'Character Dining Master', description: 'Every character-dining venue.', criteria: { kind: 'set', setId: 'character_dining', required: 'all' } },
  { id: 'gold_royal_banquet', tier: 'gold', track: 'dining', name: 'Royal Banquet', description: 'Dine at the royal princess banquets.', criteria: { kind: 'set', setId: 'royal_banquet', required: 'all' } },

  // ===== Places · Starters =====
  ...landStarters,
  ...parkStarters,

  // ===== Places · Silver completions =====
  { id: 'silver_land_adventureland', tier: 'silver', track: 'places', name: 'Adventureland 100%', description: 'All attractions in Adventureland.', criteria: { kind: 'landComplete', lands: ['Adventureland'] } },
  { id: 'silver_land_discovery_island', tier: 'silver', track: 'places', name: 'Discovery Island 100%', description: 'All attractions on Discovery Island.', criteria: { kind: 'landComplete', lands: ['Discovery Island'] } },
  { id: 'silver_land_animation_courtyard', tier: 'silver', track: 'places', name: 'Animation Courtyard 100%', description: 'All attractions in Animation Courtyard.', criteria: { kind: 'landComplete', lands: ['Animation Courtyard'] } },
  { id: 'silver_land_frontierland', tier: 'silver', track: 'places', name: 'Frontierland 100%', description: 'All attractions in Frontierland.', criteria: { kind: 'landComplete', lands: ['Frontierland'] } },
  { id: 'silver_land_asia', tier: 'silver', track: 'places', name: 'Asia 100%', description: 'All attractions in Asia.', criteria: { kind: 'landComplete', lands: ['Asia'] } },
  { id: 'silver_land_world_discovery', tier: 'silver', track: 'places', name: 'World Discovery 100%', description: 'All attractions in World Discovery.', criteria: { kind: 'landComplete', lands: ['World Discovery'] } },
  { id: 'silver_boulevards', tier: 'silver', track: 'places', name: 'The Boulevards', description: 'Complete Hollywood Blvd + Sunset Blvd.', criteria: { kind: 'landComplete', lands: ['Hollywood Boulevard', 'Sunset Boulevard'] } },
  { id: 'silver_immersive_lands', tier: 'silver', track: 'places', name: 'Immersive Lands', description: "Complete Toy Story Land + Galaxy's Edge.", criteria: { kind: 'landComplete', lands: ['Toy Story Land', "Star Wars: Galaxy's Edge"] } },
  { id: 'silver_typhoon_lagoon', tier: 'silver', track: 'places', name: 'Typhoon Lagoon 100%', description: 'All Typhoon Lagoon attractions.', criteria: { kind: 'parkComplete', park: 'Typhoon Lagoon', scope: 'attractions' } },
  { id: 'silver_blizzard_beach', tier: 'silver', track: 'places', name: 'Blizzard Beach 100%', description: 'All Blizzard Beach attractions.', criteria: { kind: 'parkComplete', park: 'Blizzard Beach', scope: 'attractions' } },

  // ===== Places · Gold completions =====
  { id: 'gold_land_fantasyland', tier: 'gold', track: 'places', name: 'Fantasyland 100%', description: 'All attractions in Fantasyland.', criteria: { kind: 'landComplete', lands: ['Fantasyland'] } },
  { id: 'gold_land_main_street', tier: 'gold', track: 'places', name: 'Main Street, U.S.A. 100%', description: 'All attractions on Main Street, U.S.A.', criteria: { kind: 'landComplete', lands: ['Main Street, U.S.A.'] } },
  { id: 'gold_land_tomorrowland', tier: 'gold', track: 'places', name: 'Tomorrowland 100%', description: 'All attractions in Tomorrowland.', criteria: { kind: 'landComplete', lands: ['Tomorrowland'] } },
  { id: 'gold_land_world_nature', tier: 'gold', track: 'places', name: 'World Nature 100%', description: 'All attractions in World Nature.', criteria: { kind: 'landComplete', lands: ['World Nature'] } },
  { id: 'gold_land_world_celebration', tier: 'gold', track: 'places', name: 'World Celebration 100%', description: 'All attractions in World Celebration.', criteria: { kind: 'landComplete', lands: ['World Celebration'] } },
  { id: 'gold_land_africa', tier: 'gold', track: 'places', name: 'Africa 100%', description: 'All attractions in Africa.', criteria: { kind: 'landComplete', lands: ['Africa'] } },
  { id: 'gold_disney_springs', tier: 'gold', track: 'places', name: 'Disney Springs 100%', description: 'All Disney Springs attractions.', criteria: { kind: 'parkComplete', park: 'Disney Springs', scope: 'attractions' } },
  { id: 'gold_all_lands', tier: 'gold', track: 'places', name: 'All Lands Explorer', description: 'Visit an experience in all 20 theme-park lands.', criteria: { kind: 'allLandsVisited' } },

  // ===== Places · Amethyst mastery =====
  { id: 'amethyst_world_showcase', tier: 'amethyst', track: 'places', name: 'World Showcase 100%', description: 'All World Showcase attractions.', criteria: { kind: 'landComplete', lands: ['World Showcase'] } },
  { id: 'amethyst_mk_master', tier: 'amethyst', track: 'places', name: 'Magic Kingdom Master', description: '100% of Magic Kingdom attractions.', criteria: { kind: 'parkComplete', park: 'Magic Kingdom', scope: 'attractions' } },
  { id: 'amethyst_epcot_master', tier: 'amethyst', track: 'places', name: 'EPCOT Master', description: '100% of EPCOT attractions.', criteria: { kind: 'parkComplete', park: 'EPCOT', scope: 'attractions' } },
  { id: 'amethyst_hs_master', tier: 'amethyst', track: 'places', name: 'Hollywood Studios Master', description: '100% of Hollywood Studios attractions.', criteria: { kind: 'parkComplete', park: 'Hollywood Studios', scope: 'attractions' } },
  { id: 'amethyst_ak_master', tier: 'amethyst', track: 'places', name: 'Animal Kingdom Master', description: '100% of Animal Kingdom attractions.', criteria: { kind: 'parkComplete', park: 'Animal Kingdom', scope: 'attractions' } },

  // ===== Places · Pearl sovereigns =====
  { id: 'pearl_mk_sovereign', tier: 'pearl', track: 'places', name: 'Magic Kingdom Sovereign', description: '100% of everything in Magic Kingdom.', criteria: { kind: 'parkComplete', park: 'Magic Kingdom', scope: 'everything' } },
  { id: 'pearl_epcot_sovereign', tier: 'pearl', track: 'places', name: 'EPCOT Sovereign', description: '100% of everything in EPCOT.', criteria: { kind: 'parkComplete', park: 'EPCOT', scope: 'everything' } },
  { id: 'pearl_hs_sovereign', tier: 'pearl', track: 'places', name: 'Hollywood Studios Sovereign', description: '100% of everything in Hollywood Studios.', criteria: { kind: 'parkComplete', park: 'Hollywood Studios', scope: 'everything' } },
  { id: 'pearl_ak_sovereign', tier: 'pearl', track: 'places', name: 'Animal Kingdom Sovereign', description: '100% of everything in Animal Kingdom.', criteria: { kind: 'parkComplete', park: 'Animal Kingdom', scope: 'everything' } },
  { id: 'pearl_four_parks_master', tier: 'pearl', track: 'places', name: 'Four Parks Master', description: '100% of the attractions across all four theme parks.', criteria: { kind: 'parksAttractionsComplete' } },

  // ===== Places · Mythic capstone =====
  { id: 'mythic_whole_catalog', tier: 'mythic', track: 'places', name: 'The Whole Catalog', description: '100% of all active experiences — the 1-of-1 apex.', criteria: { kind: 'catalogComplete', scope: 'all' } },

  // ===== Social · Squad =====
  { id: 'bronze_squad_1', tier: 'bronze', track: 'social', name: 'First Ride Together', description: '1 confirmed friend ride.', criteria: { kind: 'count', metric: 'friendRides', threshold: 1 } },
  { id: 'bronze_squad_5', tier: 'bronze', track: 'social', name: 'Squad 5', description: '5 friend rides.', criteria: { kind: 'count', metric: 'friendRides', threshold: 5 } },
  { id: 'silver_squad_10', tier: 'silver', track: 'social', name: 'Squad 10', description: '10 friend rides.', criteria: { kind: 'count', metric: 'friendRides', threshold: 10 } },
  { id: 'silver_squad_15', tier: 'silver', track: 'social', name: 'Squad 15', description: '15 friend rides.', criteria: { kind: 'count', metric: 'friendRides', threshold: 15 } },
  { id: 'gold_squad_25', tier: 'gold', track: 'social', name: 'Squad 25', description: '25 friend rides.', criteria: { kind: 'count', metric: 'friendRides', threshold: 25 } },
  { id: 'amethyst_squad_40', tier: 'amethyst', track: 'social', name: 'Squad 40', description: '40 friend rides.', criteria: { kind: 'count', metric: 'friendRides', threshold: 40 } },

  // ===== Social · Critic =====
  { id: 'bronze_critic_1', tier: 'bronze', track: 'social', name: 'First Review', description: '1 rating or note.', criteria: { kind: 'count', metric: 'reviews', threshold: 1 } },
  { id: 'bronze_critic_5', tier: 'bronze', track: 'social', name: 'Reviewer 5', description: '5 reviews.', criteria: { kind: 'count', metric: 'reviews', threshold: 5 } },
  { id: 'silver_critic_10', tier: 'silver', track: 'social', name: 'Reviewer 10', description: '10 reviews.', criteria: { kind: 'count', metric: 'reviews', threshold: 10 } },
  { id: 'silver_critic_25', tier: 'silver', track: 'social', name: 'Reviewer 25', description: '25 reviews.', criteria: { kind: 'count', metric: 'reviews', threshold: 25 } },
  { id: 'gold_critic_50', tier: 'gold', track: 'social', name: 'Reviewer 50', description: '50 reviews.', criteria: { kind: 'count', metric: 'reviews', threshold: 50 } },
  { id: 'pearl_ultimate_critic', tier: 'pearl', track: 'social', name: 'Ultimate Critic', description: '50 ratings and 25 notes.', criteria: { kind: 'compound', all: [{ kind: 'count', metric: 'ratings', threshold: 50 }, { kind: 'count', metric: 'notes', threshold: 25 }] } },

  // ===== Social · Trip Organizer =====
  { id: 'bronze_organizer_1', tier: 'bronze', track: 'social', name: 'First Trip', description: 'Organize or join 1 trip.', criteria: { kind: 'count', metric: 'trips', threshold: 1 } },
  { id: 'silver_organizer_3', tier: 'silver', track: 'social', name: 'Trip Coordinator', description: '3 trips.', criteria: { kind: 'count', metric: 'trips', threshold: 3 } },
  { id: 'gold_organizer_5', tier: 'gold', track: 'social', name: 'Trip Captain', description: '5 trips.', criteria: { kind: 'count', metric: 'trips', threshold: 5 } },
  { id: 'amethyst_organizer_10', tier: 'amethyst', track: 'social', name: 'Trip Commander', description: '10 trips.', criteria: { kind: 'count', metric: 'trips', threshold: 10 } },

  // ===== Social · Pinnacle =====
  { id: 'prism_legendary_guide', tier: 'prism', track: 'social', name: 'Legendary Guide', description: '50 friend rides and 5 organized trips — the Social pinnacle.', criteria: { kind: 'compound', all: [{ kind: 'count', metric: 'friendRides', threshold: 50 }, { kind: 'count', metric: 'trips', threshold: 5 }] } },

  // ===== Resorts =====
  { id: 'bronze_resort_1', tier: 'bronze', track: 'resorts', name: 'First Resort', description: 'Visit 1 Disney resort.', criteria: { kind: 'count', metric: 'resorts', threshold: 1 } },
  { id: 'bronze_resort_3', tier: 'bronze', track: 'resorts', name: 'Resort Explorer 3', description: '3 Disney resorts.', criteria: { kind: 'count', metric: 'resorts', threshold: 3 } },
  { id: 'silver_resort_6', tier: 'silver', track: 'resorts', name: 'Resort Voyager 6', description: '6 Disney resorts.', criteria: { kind: 'count', metric: 'resorts', threshold: 6 } },
  { id: 'gold_resort_12', tier: 'gold', track: 'resorts', name: 'Resort Voyager 12', description: '12 Disney resorts.', criteria: { kind: 'count', metric: 'resorts', threshold: 12 } },
  { id: 'amethyst_resort_20', tier: 'amethyst', track: 'resorts', name: 'Resort Explorer 20', description: '20 Disney resorts.', criteria: { kind: 'count', metric: 'resorts', threshold: 20 } },
  { id: 'silver_monorail_loop', tier: 'silver', track: 'resorts', name: 'Monorail Loop', description: 'Contemporary + Polynesian + Grand Floridian.', criteria: { kind: 'set', setId: 'monorail_loop', required: 'all' } },
  { id: 'silver_crescent_lake', tier: 'silver', track: 'resorts', name: 'Crescent Lake', description: 'BoardWalk + Yacht Club + Beach Club.', criteria: { kind: 'set', setId: 'crescent_lake_loop', required: 'all' } },
  { id: 'silver_skyliner_resorts', tier: 'silver', track: 'resorts', name: 'Skyliner Resorts', description: 'Riviera + Caribbean Beach + Pop + Art of Animation.', criteria: { kind: 'set', setId: 'skyliner_loop', required: 'all' } },
  { id: 'pearl_deluxe_royalty', tier: 'pearl', track: 'resorts', name: 'Grand Deluxe Seal', description: 'All 8 Deluxe resorts.', criteria: { kind: 'set', setId: 'deluxe_resorts', required: 'all' } },
  { id: 'prism_grand_hotelier', tier: 'prism', track: 'resorts', name: 'Grand Hotelier', description: 'All Disney-owned resorts — the Hotelier pinnacle.', criteria: { kind: 'set', setId: 'disney_resorts', required: 'all' } },

  // ===== Characters & Princesses =====
  { id: 'bronze_meet_1', tier: 'bronze', track: 'characters', name: 'First Meet', description: '1 character meet.', criteria: { kind: 'count', metric: 'characterMeets', threshold: 1 } },
  { id: 'bronze_meet_3', tier: 'bronze', track: 'characters', name: 'Character Trio', description: '3 character meets.', criteria: { kind: 'count', metric: 'characterMeets', threshold: 3 } },
  { id: 'bronze_meet_5', tier: 'bronze', track: 'characters', name: 'Character Friend', description: '5 character meets.', criteria: { kind: 'count', metric: 'characterMeets', threshold: 5 } },
  { id: 'silver_meet_10', tier: 'silver', track: 'characters', name: 'Character Hunter', description: '10 character meets.', criteria: { kind: 'count', metric: 'characterMeets', threshold: 10 } },
  { id: 'gold_meet_15', tier: 'gold', track: 'characters', name: 'Character Collector', description: '15 character meets.', criteria: { kind: 'count', metric: 'characterMeets', threshold: 15 } },
  { id: 'amethyst_meet_25', tier: 'amethyst', track: 'characters', name: 'Character Royalty', description: '25 character meets.', criteria: { kind: 'count', metric: 'characterMeets', threshold: 25 } },
  { id: 'bronze_royal_encounter', tier: 'bronze', track: 'characters', name: 'Royal Encounter', description: 'Meet 1 princess.', criteria: { kind: 'set', setId: 'princesses', required: 1 } },
  { id: 'gold_princess_court', tier: 'gold', track: 'characters', name: 'Princess Court', description: 'Meet 4 princesses.', criteria: { kind: 'set', setId: 'princesses', required: 4 } },
  { id: 'amethyst_all_princesses', tier: 'amethyst', track: 'characters', name: 'All Princesses', description: 'Meet every princess.', criteria: { kind: 'set', setId: 'princesses', required: 'all' } },

  // ===== Touring / single-day feats =====
  { id: 'bronze_two_parks', tier: 'bronze', track: 'touring', name: 'Two Parks in One Day', description: 'Log in 2 theme parks, same day.', criteria: { kind: 'singleDay', feat: { type: 'multiPark', parks: 2 } } },
  { id: 'gold_three_parks', tier: 'gold', track: 'touring', name: 'Three Parks in One Day', description: 'Log in 3 theme parks, same day.', criteria: { kind: 'singleDay', feat: { type: 'multiPark', parks: 3 } } },
  { id: 'amethyst_four_parks', tier: 'amethyst', track: 'touring', name: 'Four Parks in One Day', description: 'Log in all 4 theme parks, same day.', criteria: { kind: 'singleDay', feat: { type: 'multiPark', parks: 4 } } },
  { id: 'silver_6_ride_day', tier: 'silver', track: 'touring', name: '6-Ride Day', description: '6 rides in one day.', criteria: { kind: 'singleDay', feat: { type: 'rideMarathon', rides: 6 } } },
  { id: 'gold_10_ride_day', tier: 'gold', track: 'touring', name: '10-Ride Day', description: '10 rides in one day.', criteria: { kind: 'singleDay', feat: { type: 'rideMarathon', rides: 10 } } },
  { id: 'amethyst_12_ride_day', tier: 'amethyst', track: 'touring', name: '12-Ride Day', description: '12 rides in one day.', criteria: { kind: 'singleDay', feat: { type: 'rideMarathon', rides: 12 } } },
  { id: 'pearl_15_ride_marathon', tier: 'pearl', track: 'touring', name: '15-Ride Marathon', description: '15 rides in one day.', criteria: { kind: 'singleDay', feat: { type: 'rideMarathon', rides: 15 } } },
  { id: 'gold_taste_of_the_kingdoms', tier: 'gold', track: 'touring', name: 'Taste of the Kingdoms', description: 'A meal in all 4 theme parks, same day.', criteria: { kind: 'singleDay', feat: { type: 'diningAllParks' } } },
  { id: 'silver_around_the_world', tier: 'silver', track: 'touring', name: 'Around the World', description: 'An experience in all 11 World Showcase countries, same day.', criteria: { kind: 'singleDay', feat: { type: 'aroundTheWorld' } } },
  { id: 'prism_grand_slam', tier: 'prism', track: 'touring', name: 'Grand Slam', description: 'All 4 parks and 15 rides, same day — the Touring pinnacle.', criteria: { kind: 'singleDay', feat: { type: 'grandSlam' } } },

  // ===== Thematic · Rides =====
  { id: 'bronze_coaster_rookie', tier: 'bronze', track: 'thematic', name: 'Coaster Rookie', description: 'Ride your first roller coaster.', criteria: { kind: 'set', setId: 'roller_coasters', required: 1 } },
  { id: 'gold_coaster_royalty', tier: 'gold', track: 'thematic', name: 'Coaster Royalty', description: 'Ride all roller coasters.', criteria: { kind: 'set', setId: 'roller_coasters', required: 'all' } },
  { id: 'silver_three_mountains', tier: 'silver', track: 'thematic', name: 'Triple Mountain', description: 'Space + Big Thunder + Everest.', criteria: { kind: 'set', setId: 'mountains', required: 'all' } },
  { id: 'silver_water_rides_5', tier: 'silver', track: 'thematic', name: 'Water Ride Splasher', description: '5 water rides.', criteria: { kind: 'set', setId: 'water_rides', required: 5 } },
  { id: 'amethyst_water_rides_all', tier: 'amethyst', track: 'thematic', name: 'Making Waves', description: 'All water rides.', criteria: { kind: 'set', setId: 'water_rides', required: 'all' } },
  { id: 'silver_dark_rides_6', tier: 'silver', track: 'thematic', name: 'Dark Ride Fan', description: '6 dark rides.', criteria: { kind: 'set', setId: 'dark_rides', required: 6 } },
  { id: 'gold_dark_rides_all', tier: 'gold', track: 'thematic', name: 'Dark Ride Master', description: 'All dark rides.', criteria: { kind: 'set', setId: 'dark_rides', required: 'all' } },
  { id: 'bronze_spinner_1', tier: 'bronze', track: 'thematic', name: 'Spin Cycle', description: 'Your first spinner.', criteria: { kind: 'set', setId: 'spinners', required: 1 } },
  { id: 'silver_spinners_all', tier: 'silver', track: 'thematic', name: 'Dizzy Devotee', description: 'All spinners.', criteria: { kind: 'set', setId: 'spinners', required: 'all' } },
  { id: 'gold_gentle_rides_all', tier: 'gold', track: 'thematic', name: 'Gentle Soul', description: 'All gentle rides.', criteria: { kind: 'set', setId: 'gentle_rides', required: 'all' } },

  // ===== Thematic · Shows =====
  { id: 'silver_show_enthusiast', tier: 'silver', track: 'thematic', name: 'Show Enthusiast', description: 'See 5 shows.', criteria: { kind: 'count', metric: 'shows', threshold: 5 } },
  { id: 'gold_show_connoisseur', tier: 'gold', track: 'thematic', name: 'Show Connoisseur', description: 'See 15 shows.', criteria: { kind: 'count', metric: 'shows', threshold: 15 } },
  { id: 'amethyst_show_devotee', tier: 'amethyst', track: 'thematic', name: 'Show Devotee', description: 'See 30 shows.', criteria: { kind: 'count', metric: 'shows', threshold: 30 } },
  { id: 'silver_nighttime_spectaculars', tier: 'silver', track: 'thematic', name: 'Nighttime Spectaculars', description: 'See the nighttime shows.', criteria: { kind: 'set', setId: 'nighttime_spectaculars', required: 'all' } },
  { id: 'silver_parades', tier: 'silver', track: 'thematic', name: 'Parade Watcher', description: 'See all parades.', criteria: { kind: 'set', setId: 'parades', required: 'all' } },

  // ===== Thematic · Historical / signature =====
  { id: 'silver_1971_club', tier: 'silver', track: 'thematic', name: '1971 Opening Day Club', description: 'All 9 opening-day classics.', criteria: { kind: 'set', setId: 'opening_day_1971', required: 'all' } },
  { id: 'silver_animatronic_classics', tier: 'silver', track: 'thematic', name: 'Animatronic Classics', description: 'Carousel of Progress + Hall of Presidents + Tiki Room + Country Bears.', criteria: { kind: 'set', setId: 'animatronic_classics', required: 'all' } },
  { id: 'silver_flight_simulators', tier: 'silver', track: 'thematic', name: 'Flight Simulator Ace', description: "Soarin' + Flight of Passage + Star Tours + Smugglers Run.", criteria: { kind: 'set', setId: 'flight_simulators', required: 'all' } },
  { id: 'bronze_target_blaster', tier: 'bronze', track: 'thematic', name: 'Target Blaster', description: 'Buzz Lightyear + Toy Story Mania.', criteria: { kind: 'set', setId: 'target_shooters', required: 'all' } },
  { id: 'silver_interstellar_pilot', tier: 'silver', track: 'thematic', name: 'Interstellar Pilot', description: 'Space Mountain + Mission: SPACE + Star Tours.', criteria: { kind: 'set', setId: 'interstellar', required: 'all' } },
  { id: 'silver_rail_transit', tier: 'silver', track: 'thematic', name: 'Rail & Transit', description: 'WDW Railroad + PeopleMover + Wildlife Express.', criteria: { kind: 'set', setId: 'rail_transit', required: 'all' } },
  { id: 'silver_wildlife_spotter', tier: 'silver', track: 'thematic', name: 'Wildlife Spotter', description: 'Kilimanjaro Safaris + wildlife trails.', criteria: { kind: 'set', setId: 'wildlife_spotter', required: 'all' } },
  { id: 'bronze_comedy_laughs', tier: 'bronze', track: 'thematic', name: 'Comedy & Laughs', description: 'Monsters Inc. Laugh Floor + Turtle Talk.', criteria: { kind: 'set', setId: 'comedy_laughs', required: 'all' } },
  { id: 'silver_circle_vision_360', tier: 'silver', track: 'thematic', name: 'Circle-Vision 360', description: 'Canada + China + France 360° films.', criteria: { kind: 'set', setId: 'circle_vision_360', required: 'all' } },

  // ===== Thematic · Franchise =====
  { id: 'silver_star_wars', tier: 'silver', track: 'thematic', name: 'Star Wars Devotee', description: 'All Star Wars experiences.', criteria: { kind: 'set', setId: 'star_wars', required: 'all' } },
  { id: 'gold_pixar_pals', tier: 'gold', track: 'thematic', name: 'Pixar Pals', description: 'All Pixar experiences.', criteria: { kind: 'set', setId: 'pixar_pals', required: 'all' } },
  { id: 'silver_classic_characters', tier: 'silver', track: 'thematic', name: 'Classic Characters', description: 'All classic-character experiences.', criteria: { kind: 'set', setId: 'classic_characters', required: 'all' } },

  // ===== Thematic · Culture =====
  { id: 'silver_world_traveler_6', tier: 'silver', track: 'thematic', name: 'World Traveler', description: '6 World Showcase countries.', criteria: { kind: 'count', metric: 'worldShowcaseCountries', threshold: 6 } },
  { id: 'gold_world_traveler_11', tier: 'gold', track: 'thematic', name: 'World Showcase Traveler', description: 'All 11 World Showcase countries.', criteria: { kind: 'count', metric: 'worldShowcaseCountries', threshold: 11 } },
  { id: 'prism_global_ambassador', tier: 'prism', track: 'thematic', name: 'Global Ambassador', description: '11 countries + 3 films + World Nature/Discovery 100% — the Culture pinnacle.', criteria: { kind: 'compound', all: [{ kind: 'count', metric: 'worldShowcaseCountries', threshold: 11 }, { kind: 'set', setId: 'circle_vision_360', required: 'all' }, { kind: 'landComplete', lands: ['World Nature'] }, { kind: 'landComplete', lands: ['World Discovery'] }] } },
];
