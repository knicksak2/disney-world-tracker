/**
 * Bounded typo-tolerance distance calculations for search queries.
 *
 * Implements:
 *   - experience-search-aliases Property 2 (Requirements 2.1-2.5)
 */

export const FUZZY_MIN_TOKEN_LENGTH = 4;
export const MAX_FUZZY_EDIT_DISTANCE = 1;

/**
 * Computes Damerau-Levenshtein edit distance between two strings with early exit if > maxDistance.
 * Supports insertions, deletions, substitutions, and single adjacent transpositions.
 */
export function damerauLevenshteinDistance(
  a: string,
  b: string,
  maxDistance: number = MAX_FUZZY_EDIT_DISTANCE,
): number {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;
  if (Math.abs(aLen - bLen) > maxDistance) return maxDistance + 1;

  if (maxDistance === 1) {
    if (aLen === bLen) {
      let diffCount = 0;
      let firstDiff = -1;
      let isTransposition = false;

      for (let i = 0; i < aLen; i++) {
        if (a[i] !== b[i]) {
          diffCount++;
          if (diffCount === 1) {
            firstDiff = i;
          } else if (diffCount === 2) {
            if (
              firstDiff === i - 1 &&
              a[firstDiff] === b[i] &&
              a[i] === b[firstDiff]
            ) {
              isTransposition = true;
            } else {
              return 2;
            }
          } else {
            return 2;
          }
        }
      }

      if (isTransposition && diffCount === 2) {
        return 1;
      }
      return diffCount;
    } else {
      const [shorter, longer] = aLen < bLen ? [a, b] : [b, a];
      let s = 0;
      let l = 0;
      let edits = 0;

      while (s < shorter.length && l < longer.length) {
        if (shorter[s] !== longer[l]) {
          edits++;
          if (edits > 1) return 2;
          l++;
        } else {
          s++;
          l++;
        }
      }
      return 1;
    }
  }

  // General 2D dynamic programming table with transposition
  const d: number[][] = Array.from({ length: aLen + 1 }, () =>
    new Array<number>(bLen + 1).fill(0),
  );

  for (let i = 0; i <= aLen; i++) d[i]![0] = i;
  for (let j = 0; j <= bLen; j++) d[0]![j] = j;

  for (let i = 1; i <= aLen; i++) {
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let dist = Math.min(
        d[i - 1]![j]! + 1, // deletion
        d[i]![j - 1]! + 1, // insertion
        d[i - 1]![j - 1]! + cost, // substitution
      );

      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        dist = Math.min(dist, d[i - 2]![j - 2]! + 1); // transposition
      }

      d[i]![j] = dist;
    }
  }

  return d[aLen]![bLen]!;
}

/**
 * Returns true if queryToken matches nameToken via exact prefix or bounded 1-edit distance.
 *
 * Rules:
 * 1. Requires queryToken length >= FUZZY_MIN_TOKEN_LENGTH (4).
 * 2. Matches if edit distance to nameToken <= MAX_FUZZY_EDIT_DISTANCE (1).
 * 3. Or if nameToken is longer than queryToken, matches if edit distance to the prefix
 *    slice of nameToken <= MAX_FUZZY_EDIT_DISTANCE (1).
 */
export function isFuzzyTokenMatch(
  queryToken: string,
  nameToken: string,
): boolean {
  if (queryToken.length < FUZZY_MIN_TOKEN_LENGTH) {
    return false;
  }

  if (nameToken.startsWith(queryToken)) {
    return true;
  }

  // Full token 1-edit check
  if (damerauLevenshteinDistance(queryToken, nameToken, MAX_FUZZY_EDIT_DISTANCE) <= MAX_FUZZY_EDIT_DISTANCE) {
    return true;
  }

  // Prefix slice 1-edit check (when name token is longer)
  if (nameToken.length > queryToken.length) {
    const prefixSame = nameToken.slice(0, queryToken.length);
    if (damerauLevenshteinDistance(queryToken, prefixSame, MAX_FUZZY_EDIT_DISTANCE) <= MAX_FUZZY_EDIT_DISTANCE) {
      return true;
    }
    const prefixPlusOne = nameToken.slice(0, queryToken.length + 1);
    if (damerauLevenshteinDistance(queryToken, prefixPlusOne, MAX_FUZZY_EDIT_DISTANCE) <= MAX_FUZZY_EDIT_DISTANCE) {
      return true;
    }
  }

  return false;
}
