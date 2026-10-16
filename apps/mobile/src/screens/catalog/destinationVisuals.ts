/**
 * Destination visual metadata: theme gradients and iconography. (Per-destination
 * accent hues come from the active theme's `parkAccent` / `color.primaryFg`.)
 *
 * Provides pure, 100% offline-resilient, on-brand visual identities for all Walt
 * Disney World theme parks, water parks, Disney Springs, and Resorts. Replaces
 * generic remote placeholder images with rich multi-stop gradients and landmark
 * iconography matching the app's "Magical / Whimsical" design system.
 */

import type { Ionicons } from '@expo/vector-icons';
import type { DestinationId } from './destinations';

export interface DestinationVisualMeta {
  readonly id: DestinationId;
  readonly icon: string;
  readonly landmark: string;
  readonly gradient: readonly [string, string, ...string[]];
  readonly watermarkGlyph: keyof typeof Ionicons.glyphMap;
  readonly subtitle?: string;
}

export const DESTINATION_VISUALS: Record<DestinationId, DestinationVisualMeta> = {
  'Magic Kingdom': {
    id: 'Magic Kingdom',
    icon: '🏰',
    landmark: 'Cinderella Castle',
    gradient: ['#280b45', '#5b2a86', '#7e57c2'],
    watermarkGlyph: 'sparkles',
  },
  EPCOT: {
    id: 'EPCOT',
    icon: '🌐',
    landmark: 'Spaceship Earth',
    gradient: ['#09234e', '#1565c0', '#2f80ed'],
    watermarkGlyph: 'earth',
  },
  'Hollywood Studios': {
    id: 'Hollywood Studios',
    icon: '🎬',
    landmark: 'Tower of Terror',
    gradient: ['#4a0a0f', '#b71c1c', '#e8505b'],
    watermarkGlyph: 'film',
  },
  'Animal Kingdom': {
    id: 'Animal Kingdom',
    icon: '🌳',
    landmark: 'Tree of Life',
    gradient: ['#0b2910', '#1b5e20', '#3fa34d'],
    watermarkGlyph: 'leaf',
  },
  'Typhoon Lagoon': {
    id: 'Typhoon Lagoon',
    icon: '🏄‍♂️',
    landmark: 'Surf Pool & Mount Mayday',
    gradient: ['#052930', '#00838f', '#17a2b8'],
    watermarkGlyph: 'water',
  },
  'Blizzard Beach': {
    id: 'Blizzard Beach',
    icon: '❄️',
    landmark: 'Mount Gushmore',
    gradient: ['#08223a', '#0277bd', '#4dabf7'],
    watermarkGlyph: 'snow',
  },
  'Disney Springs': {
    id: 'Disney Springs',
    icon: '🛍️',
    landmark: 'Waterfront Dining, Shopping & Entertainment',
    gradient: ['#3e1a02', '#d97706', '#f6a609'],
    watermarkGlyph: 'storefront',
    subtitle: 'Waterfront Dining, Shopping & Entertainment',
  },
  Resorts: {
    id: 'Resorts',
    icon: '🏨',
    landmark: '32 On-Property Themed Resorts, Dining & Pools',
    gradient: ['#1d0a2d', '#4a154b', '#7b1fa2'],
    watermarkGlyph: 'bed',
    subtitle: '32 On-Property Themed Resorts, Dining & Pools',
  },
};
