// Feature: trip-budget — co-located light/dark literal pairs for PriceBadge.tsx.

import { definePalette } from '../theme/theme';

export const PRICE_BADGE = definePalette({
  light: {
    bg: '#f5f2fb',
    border: '#e2d9f0',
    text: '#1f1235',
    estimateBg: '#fff4d6',
    estimateBorder: '#fcd34d',
    estimateText: '#8a5a00',
    attributionText: '#6b6480',
    linkText: '#5b2a86',
  },
  dark: {
    bg: '#2a1d42',
    border: '#33264d',
    text: '#f3eefc',
    estimateBg: '#3a2c0e',
    estimateBorder: '#785412',
    estimateText: '#ffd27a',
    attributionText: '#b3a8c9',
    linkText: '#c4a3ff',
  },
});

