// Feature: dark-mode — co-located light/dark literal pairs for RestaurantDishLogCard.tsx.
import { DARK_TONAL, definePalette } from '../../theme/theme';

/**
 * The warm "keepsake" card. Every literal is rule 3: family from the HSL hue
 * (amber / orange / violet), dark value from the role at its site.
 */
export const DISH_CARD = definePalette({
  light: {
    // Card fill (amber S), outline (amber B), non-black shadow (rule 0).
    cardBg: '#fffdfa',
    cardBorder: '#f3e5b8',
    cardShadow: '#d4a017',
    // Header / subtitle / note text (orange T).
    title: '#78350f',
    subtitle: '#78350f',
    noteText: '#78350f',
    // "Log a Dish" solid button behind white text (orange F).
    logBtnBg: '#d97706',
    // Empty-state text (orange T).
    emptyText: '#92400e',
    // Dish row outline (amber B).
    dishBorder: '#fde68a',
    // Dish name (orange T).
    dishName: '#451a03',
    // Rating pill: amber tint (S), orange star / number (T).
    ratingBg: '#fef3c7',
    ratingStar: '#d97706',
    ratingText: '#d97706',
    // Note callout fill (amber S).
    noteBg: '#fffdf8',
    // "Logged …" meta line (amber T).
    metaText: '#a16207',
    // "View Food Logs" button: amber tint (S), orange outline (B), orange text (T).
    viewLogsBg: '#fff8eb',
    viewLogsBorder: '#d97706',
    viewLogsText: '#92400e',
    // "Add to Food List" outline (violet B).
    addToListBorder: '#dcd1ed',
  },
  dark: {
    cardBg: DARK_TONAL.amber.tint,
    cardBorder: DARK_TONAL.amber.border,
    cardShadow: '#000000',
    title: DARK_TONAL.orange.fg,
    subtitle: DARK_TONAL.orange.fg,
    noteText: DARK_TONAL.orange.fg,
    logBtnBg: DARK_TONAL.orange.fill,
    emptyText: DARK_TONAL.orange.fg,
    dishBorder: DARK_TONAL.amber.border,
    dishName: DARK_TONAL.orange.fg,
    ratingBg: DARK_TONAL.amber.tint,
    ratingStar: DARK_TONAL.orange.fg,
    ratingText: DARK_TONAL.orange.fg,
    noteBg: DARK_TONAL.amber.tint,
    metaText: DARK_TONAL.amber.fg,
    viewLogsBg: DARK_TONAL.amber.tint,
    viewLogsBorder: DARK_TONAL.orange.border,
    viewLogsText: DARK_TONAL.orange.fg,
    addToListBorder: DARK_TONAL.violet.border,
  },
});
