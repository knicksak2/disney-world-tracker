/**
 * Canonical Catalog & Explore constants shared across API and mobile client.
 */

/**
 * Default number of items displayed in ResortGuideSection cards before
 * inline progressive disclosure ("Show all / Show fewer") triggers.
 */
export const DEFAULT_RESORT_SECTION_LIMIT = 4;

/**
 * Canonical 3-tile Utility Dock items on Explore Hub.
 */
export const EXPLORE_UTILITY_TILES = [
  { id: 'waits', label: 'Live Waits', icon: '⏱️', route: 'LiveWaits' },
  { id: 'crowds', label: 'Crowds', icon: '📊', route: 'CrowdCalendar' },
  { id: 'favorites', label: 'Favorites', icon: '♥', route: 'Favorites' },
] as const;

export type ExploreUtilityTile = (typeof EXPLORE_UTILITY_TILES)[number];
export type ExploreUtilityTileId = ExploreUtilityTile['id'];

/**
 * Canonical 2x2 Theme Parks Landmark Grid configuration on Explore Hub.
 */
export const THEME_PARKS_EXPLORE_GRID = [
  { park: 'Magic Kingdom', landmark: 'Cinderella Castle', imageKey: 'mk_castle' },
  { park: 'EPCOT', landmark: 'Spaceship Earth', imageKey: 'epcot_ball' },
  { park: 'Hollywood Studios', landmark: 'Tower of Terror', imageKey: 'dhs_tower' },
  { park: 'Animal Kingdom', landmark: 'Tree of Life', imageKey: 'dak_tree' },
] as const;

export type ThemeParkExploreGridItem = (typeof THEME_PARKS_EXPLORE_GRID)[number];
