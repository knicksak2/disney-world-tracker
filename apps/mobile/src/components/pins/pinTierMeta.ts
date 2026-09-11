/**
 * Display metadata for pin tiers and tracks: human labels and an accent colour per tier (drawn
 * from each tier's mid metal tone) for pills, badges, and headers. Kept separate from the render
 * model so screens can label and colour the board without importing the SVG renderer.
 */
import type { PinTier, PinTrack } from '@dwt/shared';

export const TIER_LABEL: Record<PinTier, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  amethyst: 'Amethyst',
  pearl: 'Pearl',
  prism: 'Prism',
  mythic: 'Mythic',
};

/** Accent colour per tier — the mid tone of that tier's metal ramp. */
export const TIER_COLOR: Record<PinTier, string> = {
  bronze: '#c97f4a',
  silver: '#b0b9c8',
  gold: '#e5ab2c',
  amethyst: '#8a45c9',
  pearl: '#c2bcdd',
  prism: '#c9a8ff',
  mythic: '#ffb347',
};

export const TRACK_LABEL: Record<PinTrack, string> = {
  attractions: 'Attractions',
  dining: 'Dining',
  places: 'Places',
  social: 'Social',
  resorts: 'Resorts',
  characters: 'Characters',
  touring: 'Touring',
  thematic: 'Thematic',
};
