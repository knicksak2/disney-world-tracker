// Feature: dark-mode — pin tier colours used as UI text (conversion rule 7).
//
// `TIER_COLOR` is pin artwork and stays unchanged. Where a tier colour is
// text or an icon (a Badge colour, a Text colour, an Ionicons colour), the
// dark amethyst and bronze fail 4.5:1, so those reads use this pair instead.
// Tier dots, progress fills and swatches keep `TIER_COLOR`.

import { TIER_COLOR } from '../../components/pins/pinTierMeta';
import { definePalette } from '../../theme/theme';

export const TIER_TEXT = definePalette({
  light: TIER_COLOR,
  dark: { ...TIER_COLOR, amethyst: '#c08ff5', bronze: '#e0965f' },
});
