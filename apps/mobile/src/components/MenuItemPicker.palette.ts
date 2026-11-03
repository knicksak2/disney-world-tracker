// Feature: trip-budget — co-located light/dark literal pairs for MenuItemPicker.tsx.

import { definePalette } from '../theme/theme';

export const MENU_ITEM_PICKER = definePalette({
  light: {
    bg: '#ffffff',
    sectionHeaderBg: '#f5f2fb',
    sectionHeaderText: '#1f1235',
    itemBorder: '#e2d9f0',
    selectedBg: '#efe9f7',
    tierBg: '#fff4d6',
    tierBorder: '#fcd34d',
    tierText: '#8a5a00',
    alcoholTagBg: '#fce7f3',
    alcoholTagText: '#be185d',
    noteText: '#6b6480',
    variantActiveBg: '#5b2a86',
    variantActiveText: '#ffffff',
    variantInactiveBg: '#efe9f7',
    variantInactiveText: '#1f1235',
  },
  dark: {
    bg: '#1e1430',
    sectionHeaderBg: '#2a1d42',
    sectionHeaderText: '#f3eefc',
    itemBorder: '#33264d',
    selectedBg: '#3d1c5c',
    tierBg: '#3a2c0e',
    tierBorder: '#785412',
    tierText: '#ffd27a',
    alcoholTagBg: '#500724',
    alcoholTagText: '#f472b6',
    noteText: '#b3a8c9',
    variantActiveBg: '#7e57c2',
    variantActiveText: '#ffffff',
    variantInactiveBg: '#2a1d42',
    variantInactiveText: '#f3eefc',
  },
});

