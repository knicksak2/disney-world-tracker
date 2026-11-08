import type { MickeyConfidenceLabel } from '@dwt/shared';

export interface StillThereParams {
  priorValue: number; // default: 0.9
  priorWeight: number; // default: 3
  halfLifeDays: number; // default: 90
  confirmedMin: number; // default: 0.65
  uncertainMin: number; // default: 0.4
}

export const DEFAULT_STILL_THERE_PARAMS: StillThereParams = {
  priorValue: 0.9,
  priorWeight: 3,
  halfLifeDays: 90,
  confirmedMin: 0.65,
  uncertainMin: 0.4,
};

/**
 * Computes time-decayed still-there confidence score in [0, 1] per Property 7.
 *
 * Each vote has weight w = 0.5^(ageDays / halfLifeDays).
 * Confidence = (priorWeight * priorValue + sum(w * (vote === 'there' ? 1 : 0))) / (priorWeight + sum(w))
 */
export function stillThereConfidence(
  votes: ReadonlyArray<{ vote: 'there' | 'gone'; votedAt: Date }>,
  now: Date,
  p: StillThereParams = DEFAULT_STILL_THERE_PARAMS,
): number {
  let num = p.priorWeight * p.priorValue;
  let den = p.priorWeight;
  for (const v of votes) {
    const ageDays = Math.max(0, (now.getTime() - v.votedAt.getTime()) / 86_400_000);
    const w = Math.pow(0.5, ageDays / p.halfLifeDays);
    num += w * (v.vote === 'there' ? 1 : 0);
    den += w;
  }
  return num / den;
}

/**
 * Partitions confidence into contiguous labels:
 * >= confirmedMin: 'confirmed'
 * >= uncertainMin: 'uncertain'
 * < uncertainMin: 'possibly_removed'
 */
export function confidenceLabel(
  c: number,
  p: StillThereParams = DEFAULT_STILL_THERE_PARAMS,
): MickeyConfidenceLabel {
  return c >= p.confirmedMin ? 'confirmed' : c >= p.uncertainMin ? 'uncertain' : 'possibly_removed';
}

/**
 * Derives community verified status per Requirement 5.5 and Property 9:
 * True iff Community (!official), label !== 'possibly_removed', and otherThereVoters >= min.
 * Official entries are always false.
 */
export function isCommunityVerified(i: {
  official: boolean;
  label: MickeyConfidenceLabel;
  otherThereVoters: number; // distinct users with a 'there' vote, excluding submitter
  min: number; // MICKEYS_COMMUNITY_VERIFIED_MIN (default 3)
}): boolean {
  return !i.official && i.label !== 'possibly_removed' && i.otherThereVoters >= i.min;
}
