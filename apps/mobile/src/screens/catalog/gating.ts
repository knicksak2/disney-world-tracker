// Feature: experience-live-details, Task 10.1 — client-side category gating
//
// Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5
//
// The detail view surfaces at most one live operational section, chosen
// solely by the Experience's `ExperienceCategory` (R7.5):
//   - Ride / Character_Meet → the wait time and operating status section (R7.2)
//   - Show / Parade         → the showtime section (R7.3)
//   - Restaurant            → the dining section (R7.4)
//   - Other                 → no live section (R7.1)
//
// This is a pure, total function over the `ExperienceCategory` union: every
// category maps to exactly one `LiveSection`, so the screen never renders
// more than one live section and never has to guess for an unmapped value.

import type { ExperienceCategory } from '@dwt/shared';

/**
 * The single live operational section a category may present, or `'none'`
 * when the category shows no live section at all. The screen renders the
 * one section named here and suppresses the others (R7.1–R7.5).
 */
export type LiveSection = 'wait_status' | 'showtimes' | 'dining' | 'none';

/**
 * What the loaded Live_Detail actually carries, which the gate consults for the
 * fallback cases in R5.1–R5.3.
 *
 * When no Live_Detail has loaded, callers pass `NO_LIVE_SHAPE` (both flags
 * false) rather than omitting the argument: a caller that forgot to pass the
 * shape would otherwise silently revert to category-only gating and re-introduce
 * the empty-panel bug this parameter exists to fix, so the argument is required
 * and the compiler enforces it at every call site.
 */
export interface LiveShape {
  readonly hasStandbyWait: boolean;
  readonly hasShowtimes: boolean;
}

/** "Nothing loaded yet" shape; yields the same sections as category-only gating. */
export const NO_LIVE_SHAPE: LiveShape = {
  hasStandbyWait: false,
  hasShowtimes: false,
};

/**
 * Map an `ExperienceCategory` plus the loaded `LiveShape` to the at-most-one
 * `LiveSection` it presents.
 *
 * Total over the `ExperienceCategory` union — every member resolves to a
 * single section (Requirements 5.1–5.5).
 */
export function liveSectionFor(
  category: ExperienceCategory,
  live: LiveShape,
): LiveSection {
  switch (category) {
    case 'Ride':
    case 'Character_Meet':
      return 'wait_status'; // R7.2 / R5.1
    case 'Walkthrough':
    case 'PlayArea':
    case 'Game':
      return live.hasStandbyWait ? 'wait_status' : 'none'; // R5.1, R5.2
    case 'Show':
    case 'Parade':
      if (!live.hasShowtimes && live.hasStandbyWait) {
        return 'wait_status'; // R5.3: show with no showtimes but standby wait presents wait section
      }
      return 'showtimes'; // R7.3
    case 'Restaurant':
      return 'dining'; // R7.4
    case 'Tour':
    case 'Recreation':
    case 'Spa':
    case 'Event':
    case 'Other':
    case 'Resort':
      return 'none'; // R7.1 / R5.5 — no live operational section for structural categories
    default: {
      const _exhaustive: never = category;
      return _exhaustive;
    }
  }
}
