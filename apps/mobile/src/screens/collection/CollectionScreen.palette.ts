// Feature: dark-mode — co-located light/dark literal pairs for CollectionScreen.tsx.

import { DARK_TONAL, darkColor, definePalette } from '../../theme/theme';

export const COLLECTION = definePalette({
  light: {
    // Park coverage bars: park name text + bar mark (T). Magic Kingdom uses `parkAccent`.
    parkEpcot: '#0288d1',
    parkHollywood: '#e53935',
    parkAnimal: '#2e7d32',
    // Food sub-view — orange family.
    treatIcon: '#e65100',
    treatRatingBadge: '#e65100',
    iconicProgressFill: '#e65100',
    iconicCounterText: '#e65100',
    treatIconCircleBg: '#fff3e0',
    // Food sub-view — green family (tasted).
    triedIcon: '#2e7d32',
    triedNameText: '#2e7d32',
    triedBadgeBg: '#e8f5e9',
    triedBadgeText: '#2e7d32',
    // Stats milestones: icon well (S) + icon (T).
    milestoneRideBg: '#ede7f6',
    milestoneRideIcon: '#673ab7',
    milestoneShowBg: '#e1f5fe',
    milestoneShowIcon: '#0288d1',
    milestoneDiningBg: '#fff3e0',
    milestoneDiningIcon: '#e65100',
    milestoneResortBg: '#e8f5e9',
    milestoneResortIcon: '#2e7d32',
    // Stats CTA: green fill behind white text (F).
    statsCtaBg: '#2e7d32',
    // Four-way segmented control track (S, violet) and inactive label (T, neutral).
    segTrackBg: '#ebe8f0',
    segText: '#4b5563',
    // Active segment fill (today's `t.color.surface` in light).
    segActiveBg: '#ffffff',
    // Claimable-count bubble on the Pins segment (F, white text).
    segBadgeBg: '#e65100',
    // Claim banner (amber S / B, orange T, orange F).
    claimBannerBg: '#fffbeb',
    claimBannerBorder: '#fde68a',
    claimBannerShadow: '#d97706',
    claimTitle: '#92400e',
    claimSub: '#b45309',
    claimBtnBg: '#d97706',
    // Pin directory tiles.
    tierLockedBg: '#f5f5f7',
    tierTotalBg: '#ede7f6',
    tierTotalBorder: '#d1c4e9',
    // Badges-in-reach progress track (B, neutral).
    inReachTrack: '#e0e0e0',
  },
  dark: {
    parkEpcot: DARK_TONAL.sky.fg,
    parkHollywood: DARK_TONAL.red.fg,
    parkAnimal: DARK_TONAL.green.fg,
    treatIcon: DARK_TONAL.orange.fg,
    treatRatingBadge: DARK_TONAL.orange.fg,
    iconicProgressFill: DARK_TONAL.orange.fg,
    iconicCounterText: DARK_TONAL.orange.fg,
    treatIconCircleBg: DARK_TONAL.amber.tint,
    triedIcon: DARK_TONAL.green.fg,
    triedNameText: DARK_TONAL.green.fg,
    triedBadgeBg: DARK_TONAL.green.tint,
    triedBadgeText: DARK_TONAL.green.fg,
    milestoneRideBg: DARK_TONAL.violet.tint,
    milestoneRideIcon: DARK_TONAL.violet.fg,
    milestoneShowBg: DARK_TONAL.sky.tint,
    milestoneShowIcon: DARK_TONAL.sky.fg,
    milestoneDiningBg: DARK_TONAL.amber.tint,
    milestoneDiningIcon: DARK_TONAL.orange.fg,
    milestoneResortBg: DARK_TONAL.green.tint,
    milestoneResortIcon: DARK_TONAL.green.fg,
    statsCtaBg: DARK_TONAL.green.fill,
    segTrackBg: DARK_TONAL.violet.tint,
    // Idle label reads quieter than the active primaryFg label (Requirement 9.12).
    segText: darkColor.textSecondary,
    // Active segment is lighter than the violet.tint track, so it reads raised
    // rather than as a darker hole (Requirement 9.12; same ruling as the Expenses tabs).
    segActiveBg: darkColor.borderStrong,
    segBadgeBg: DARK_TONAL.orange.fill,
    claimBannerBg: DARK_TONAL.amber.tint,
    claimBannerBorder: DARK_TONAL.amber.border,
    claimBannerShadow: '#000000',
    claimTitle: DARK_TONAL.orange.fg,
    claimSub: DARK_TONAL.orange.fg,
    claimBtnBg: DARK_TONAL.orange.fill,
    tierLockedBg: darkColor.surfaceAlt,
    tierTotalBg: DARK_TONAL.violet.tint,
    tierTotalBorder: DARK_TONAL.violet.border,
    inReachTrack: darkColor.borderStrong,
  },
});

// artwork — mode-invariant: the wooden corkboard frame around the pin canvas.
export const CORKBOARD = definePalette({
  light: {
    frameBg: '#3e2723',
    frameBorder: '#5d4037',
    headerBg: '#2e1c14',
    headerBorder: '#4a3224',
    title: '#fde68a',
    customizeBorder: 'rgba(253, 230, 138, 0.4)',
    customizeText: '#fef3c7',
    boardBg: '#c8a27a',
  },
  dark: {
    frameBg: '#3e2723',
    frameBorder: '#5d4037',
    headerBg: '#2e1c14',
    headerBorder: '#4a3224',
    title: '#fde68a',
    customizeBorder: 'rgba(253, 230, 138, 0.4)',
    customizeText: '#fef3c7',
    boardBg: '#c8a27a',
  },
});

/** Non-black corkboard frame shadow (rule 0). */
export const CORKBOARD_SHADOW = definePalette({
  light: { frame: '#1a0c02' },
  dark: { frame: '#000000' },
});
