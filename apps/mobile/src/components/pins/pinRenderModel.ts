/**
 * Pure render model for the collectible pin renderer.
 *
 * These are the locked art-direction constants (verbatim from
 * `.kiro/specs/pin-collection/pin-frame-sample.html`) plus the pure functions that turn a
 * pin's tier / mode / ladder rung into concrete render parameters — rim width, metal gradient
 * stops, enamel colour, and the intra-tier ornament complexity. `PinView` draws from what this
 * returns, and the property tests assert its invariants directly (Properties 5, 6, 10), so the
 * visual rules live in one dependency-free, testable place rather than inline in the component.
 */
import type { PinTier } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

/** The six graded metal-ramp tiers, ascending by rarity. Mythic is NOT here — it is a
 *  1-of-1 capstone rendered with a bespoke treatment, not another ramp rung. */
export const RAMP_TIERS: readonly PinTier[] = [
  'bronze',
  'silver',
  'gold',
  'amethyst',
  'pearl',
  'prism',
];

/** All seven tiers, capstone last. */
export const ALL_TIERS: readonly PinTier[] = [...RAMP_TIERS, 'mythic'];

/** The 1-of-1 capstone tier above prism. */
export const CAPSTONE_TIER: PinTier = 'mythic';

export function isCapstone(tier: PinTier): boolean {
  return tier === CAPSTONE_TIER;
}

// ---------------------------------------------------------------------------
// Metal ramps — multi-stop gradients, light → deep (verbatim)
// ---------------------------------------------------------------------------

/** `dead` is the locked/darkened ramp used when a pin is not yet unlocked. */
export const METALS: Record<PinTier | 'dead', readonly string[]> = {
  dead: ['#5c5366', '#443d4d', '#2e2838', '#1b1724'],
  bronze: ['#eec4a0', '#c97f4a', '#9a5526', '#5e2f10'],
  silver: ['#ffffff', '#e2e8f0', '#b0b9c8', '#727b8b'],
  gold: ['#fff8db', '#f8db79', '#e5ab2c', '#8c620f'],
  amethyst: ['#f7e4ff', '#cba2f0', '#8a45c9', '#41185f'],
  // pearl's lightest stop is deliberately NOT #ffffff — sharing a top stop with silver made
  // the two tiers ambiguous at the highlight.
  pearl: ['#fff6fb', '#f0e4fa', '#dcecf6', '#c2bcdd', '#9d95bd'],
  // prism: seven hues for the full spectrum sweep.
  prism: ['#fff0c4', '#ffc2e8', '#c9a8ff', '#8ed8ff', '#a8f0c8', '#ffe07a', '#b06fd8'],
  // mythic: bespoke 1-of-1 Aurora-Gold capstone, confirmed distinct from all six ramps.
  mythic: ['#fff6e0', '#ffb347', '#ff8fbf', '#c99cff', '#5fd6a8', '#ffcf4a', '#e08a1e'],
};

// ---------------------------------------------------------------------------
// Rim widths — grow with rarity (verbatim)
// ---------------------------------------------------------------------------

export const RIM_BY_TIER: Record<PinTier, number> = {
  bronze: 4.2,
  silver: 5.2,
  gold: 6.2,
  amethyst: 7.2,
  pearl: 8.2,
  prism: 9.2,
  mythic: 10.4,
};

// ---------------------------------------------------------------------------
// Royal enamel palette (verbatim)
// ---------------------------------------------------------------------------

export const PALETTES = {
  royal: {
    royal: '#4a2a7a',
    plum: '#6a3fb0',
    teal: '#14727f',
    forest: '#2f7d3e',
    crimson: '#a8323f',
    amber: '#b5721a',
    sky: '#2f6bb0',
    ink: '#241a3a',
  },
} as const;

/** The enamel a locked pin's recessed well is filled with (darkened). */
export const LOCKED_ENAMEL = '#2b2536';

/** Default enamel for a tier when a pin does not specify its own. */
export function tierEnamel(t: PinTier): string {
  return t === 'bronze' || t === 'silver' || t === 'gold'
    ? PALETTES.royal.royal
    : PALETTES.royal.ink;
}

/** Resolve a named Royal palette key (e.g. `'teal'`) to its hex, or pass a hex through. */
export function resolveEnamel(value: string): string {
  const royal = PALETTES.royal as Record<string, string>;
  return royal[value] ?? value;
}

// ---------------------------------------------------------------------------
// Skies (for ladder / scene wells)
// ---------------------------------------------------------------------------

export const SKIES: Record<'day' | 'dusk' | 'night', readonly [string, string]> = {
  day: ['#8fc4f0', '#dfeaf7'],
  dusk: ['#3f2f78', '#c47a8e'],
  night: ['#1b1a4a', '#4b3f8f'],
};

// ---------------------------------------------------------------------------
// Rim resolution
// ---------------------------------------------------------------------------

/**
 * The rim width a pin renders at. A pin may pin an explicit `rim` override (e.g. the
 * fairy-wand halo ships a thicker 8px rim to bridge a sparkle gap); otherwise it is the
 * locked `RIM_BY_TIER` value for the tier.
 */
export function rimFor(tier: PinTier, override?: number): number {
  if (typeof override === 'number' && Number.isFinite(override)) return override;
  return RIM_BY_TIER[tier];
}

/** The metal ramp a pin renders with: the darkened `dead` ramp when locked, else the tier's. */
export function metalRamp(tier: PinTier, locked: boolean): readonly string[] {
  return locked ? METALS.dead : METALS[tier];
}

// ---------------------------------------------------------------------------
// Intra-tier ladder ornament progression (Property 5)
// ---------------------------------------------------------------------------

/**
 * The parametric ornament complexity of a ladder rung. Every field scales monotonically with
 * the rung's position so an ascending ladder is visibly, incrementally richer (Requirement 4.4,
 * Property 5): more rays, more spark satellites, a denser inner bezel, a larger core, and more
 * scattered stars. Ranges are the locked ones from the b4-firework arch renderer.
 */
export interface LadderComplexity {
  readonly rays: number;
  readonly sparks: number;
  readonly bezel: number;
  readonly stars: number;
  readonly coreR: number;
  readonly sparkTipR: number;
}

const LADDER_RANGES = {
  rays: [8, 24],
  sparks: [0, 6],
  bezel: [0, 5],
  stars: [4, 31],
  coreR: [96, 160],
  sparkTipR: [6, 14],
} as const;

/**
 * Compute a rung's ornament complexity. `level` is the rung index (0-based) and `maxLevel` the
 * top rung index (>= 1); both are clamped to `[0, maxLevel]`. Each field is a
 * non-decreasing (floored-linear) function of `level`, so `k1 <= k2 ⇒ every field of
 * complexity(k1) <= complexity(k2)` — the invariant Property 5 asserts.
 */
export function ladderComplexity(level: number, maxLevel: number): LadderComplexity {
  const top = Math.max(1, Math.floor(maxLevel));
  const k = Math.min(top, Math.max(0, Math.floor(level)));
  const at = ([min, max]: readonly [number, number]): number =>
    Math.floor(min + ((max - min) * k) / top);
  return {
    rays: at(LADDER_RANGES.rays),
    sparks: at(LADDER_RANGES.sparks),
    bezel: at(LADDER_RANGES.bezel),
    stars: at(LADDER_RANGES.stars),
    coreR: at(LADDER_RANGES.coreR),
    sparkTipR: at(LADDER_RANGES.sparkTipR),
  };
}

// ---------------------------------------------------------------------------
// Resolved render parameters for a single pin
// ---------------------------------------------------------------------------

export type PinMode = 'contained' | 'diecut';

/** The minimal art recipe the renderer needs, independent of where it is sourced from. */
export interface PinArtRecipe {
  readonly tier: PinTier;
  readonly mode: PinMode;
  /** Enamel: a single colour or one-per-cell array (hex or Royal palette key). */
  readonly enamel?: string | readonly string[];
  /** Explicit rim override in px (rare; e.g. the fairy-wand halo). */
  readonly rim?: number;
  /** Ladder rung index + top rung index, when this pin is a ladder rung. */
  readonly ladderLevel?: number;
  readonly ladderMax?: number;
}

export interface ResolvedPinRender {
  readonly tier: PinTier;
  readonly mode: PinMode;
  readonly locked: boolean;
  /** Metal gradient stops (dead ramp when locked). */
  readonly metal: readonly string[];
  /** Outer rim width in px. */
  readonly rim: number;
  /** Enamel colour(s) poured into the recessed well (locked → darkened). */
  readonly enamel: string | readonly string[];
  /** Ladder ornament complexity, when this pin is a ladder rung. */
  readonly ladder: LadderComplexity | null;
  /** True for the bespoke 1-of-1 capstone treatment. */
  readonly capstone: boolean;
}

/**
 * Resolve a pin's full render parameters from its recipe and unlocked state. Pure: `PinView`
 * renders exactly what this returns and the property tests assert on it.
 */
export function resolvePinRender(
  recipe: PinArtRecipe,
  unlocked: boolean,
): ResolvedPinRender {
  const locked = !unlocked;
  const enamel = locked
    ? LOCKED_ENAMEL
    : recipe.enamel !== undefined
      ? Array.isArray(recipe.enamel)
        ? recipe.enamel.map(resolveEnamel)
        : resolveEnamel(recipe.enamel as string)
      : tierEnamel(recipe.tier);
  const ladder =
    recipe.ladderLevel !== undefined && recipe.ladderMax !== undefined
      ? ladderComplexity(recipe.ladderLevel, recipe.ladderMax)
      : null;
  return {
    tier: recipe.tier,
    mode: recipe.mode,
    locked,
    metal: metalRamp(recipe.tier, locked),
    rim: rimFor(recipe.tier, recipe.rim),
    enamel,
    ladder,
    capstone: isCapstone(recipe.tier),
  };
}

// ---------------------------------------------------------------------------
// Contained-pin plate shapes (verbatim d-strings on a 0..150 canvas)
// ---------------------------------------------------------------------------

export type ShapeKey = 'disc' | 'crest' | 'star' | 'gem' | 'arch' | 'rosette';

export interface ShapeDef {
  /** Outline path on the 150x150 canvas. */
  readonly d: string;
  /** Optional distinct stroke outline (rosette strokes only its disc). */
  readonly strokeD?: string;
  /** Optional explicit inset well path (rosette); else `d` scaled by `inset` about centre. */
  readonly insetD?: string;
  /** Enamel-well inset scale about the shape centre (when `insetD` is absent). */
  readonly inset?: number;
  /** Motif scale factor within the plate. */
  readonly mk: number;
  /** Motif centre. */
  readonly mcx: number;
  readonly mcy: number;
  /** y of the well's lower inner edge, for the `ground` motif anchor. */
  readonly groundY: number;
  /** Banner baseline y (null → this shape carries no banner). */
  readonly bannerY: number | null;
  readonly bannerW?: number;
}

export const SHAPES: Record<ShapeKey, ShapeDef> = {
  disc: {
    d: 'M9 75 A66 66 0 1 0 141 75 A66 66 0 1 0 9 75 Z',
    inset: 0.86,
    mk: 1.0,
    mcx: 75,
    mcy: 75,
    groundY: 128,
    bannerY: 116,
    bannerW: 74,
  },
  crest: {
    d: 'M19 17 H131 V71 C131 107 108 131 75 143 C42 131 19 107 19 71 Z',
    inset: 0.87,
    mk: 0.88,
    mcx: 75,
    mcy: 72,
    groundY: 130,
    bannerY: 114,
    bannerW: 74,
  },
  star: {
    d: 'M75 7 L92.1 51.5 L139.7 54 L102.6 84 L115 130 L75 104 L35 130 L47.4 84 L10.3 54 L57.9 51.5 Z',
    inset: 0.78,
    mk: 0.66,
    mcx: 75,
    mcy: 78,
    groundY: 98,
    bannerY: null,
  },
  gem: {
    d: 'M75 7 L127 38 L127 104 L75 143 L23 104 L23 38 Z',
    inset: 0.83,
    mk: 0.8,
    mcx: 75,
    mcy: 75,
    groundY: 124,
    bannerY: 110,
    bannerW: 64,
  },
  arch: {
    d: 'M75 6 C104 6 128 30 128 59 V126 A10 10 0 0 1 118 136 H32 A10 10 0 0 1 22 126 V59 C22 30 46 6 75 6 Z',
    inset: 0.87,
    mk: 0.84,
    mcx: 75,
    mcy: 72,
    groundY: 127,
    bannerY: 117,
    bannerW: 78,
  },
  rosette: {
    d: 'M56 99 L70 99 L67 143 L61 132 L55 143 Z M94 99 L80 99 L83 143 L89 132 L95 143 Z M75 10 A52 52 0 1 0 75 114 A52 52 0 1 0 75 10 Z',
    insetD: 'M75 21 A41 41 0 1 0 75 103 A41 41 0 1 0 75 21 Z',
    mk: 0.62,
    mcx: 75,
    mcy: 62,
    groundY: 100,
    bannerY: 95,
    bannerW: 66,
  },
};
