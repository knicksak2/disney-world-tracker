/**
 * PIN_CREDITS — the in-app "Art credits" attribution lines shown on `AttributionScreen` (R6.1).
 *
 * These are the attribution obligations for the motif libraries the pin artwork draws on. CC BY
 * requires naming the author (not just the library), so each author is listed. The list is a
 * verbatim copy of the "Attribution required in-app" block in
 * `.kiro/specs/pin-collection/motifs/CREDITS.md`; `creditsGate.test.ts` asserts this array stays
 * exactly in sync with that file, so the in-app credits can never drift from the audit trail.
 */
export const PIN_CREDITS: readonly string[] = [
  'Icons by Lorc, Delapouite, Skoll and Cathelineau — game-icons.net — CC BY 3.0',
  'Icon by Atisa — Boxicons — CC BY 4.0',
  'Icon by JoyPixels / EmojiOne — emojione.com — CC BY 4.0',
  'Icon by Font Awesome — fontawesome.com — CC BY 4.0',
  'Icons from Temaki by Bryan Housel & OpenStreetMap contributors — CC0 1.0',
  'Icons by Google — Material Symbols — Apache 2.0',
  'Emoji by Twitter — Twemoji — CC BY 4.0',
  'Icon by Kenan Gündoğan — Fontisto — MIT',
];
