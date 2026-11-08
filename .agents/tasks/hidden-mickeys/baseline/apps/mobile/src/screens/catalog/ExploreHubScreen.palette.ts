// Feature: dark-mode — co-located light/dark literal pairs for ExploreHubScreen.tsx.
import { DARK_TONAL, definePalette } from '../../theme/theme';

/** Utility-dock icon circles (rule 3 S) and their glyphs (rule 3 T); visited badge (rule 3 F). */
export const EXPLORE = definePalette({
  light: {
    dockWaitsBg: '#E0F2FE',
    dockWaitsIcon: '#0284C7',
    dockCrowdsBg: '#FEF3C7',
    dockCrowdsIcon: '#D97706',
    dockFavoritesBg: '#FFE4E6',
    dockFavoritesIcon: '#E11D48',
    // Solid fill behind the white "visited" check (green, rule 3 F).
    visitedFill: '#10B981',
  },
  dark: {
    dockWaitsBg: DARK_TONAL.sky.tint,
    dockWaitsIcon: DARK_TONAL.sky.fg,
    dockCrowdsBg: DARK_TONAL.amber.tint,
    dockCrowdsIcon: DARK_TONAL.orange.fg,
    dockFavoritesBg: DARK_TONAL.red.tint,
    dockFavoritesIcon: DARK_TONAL.red.fg,
    visitedFill: DARK_TONAL.green.fill,
  },
});

/**
 * Hero tiles (park / water-park / Disney Springs / Resorts cards). These sit on
 * the destination gradients, which are already dark in light mode (rule 3 H),
 * so the tile backstops, veils and the light text drawn on them are
 * mode-invariant.
 */
const HERO_VALUES = {
  parkTileBg: '#1E293B',
  slateBg: '#0F172A',
  resortsBg: '#1E1B4B',
  slateVeil: 'rgba(15, 23, 42, 0.65)',
  indigoVeil: 'rgba(30, 27, 75, 0.7)',
  heroSubText: '#E2E8F0',
  heroCountText: '#CBD5E1',
  admissionBg: 'rgba(16, 185, 129, 0.25)',
  admissionBorder: 'rgba(16, 185, 129, 0.45)',
  admissionText: '#D1FAE5',
  resortsCta: '#93C5FD',
} as const;

export const EXPLORE_HERO = definePalette({
  light: HERO_VALUES,
  dark: HERO_VALUES,
});

/** Fallback destination gradients (artwork — mode-invariant, rule 6). */
const ART_VALUES = {
  parkFallback0: '#280b45',
  parkFallback1: '#5b2a86',
  parkFallback2: '#7e57c2',
  waterFallback0: '#052930',
  waterFallback1: '#00838f',
  waterFallback2: '#17a2b8',
} as const;

// artwork — mode-invariant
export const EXPLORE_ART = definePalette({
  light: ART_VALUES,
  dark: ART_VALUES,
});
