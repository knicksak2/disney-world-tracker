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
 * Map an `ExperienceCategory` to the at-most-one `LiveSection` it presents.
 *
 * Total over the `ExperienceCategory` union — every member resolves to a
 * single section, satisfying "at most one live operational section,
 * determined solely by the Experience's Experience_Category" (R7.5).
 */
export function liveSectionFor(category: ExperienceCategory): LiveSection {
  switch (category) {
    case 'Ride':
    case 'Character_Meet':
      return 'wait_status'; // R7.2
    case 'Show':
    case 'Parade':
      return 'showtimes'; // R7.3
    case 'Restaurant':
      return 'dining'; // R7.4
    case 'Tour':
    case 'Recreation':
    case 'Spa':
    case 'Event':
    case 'Other':
    case 'Resort':
      return 'none'; // R7.1 — no live operational section for these categories
      // (a resort-representing stand-in has no live wait/showtime/dining data)
    default: {
      // Exhaustiveness guard: if a new category is added to the shared
      // union, this assignment fails to compile, flagging that the gating
      // map must be updated rather than silently defaulting.
      const _exhaustive: never = category;
      return _exhaustive;
    }
  }
}
