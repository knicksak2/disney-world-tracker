// Feature: dark-mode — co-located light/dark literal pairs for CrowdCalendarScreen.tsx.
import { DARK_TONAL, definePalette } from '../../theme/theme';

/**
 * Crowd-level scale (rule 3 role V: a data-encoding scale, mode-invariant).
 * The day-cell / badge text on it is white in both schemes, so its contrast
 * is identical to light. Level "Moderate" is the `accent` token (rule 1).
 */
export const CROWD_LEVEL = definePalette({
  light: {
    quiet: '#3fa34d',
    belowAverage: '#8bbf3f',
    high: '#e8792b',
    peak: '#d64545',
  },
  dark: {
    quiet: '#3fa34d',
    belowAverage: '#8bbf3f',
    high: '#e8792b',
    peak: '#d64545',
  },
});

/** Day-detail event `Badge` colours (badge text, rule 3 T). */
export const EVENT_BADGE = definePalette({
  light: {
    earlyEntry: '#2e7d3a',
    extendedEvening: '#6a1b9a',
    ticketedEvent: '#d84315',
  },
  dark: {
    earlyEntry: DARK_TONAL.green.fg,
    extendedEvening: DARK_TONAL.violet.fg,
    ticketedEvent: DARK_TONAL.red.fg,
  },
});
