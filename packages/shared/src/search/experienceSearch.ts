/**
 * Pure experience search normalization, union matching, and flat-tier relevance ranking.
 *
 * Implements:
 *   - disney-world-tracker Property 30 (Requirements 1.20, 1.25-1.28)
 *   - catalog-navigation-redesign Property 1 (Requirements 5.2, 5.8, 5.9)
 *   - day-planning-optimization (Requirement 4.16)
 */

import type {
  FacetValueDTO,
  GroupedFacetsDTO,
  HeightRequirementDTO,
} from '../dto/Facet.js';

export const MAX_METADATA_FALLBACK_ROWS = 25;

export interface SearchableExperience {
  readonly id: string;
  readonly name: string;
  readonly land?: string | null | undefined;
  readonly worldShowcaseCountry?: string | null | undefined;
  readonly subType?: string | null | undefined;
  readonly groupedFacets?: GroupedFacetsDTO | null | undefined;
  readonly interestFacets?: GroupedFacetsDTO | null | undefined;
  readonly physicalConsiderations?:
    | readonly (FacetValueDTO | string)[]
    | null
    | undefined;
  readonly heightRequirement?:
    | HeightRequirementDTO
    | { readonly name: string }
    | null
    | undefined;
  readonly accessibility?: readonly string[] | null | undefined;
}

export type SearchMatchTier =
  | 'exact'
  | 'prefix'
  | 'phrase'
  | 'tokens'
  | 'metadata'
  | 'none';

export interface SearchScoredResult {
  readonly score: number;
  readonly tier: SearchMatchTier;
}

/**
 * Regex matching standard and modifier quotes, apostrophes, and okina codepoints:
 * ASCII ' (U+0027), ‘ (U+2018), ’ (U+2019), ‛ (U+201B), ` (U+0060), ´ (U+00B4),
 * ʹ (U+02B9), ʺ (U+02BA), ʻ (U+02BB), ʼ (U+02BC), ′ (U+2032), " (U+0022),
 * “ (U+201C), ” (U+201D).
 */
const QUOTES_AND_APOSTROPHES_REGEX =
  /[\u0027\u2018\u2019\u201B\u0060\u00B4\u02B9\u02BA\u02BB\u02BC\u2032\u0022\u201C\u201D]/gu;

/**
 * Normalizes text for search matching via a strict 6-step pipeline:
 * 1. Lowercase
 * 2. Unicode NFD decomposition & diacritic strip (Note: non-decomposable characters like ø, ß, æ are not decomposed by NFD)
 * 3. Strip all quotes, apostrophes, okina, and modifier-letter apostrophes
 * 4. Replace non-alphanumeric punctuation and symbols with space (preserving & and +)
 * 5. Normalize connectors (&, +, standalone n) to ' and ', preserving leading boundary whitespace in $1
 *    (Note: connectors run after quote/apostrophe stripping so rock 'n' roll has already become rock n roll with bare n)
 * 6. Collapse consecutive whitespace and trim
 *
 * Limitation note: Because punctuation replacement preserves & and + and connector normalization
 * requires whitespace boundaries, non-space-delimited connectors survive as literal characters
 * (e.g. normalizeSearchText("M&M's") === 'm&ms', a single token containing '&', so 'M and M' will
 * not match it).
 */
export function normalizeSearchText(text: string): string {
  if (typeof text !== 'string' || text.length === 0) {
    return '';
  }

  return (
    text
      // 1. Lowercase
      .toLowerCase()
      // 2. Unicode NFD & diacritic strip
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // 3. Strip all quotes, apostrophes, and modifier letter apostrophes
      .replace(QUOTES_AND_APOSTROPHES_REGEX, '')
      // 4. Replace non-alphanumerics (preserving & and + for connector normalization) with space
      .replace(/[^\p{L}\p{N}\s&+]/gu, ' ')
      // 5. Normalize connectors (&, +, standalone n) to ' and ', preserving leading boundary in $1
      .replace(/(^|\s)(?:n|&|\+)(?=\s|$)/g, '$1and')
      // 6. Collapse whitespace and trim
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Tokenizes a search query into non-empty normalized string tokens.
 */
export function tokenizeSearchQuery(query: string): string[] {
  const normalized = normalizeSearchText(query);
  if (normalized.length === 0) {
    return [];
  }
  return normalized.split(' ').filter((t) => t.length > 0);
}

/**
 * Scores an individual experience against a normalized query and its tokens.
 *
 * Tiers:
 *   100 - Exact normalized name match
 *    80 - Name starts with normalized query string
 *    60 - Name contains normalized query as a contiguous phrase (ensures Substring Superset Invariant)
 *    40 - Every query token prefix-matches at least one token in the normalized name
 *    20 - Metadata fallback (every query token prefix-matches or substring-matches land / country / subType)
 *     0 - No match
 */
export function scoreExperienceSearch(
  exp: SearchableExperience,
  normalizedQuery: string,
  queryTokens: readonly string[],
): SearchScoredResult {
  if (normalizedQuery.length === 0) {
    return { score: 0, tier: 'none' };
  }

  const normName = normalizeSearchText(exp.name);

  // Tier 100: Exact Name Match
  if (normName === normalizedQuery) {
    return { score: 100, tier: 'exact' };
  }

  // Tier 80: Name Starts With Query
  if (normName.startsWith(normalizedQuery)) {
    return { score: 80, tier: 'prefix' };
  }

  // Tier 60: Contiguous Phrase in Name (Guarantees Substring Superset)
  if (normName.includes(normalizedQuery)) {
    return { score: 60, tier: 'phrase' };
  }

  // Tier 40: Every query token is a prefix of some token in the name
  const nameTokens = normName.split(' ').filter((t) => t.length > 0);
  if (
    queryTokens.length > 0 &&
    queryTokens.every((qToken) =>
      nameTokens.some((nToken) => nToken.startsWith(qToken)),
    )
  ) {
    return { score: 40, tier: 'tokens' };
  }

  // Tier 20: Fallback metadata matching across land (with generic compound splitting),
  // worldShowcaseCountry, subType, facet names, height requirements, and accessibility tags
  const metaParts: string[] = [];

  if (exp.land) {
    const normLand = normalizeSearchText(exp.land);
    if (normLand.length > 0) {
      metaParts.push(normLand);
      // Generic compound land split: if a word ends in "land" preceded by a letter, also add the split form
      // e.g. "fantasyland" -> "fantasy land", "tomorrowland" -> "tomorrow land"
      const splitLand = normLand.replace(/(?<=\p{L})land\b/gu, ' land');
      if (splitLand !== normLand) {
        metaParts.push(splitLand);
      }
    }
  }

  if (exp.worldShowcaseCountry) {
    const normCountry = normalizeSearchText(exp.worldShowcaseCountry);
    if (normCountry.length > 0) {
      metaParts.push(normCountry);
    }
  }

  if (exp.subType) {
    const normSubType = normalizeSearchText(exp.subType);
    if (normSubType.length > 0) {
      metaParts.push(normSubType);
    }
  }

  function appendFacetNames(
    grouped?:
      | GroupedFacetsDTO
      | Record<string, readonly FacetValueDTO[] | undefined>
      | readonly FacetValueDTO[]
      | null,
  ): void {
    if (!grouped || typeof grouped !== 'object') return;
    if (Array.isArray(grouped)) {
      for (const facet of grouped) {
        if (typeof facet?.name === 'string') {
          const norm = normalizeSearchText(facet.name);
          if (norm.length > 0) {
            metaParts.push(norm);
          }
        }
      }
      return;
    }
    for (const group of Object.values(grouped)) {
      if (Array.isArray(group)) {
        for (const facet of group) {
          if (typeof facet?.name === 'string') {
            const norm = normalizeSearchText(facet.name);
            if (norm.length > 0) {
              metaParts.push(norm);
            }
          }
        }
      }
    }
  }

  appendFacetNames(exp.groupedFacets);
  appendFacetNames(exp.interestFacets);

  if (Array.isArray(exp.physicalConsiderations)) {
    for (const item of exp.physicalConsiderations) {
      const name = typeof item === 'string' ? item : item?.name;
      if (typeof name === 'string') {
        const norm = normalizeSearchText(name);
        if (norm.length > 0) {
          metaParts.push(norm);
        }
      }
    }
  }

  if (exp.heightRequirement && typeof exp.heightRequirement.name === 'string') {
    const normHeight = normalizeSearchText(exp.heightRequirement.name);
    if (normHeight.length > 0) {
      metaParts.push(normHeight);
    }
  }

  if (Array.isArray(exp.accessibility)) {
    for (const tag of exp.accessibility) {
      if (typeof tag === 'string') {
        const normTag = normalizeSearchText(tag);
        if (normTag.length > 0) {
          metaParts.push(normTag);
        }
      }
    }
  }

  if (metaParts.length > 0) {
    const combinedMeta = metaParts.join(' ');
    if (combinedMeta.includes(normalizedQuery)) {
      return { score: 20, tier: 'metadata' };
    }
    const metaTokens = combinedMeta.split(' ').filter((t) => t.length > 0);
    if (
      queryTokens.length > 0 &&
      queryTokens.every((qToken) =>
        metaTokens.some((mToken) => mToken.startsWith(qToken)),
      )
    ) {
      return { score: 20, tier: 'metadata' };
    }
  }

  return { score: 0, tier: 'none' };
}

/**
 * Filter and rank a list of experiences using the shared search normalization pipeline.
 *
 * Rules:
 * - Empty trimmed query returns the input array unmodified.
 * - Name matches (scores >= 40) are sorted by score DESC, then lower(name) ASC, then id ASC.
 * - Metadata matches (score 20) are sorted by lower(name) ASC, then id ASC, and sliced to MAX_METADATA_FALLBACK_ROWS (25).
 * - Returns [...nameMatches, ...cappedMetadataMatches].
 */
export function filterAndRankExperiences<T extends SearchableExperience>(
  experiences: readonly T[],
  query: string,
): readonly T[] {
  if (typeof query !== 'string' || query.trim().length === 0) {
    return experiences;
  }

  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) {
    return experiences;
  }

  const queryTokens = tokenizeSearchQuery(query);

  const nameMatches: { item: T; score: number; sortName: string }[] = [];
  const metadataMatches: { item: T; score: number; sortName: string }[] = [];

  for (const exp of experiences) {
    const { score } = scoreExperienceSearch(exp, normalizedQuery, queryTokens);
    if (score >= 40) {
      nameMatches.push({ item: exp, score, sortName: exp.name.toLowerCase() });
    } else if (score === 20) {
      metadataMatches.push({
        item: exp,
        score,
        sortName: exp.name.toLowerCase(),
      });
    }
  }

  // Sort metadata matches deterministically before capping to 25
  metadataMatches.sort((a, b) => {
    const cmp = a.sortName.localeCompare(b.sortName);
    if (cmp !== 0) return cmp;
    return a.item.id.localeCompare(b.item.id);
  });

  const cappedMetadata = metadataMatches.slice(0, MAX_METADATA_FALLBACK_ROWS);

  // Sort name matches by score DESC, then lower(name) ASC, then id ASC
  nameMatches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const cmp = a.sortName.localeCompare(b.sortName);
    if (cmp !== 0) return cmp;
    return a.item.id.localeCompare(b.item.id);
  });

  return [
    ...nameMatches.map((m) => m.item),
    ...cappedMetadata.map((m) => m.item),
  ];
}
