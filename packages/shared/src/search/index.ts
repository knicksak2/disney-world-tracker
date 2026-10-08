export {
  QUOTES_AND_APOSTROPHES_REGEX,
  normalizeSearchText,
  tokenizeSearchQuery,
} from './normalization.js';

export {
  MAX_METADATA_FALLBACK_ROWS,
  type SearchableExperience,
  type SearchMatchTier,
  type SearchScoredResult,
  scoreExperienceSearch,
  filterAndRankExperiences,
} from './experienceSearch.js';

export {
  CURATED_EXPERIENCE_ALIASES,
  checkExperienceAliasMatch,
  type SearchAliasEntry,
  type AliasMatchResult,
} from './experienceAliases.js';

export {
  FUZZY_MIN_TOKEN_LENGTH,
  MAX_FUZZY_EDIT_DISTANCE,
  damerauLevenshteinDistance,
  isFuzzyTokenMatch,
} from './fuzzyDistance.js';
