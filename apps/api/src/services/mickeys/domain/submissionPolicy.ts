import {
  MICKEY_ZONES,
  MICKEY_DIFFICULTIES,
  MICKEY_CLUE1_MIN,
  MICKEY_CLUE1_MAX,
  MICKEY_CLUE2_MIN,
  MICKEY_CLUE2_MAX,
  MICKEY_REVEAL_MIN,
  MICKEY_REVEAL_MAX,
  type MickeyZone,
  type MickeyDifficulty,
} from '@dwt/shared';

// Common TLDs for bare domain matching (case-insensitive)
const COMMON_TLDS =
  'com|org|net|edu|gov|mil|io|co|app|dev|me|info|biz|us|uk|ca|de|jp|fr|au|nz|ch|nl|se|no|es|it';

const URL_SCHEME_REGEX = /\bhttps?:\/\/[^\s]+/i;
const WWW_REGEX = /\bwww\.[^\s]+/i;
const BARE_DOMAIN_REGEX = new RegExp(
  `\\b[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\\.(?:${COMMON_TLDS})\\b(?:/[^\\s]*)?`,
  'i',
);
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;

/**
 * Checks if a string contains any URL (http(s)://, www., bare domain/path)
 * or email address per Requirement 1.7.
 *
 * Clean text containing standalone dots (e.g. "Look 3.5 ft up. There it is.")
 * or standalone "@" (e.g. "Meet @ 2pm") evaluates to false.
 */
export function containsUrlOrEmail(text: string): boolean {
  if (URL_SCHEME_REGEX.test(text)) return true;
  if (WWW_REGEX.test(text)) return true;
  if (BARE_DOMAIN_REGEX.test(text)) return true;
  if (EMAIL_REGEX.test(text)) return true;
  return false;
}

/**
 * Determines initial status per Requirement 6.4 and 6.5.
 * Only 'publish' mode with passing text screen starts as 'approved'.
 * 'review' mode or unscreened fallback starts as 'pending'.
 */
export function initialStatus(
  mode: 'publish' | 'review',
  screen: 'pass' | 'unscreened',
): 'approved' | 'pending' {
  return mode === 'publish' && screen === 'pass' ? 'approved' : 'pending';
}

/**
 * Enforces daily submission cap per Requirement 6.7.
 */
export function checkDailyCap(createdLast24h: number, cap: number): 'ok' | 'limit' {
  return createdLast24h >= cap ? 'limit' : 'ok';
}

export interface SubmissionInput {
  readonly experienceId: string;
  readonly zone: string;
  readonly difficulty: string;
  readonly clue1: string;
  readonly clue2: string;
  readonly reveal: string;
}

export type ValidationResult =
  | { readonly valid: true; readonly zone: MickeyZone; readonly difficulty: MickeyDifficulty }
  | { readonly valid: false; readonly reason: string; readonly code: 'validation_failed' | 'mickey_text_rejected' };

/**
 * Validates submission fields against bounds, closed sets, and URL/email rules (Requirements 1.1, 1.7).
 */
export function validateSubmission(input: SubmissionInput): ValidationResult {
  if (!input.experienceId || typeof input.experienceId !== 'string') {
    return { valid: false, reason: 'experienceId is required', code: 'validation_failed' };
  }

  if (!MICKEY_ZONES.includes(input.zone as MickeyZone)) {
    return { valid: false, reason: `Invalid zone: ${input.zone}`, code: 'validation_failed' };
  }

  if (!MICKEY_DIFFICULTIES.includes(input.difficulty as MickeyDifficulty)) {
    return { valid: false, reason: `Invalid difficulty: ${input.difficulty}`, code: 'validation_failed' };
  }

  const c1Len = input.clue1?.length ?? 0;
  if (c1Len < MICKEY_CLUE1_MIN || c1Len > MICKEY_CLUE1_MAX) {
    return {
      valid: false,
      reason: `clue1 must be between ${MICKEY_CLUE1_MIN} and ${MICKEY_CLUE1_MAX} characters`,
      code: 'validation_failed',
    };
  }

  const c2Len = input.clue2?.length ?? 0;
  if (c2Len < MICKEY_CLUE2_MIN || c2Len > MICKEY_CLUE2_MAX) {
    return {
      valid: false,
      reason: `clue2 must be between ${MICKEY_CLUE2_MIN} and ${MICKEY_CLUE2_MAX} characters`,
      code: 'validation_failed',
    };
  }

  const revLen = input.reveal?.length ?? 0;
  if (revLen < MICKEY_REVEAL_MIN || revLen > MICKEY_REVEAL_MAX) {
    return {
      valid: false,
      reason: `reveal must be between ${MICKEY_REVEAL_MIN} and ${MICKEY_REVEAL_MAX} characters`,
      code: 'validation_failed',
    };
  }

  if (
    containsUrlOrEmail(input.clue1) ||
    containsUrlOrEmail(input.clue2) ||
    containsUrlOrEmail(input.reveal)
  ) {
    return {
      valid: false,
      reason: 'Submission text must not contain URLs or email addresses',
      code: 'mickey_text_rejected',
    };
  }

  return {
    valid: true,
    zone: input.zone as MickeyZone,
    difficulty: input.difficulty as MickeyDifficulty,
  };
}
