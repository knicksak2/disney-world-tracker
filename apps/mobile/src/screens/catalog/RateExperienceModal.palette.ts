// Feature: dark-mode — co-located light/dark literal pairs for RateExperienceModal.tsx.
import { DARK_TONAL, darkColor, definePalette } from '../../theme/theme';

/** Dialog literals, converted by rule 3 (family from HSL hue, role per site). */
export const RATE_DIALOG = definePalette({
  light: {
    // Backdrop scrim — near-black violet (L 0.004), role H: mode-invariant.
    scrim: 'rgba(20, 8, 36, 0.65)',
    // Dialog outline (violet B).
    dialogBorder: 'rgba(230, 222, 242, 0.95)',
    // Non-black shadows (rule 0).
    dialogShadow: '#5b2a86',
    tileActiveShadow: '#5b2a86',
    saveShadow: '#5b2a86',
    // Header star badge: amber icon (T), tint (S), outline (B).
    starIcon: '#e5a100',
    starCircleBg: '#fff8e6',
    starCircleBorder: '#fce299',
    // Title (violet T).
    title: '#371756',
    // Score callout: violet tint (S) and outline (B).
    calloutBg: '#faf8fd',
    calloutBorder: '#ede5f7',
    // Score "/ 10" and prompt text (neutral T, L >= 0.12).
    scoreTen: '#8b7aa3',
    scorePrompt: '#7b6899',
    // Score description (violet T).
    scoreDescription: '#655082',
    // Idle rating tile: lavender-subtle fill (neutral S), violet outline (B),
    // neutral star icon (T) and violet number (T).
    tileBg: '#fbf9fe',
    tileBorder: '#e2d7f2',
    tileStar: '#7b6899',
    tileText: '#49236d',
    // Remove button: red tint (S), outline (B), text (T).
    removeBg: '#fff0f3',
    removeBorder: '#ffd0da',
    removeText: '#d32f2f',
  },
  dark: {
    scrim: 'rgba(20, 8, 36, 0.65)',
    dialogBorder: DARK_TONAL.violet.border,
    dialogShadow: '#000000',
    tileActiveShadow: '#000000',
    saveShadow: '#000000',
    starIcon: DARK_TONAL.amber.fg,
    starCircleBg: DARK_TONAL.amber.tint,
    starCircleBorder: DARK_TONAL.amber.border,
    title: DARK_TONAL.violet.fg,
    calloutBg: DARK_TONAL.violet.tint,
    calloutBorder: DARK_TONAL.violet.border,
    scoreTen: darkColor.textSecondary,
    scorePrompt: darkColor.textSecondary,
    scoreDescription: DARK_TONAL.violet.fg,
    tileBg: darkColor.surfaceAlt,
    tileBorder: DARK_TONAL.violet.border,
    tileStar: darkColor.textSecondary,
    tileText: DARK_TONAL.violet.fg,
    removeBg: DARK_TONAL.red.tint,
    removeBorder: DARK_TONAL.red.border,
    removeText: DARK_TONAL.red.fg,
  },
});
