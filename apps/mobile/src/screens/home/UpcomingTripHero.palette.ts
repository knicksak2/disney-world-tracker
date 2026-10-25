// Feature: dark-mode — co-located light/dark literal pairs for UpcomingTripHero.tsx.

import { DARK_TONAL, definePalette } from '../../theme/theme';

export const UPCOMING_TRIP_HERO = definePalette({
  light: {
    // Card border (B, violet).
    cardBorder: '#ebdff8',
    // Non-black shadow (rule 0).
    cardShadow: '#5b2a86',
    // Countdown tile: H-role violet, already dark in light mode (mode-invariant).
    countdownBg: '#3b1d60',
    countdownSub: 'rgba(255, 255, 255, 0.9)',
    divider: '#f3e8ff',
    milestoneBg: '#faf5ff',
    milestoneBorder: '#e9d5ff',
    milestoneText: '#581c87',
    milestoneSub: '#7e22ce',
    milestoneOpenBg: '#fef3c7',
    milestoneOpenBorder: '#fde68a',
    milestoneOpenText: '#92400e',
    crewAvatarBorder: '#ffffff',
    crewAvatarMoreBg: '#f3e8ff',
    crewAvatarMoreText: '#6b21a8',
    crewText: '#4b5563',
    crewLink: '#7c3aed',
    avatarBg0: '#7c3aed',
    avatarBg1: '#db2777',
    avatarBg2: '#2563eb',
    avatarBg3: '#059669',
  },
  dark: {
    cardBorder: DARK_TONAL.violet.border,
    cardShadow: '#000000',
    countdownBg: '#3b1d60',
    countdownSub: 'rgba(255, 255, 255, 0.9)',
    divider: '#2e1c45',
    milestoneBg: '#231238',
    milestoneBorder: '#4c1d95',
    milestoneText: '#f3e8ff',
    milestoneSub: '#d8b4fe',
    milestoneOpenBg: '#382205',
    milestoneOpenBorder: '#78350f',
    milestoneOpenText: '#fef3c7',
    crewAvatarBorder: '#1e1b2e',
    crewAvatarMoreBg: '#3b1d60',
    crewAvatarMoreText: '#e9d5ff',
    crewText: '#9ca3af',
    crewLink: '#c084fc',
    avatarBg0: '#8b5cf6',
    avatarBg1: '#ec4899',
    avatarBg2: '#3b82f6',
    avatarBg3: '#10b981',
  },
});
