/**
 * Shared constants for first-run onboarding & starter checklist
 * (`.kiro/specs/first-run-onboarding`).
 */

export const ONBOARDING_INTENTS = [
  'plan',
  'in_park',
  'track_history',
  'explore',
] as const;

export const ONBOARDING_PARKS = [
  'Magic Kingdom',
  'EPCOT',
  'Hollywood Studios',
  'Animal Kingdom',
] as const;

export const QUICK_COMPLETIONS_MIN = 1;
export const QUICK_COMPLETIONS_MAX = 20;
