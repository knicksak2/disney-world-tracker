// Feature: dark-mode — co-located light/dark literal pairs for VirtualQueueBanner.tsx.
import { DARK_TONAL, definePalette } from '../../theme/theme';

/** Virtual-queue banner (sky / blue families, rule 3). */
export const VQ = definePalette({
  light: {
    containerBg: '#eff6ff', // S sky
    containerBorder: '#bfdbfe', // B sky
    icon: '#1d4ed8', // T blue
    titleText: '#1e40af', // T blue
    rangeBg: '#dbeafe', // S sky
    rangeText: '#1d4ed8', // T blue
  },
  dark: {
    containerBg: DARK_TONAL.sky.tint,
    containerBorder: DARK_TONAL.sky.border,
    icon: DARK_TONAL.blue.fg,
    titleText: DARK_TONAL.blue.fg,
    rangeBg: DARK_TONAL.sky.tint,
    rangeText: DARK_TONAL.blue.fg,
  },
});
